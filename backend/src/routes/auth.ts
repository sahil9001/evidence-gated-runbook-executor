import { Hono } from "hono";
import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import { StoreConflictError, type UserRow } from "../domain/store";
import { hashPassword, verifyPassword } from "../auth/password";
import { createSession, revokeSession, SESSION_TTL_MS } from "../auth/session";
import { requireAuth, toPublicUser, SESSION_COOKIE_NAME, type AuthedEnv } from "../auth/middleware";

const MIN_PASSWORD_LENGTH = 12;
// No real passphrase is anywhere near this long. Capping it here rejects
// oversized input with 400 validation_failed BEFORE hashPassword ever runs
// PBKDF2 (210,000 iterations) over it — without this, an attacker could
// submit arbitrarily large passwords to an endpoint that has no rate limit,
// amplifying per-request CPU/memory cost cheaply.
const MAX_PASSWORD_LENGTH = 1024;
// RFC 5321's hard limit on the total length of an email address.
const MAX_EMAIL_LENGTH = 254;

const emailSchema = z.string().email().max(MAX_EMAIL_LENGTH, `Email must be at most ${MAX_EMAIL_LENGTH} characters`);

const registerBodySchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
});

const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
});

/**
 * Not a real credential. Generated once, offline, from an arbitrary
 * password nobody will ever type — its only purpose is to give
 * `verifyPassword` a same-shaped `{ hash, salt }` pair to derive against
 * when the looked-up user doesn't exist, so the "unknown email" path does
 * the same PBKDF2 work (210,000 iterations) as the "wrong password" path.
 * Without this, an unknown email would skip `verifyPassword` entirely and
 * respond measurably faster, leaking which emails are registered via
 * timing even though the response bodies are identical.
 */
const DUMMY_PASSWORD_HASH = "xws+ZFuf/XGz9i7a94S7yp4ZBuf2UYSFcoYjtMtE+Ao=";
const DUMMY_PASSWORD_SALT = "k6SuxNbau+T2fnAA9O62lg==";

const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

function setSessionCookie(c: Context<AuthedEnv>, sessionId: string): void {
  setCookie(c, SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

function clearSessionCookie(c: Context<AuthedEnv>): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

/**
 * True for both shapes a duplicate-email/id write can throw across the two
 * `Store` adapters: the memory store's explicit `StoreConflictError` (see
 * `src/store/memory.ts`), and D1's native SQLite error, whose message names
 * the violated constraint rather than being a distinct error class. Neither
 * adapter guarantees byte-identical text (see the doc on `StoreConflictError`
 * itself), so this checks the class first and falls back to a
 * case-insensitive substring match for D1 rather than an exact message.
 */
function isConflictError(error: unknown): boolean {
  if (error instanceof StoreConflictError) return true;
  return error instanceof Error && error.message.toUpperCase().includes("UNIQUE");
}

export const authRoutes = new Hono<AuthedEnv>();

authRoutes.post("/auth/register", async (c) => {
  const parsed = await parseJsonBody(c, registerBodySchema);
  if (!parsed.success) return parsed.response;
  const { email, password } = parsed.data;

  const store = createD1Store(c.env.DB);

  const existing = await store.getUserByEmail(email);
  if (existing !== null) {
    return c.json(apiError("email_taken", `An account with email "${email}" already exists`), 409);
  }

  const nowIso = new Date().toISOString();
  const { hash, salt } = await hashPassword(password);
  const user: UserRow = { id: crypto.randomUUID(), email, passwordHash: hash, salt, createdAt: nowIso };

  try {
    await store.createUser(user);
  } catch (error) {
    // Defense in depth against the same TOCTOU race the domain layer's
    // conditional gate upsert closes for approvals: two concurrent
    // registrations can both pass the check above. `users.email` is
    // UNIQUE at the D1 layer and rejected explicitly by the memory
    // adapter, so the loser's `createUser` throws here instead of
    // silently succeeding or corrupting state — surface that as a clean
    // 409 rather than letting it fall through to `app.onError`'s 500.
    if (isConflictError(error)) {
      return c.json(apiError("email_taken", `An account with email "${email}" already exists`), 409);
    }
    throw error;
  }

  const session = await createSession(store, user.id, nowIso);
  setSessionCookie(c, session.id);

  return c.json({ ok: true, data: { user: toPublicUser(user) } });
});

authRoutes.post("/auth/login", async (c) => {
  const parsed = await parseJsonBody(c, loginBodySchema);
  if (!parsed.success) return parsed.response;
  const { email, password } = parsed.data;

  const store = createD1Store(c.env.DB);
  const user = await store.getUserByEmail(email);

  // Always run verifyPassword, on a real hash+salt when the user exists and
  // on the dummy pair above when they don't — see DUMMY_PASSWORD_HASH.
  // "Unknown email" and "wrong password" produce the exact same response,
  // in the exact same amount of time, so neither the body nor the timing
  // reveals which case occurred.
  const passwordOk = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    user?.salt ?? DUMMY_PASSWORD_SALT
  );

  if (user === null || !passwordOk) {
    return c.json(apiError("invalid_credentials", "Invalid email or password"), 401);
  }

  const nowIso = new Date().toISOString();
  const session = await createSession(store, user.id, nowIso);
  setSessionCookie(c, session.id);

  return c.json({ ok: true, data: { user: toPublicUser(user) } });
});

authRoutes.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId !== undefined) {
    const store = createD1Store(c.env.DB);
    await revokeSession(store, sessionId);
  }
  clearSessionCookie(c);
  return c.json({ ok: true, data: {} });
});

authRoutes.get("/auth/me", requireAuth, (c) => {
  return c.json({ ok: true, data: { user: c.var.user } });
});

export default authRoutes;
