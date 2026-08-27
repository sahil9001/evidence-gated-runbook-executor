import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { apiError, type Env } from "../index";
import { createD1Store } from "../store/d1";
import { resolveSession } from "./session";
import type { UserRow } from "../domain/store";

/** Name of the session cookie set by `/auth/login` and `/auth/register`,
 * and cleared by `/auth/logout`. */
export const SESSION_COOKIE_NAME = "rp_session";

/** What downstream handlers see on `c.var.user` — never the credential
 * material (`passwordHash`, `salt`). */
export type PublicUser = Omit<UserRow, "passwordHash" | "salt">;

export type AuthedVariables = { user: PublicUser };

/** Bindings + Variables generic for any route mounted behind `requireAuth`. */
export type AuthedEnv = { Bindings: Env; Variables: AuthedVariables };

export function toPublicUser(user: UserRow): PublicUser {
  const { passwordHash: _passwordHash, salt: _salt, ...publicUser } = user;
  return publicUser;
}

/**
 * Resolves the `rp_session` cookie to a user and sets `c.var.user` for
 * downstream handlers. No cookie, an unknown session id, or an expired
 * session all produce the same `401 unauthenticated` — none of them reveal
 * which case occurred, since none of that distinction is a client's
 * business.
 */
export const requireAuth = createMiddleware<AuthedEnv>(async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE_NAME);
  if (sessionId === undefined) {
    return c.json(apiError("unauthenticated", "Authentication required"), 401);
  }

  const store = createD1Store(c.env.DB);
  const nowIso = new Date().toISOString();
  const user = await resolveSession(store, sessionId, nowIso);
  if (user === null) {
    return c.json(apiError("unauthenticated", "Authentication required"), 401);
  }

  c.set("user", toPublicUser(user));
  await next();
});
