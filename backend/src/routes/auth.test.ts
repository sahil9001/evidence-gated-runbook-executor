import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect, vi } from "vitest";
import app from "../index";
import { createD1Store } from "../store/d1";
import * as d1StoreModule from "../store/d1";
import * as passwordModule from "../auth/password";
import type { Store } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };
type PublicUser = { id: string; email: string; createdAt: string };

async function request(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<{ status: number; json: unknown; setCookie: string | null }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);

  const req = new Request(`http://localhost${path}`, init);
  const ctx = createExecutionContext();
  const response = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json(), setCookie: response.headers.get("set-cookie") };
}

const post = (path: string, body?: unknown, cookie?: string): ReturnType<typeof request> =>
  request("POST", path, body, cookie);
const get = (path: string, cookie?: string): ReturnType<typeof request> => request("GET", path, undefined, cookie);

const STRONG_PASSWORD = "a-very-secure-password-123";

function sessionCookie(setCookie: string | null): string {
  if (setCookie === null) throw new Error("expected a Set-Cookie header");
  const first = setCookie.split(";")[0];
  if (first === undefined) throw new Error("malformed Set-Cookie header");
  return first;
}

describe("POST /auth/register", () => {
  it("creates a user and opens a session (sets the session cookie)", async () => {
    const email = "register-happy@example.com";
    const { status, json, setCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });

    expect(status).toBe(200);
    const body = json as ApiOk<{ user: PublicUser }>;
    expect(body.data.user.email).toBe(email);
    expect(body.data.user).not.toHaveProperty("passwordHash");
    expect(body.data.user).not.toHaveProperty("salt");
    expect(setCookie).not.toBeNull();
  });

  it("never returns passwordHash or salt in the response body", async () => {
    const { json } = await post("/auth/register", { email: "no-leak@example.com", password: STRONG_PASSWORD });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("salt");
  });

  // SameSite=Lax is the one attribute here that is also a deployment
  // constraint: it confines the console to the API's own site. Loosening it to
  // None to allow a cross-site console needs a CSRF defence first — see
  // setSessionCookie in ./auth.ts. This assertion is what makes that a
  // deliberate change rather than an incidental one.
  it("sets the cookie with HttpOnly, Secure, SameSite=Lax, Path=/, and a 30-day Max-Age", async () => {
    const { setCookie } = await post("/auth/register", { email: "cookie-attrs@example.com", password: STRONG_PASSWORD });
    expect(setCookie).not.toBeNull();
    const cookie = setCookie ?? "";
    expect(cookie).toMatch(/rp_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/i); // 30 days in seconds
  });

  it("the session from registration works immediately against /auth/me", async () => {
    const email = "register-then-me@example.com";
    const { setCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    const { status, json } = await get("/auth/me", sessionCookie(setCookie));
    expect(status).toBe(200);
    const body = json as ApiOk<{ user: PublicUser }>;
    expect(body.data.user.email).toBe(email);
  });

  it("returns 409 email_taken for a duplicate email", async () => {
    const email = "dup@example.com";
    await post("/auth/register", { email, password: STRONG_PASSWORD });
    const { status, json } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    expect(status).toBe(409);
    expect((json as ApiErr).error.code).toBe("email_taken");
  });

  it("two concurrent registrations for the same email: exactly one succeeds, one gets email_taken", async () => {
    const email = "race@example.com";
    const [first, second] = await Promise.all([
      post("/auth/register", { email, password: STRONG_PASSWORD }),
      post("/auth/register", { email, password: STRONG_PASSWORD })
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("returns 400 validation_failed for a password shorter than 12 characters, and names the rule", async () => {
    const { status, json } = await post("/auth/register", { email: "weak@example.com", password: "short1" });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
    expect(JSON.stringify(body.error)).toMatch(/12/);
  });

  it("returns 400 validation_failed for a malformed email", async () => {
    const { status, json } = await post("/auth/register", { email: "not-an-email", password: STRONG_PASSWORD });
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("returns 400 validation_failed for a non-JSON body", async () => {
    const { status, json } = await post("/auth/register", "{not json");
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("returns 400 validation_failed for an oversized password, and never runs PBKDF2 over it", async () => {
    const hashSpy = vi.spyOn(passwordModule, "hashPassword");
    const verifySpy = vi.spyOn(passwordModule, "verifyPassword");

    const oversizedPassword = "a".repeat(1025);
    const { status, json } = await post("/auth/register", { email: "oversized-pw@example.com", password: oversizedPassword });

    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
    expect(hashSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();

    hashSpy.mockRestore();
    verifySpy.mockRestore();
  });

  it("returns 400 validation_failed for an oversized email", async () => {
    const oversizedEmail = `${"a".repeat(250)}@example.com`;
    const { status, json } = await post("/auth/register", { email: oversizedEmail, password: STRONG_PASSWORD });
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("still accepts a normal-length password", async () => {
    const { status } = await post("/auth/register", { email: "normal-pw@example.com", password: STRONG_PASSWORD });
    expect(status).toBe(200);
  });
});

describe("POST /auth/login", () => {
  const email = "login-user@example.com";

  it("sets a session cookie and returns the user on success", async () => {
    await post("/auth/register", { email, password: STRONG_PASSWORD });
    const { status, json, setCookie } = await post("/auth/login", { email, password: STRONG_PASSWORD });
    expect(status).toBe(200);
    const body = json as ApiOk<{ user: PublicUser }>;
    expect(body.data.user.email).toBe(email);
    expect(setCookie).not.toBeNull();
  });

  it("returns 401 invalid_credentials for an unknown email", async () => {
    const { status, json } = await post("/auth/login", { email: "nobody-at-all@example.com", password: STRONG_PASSWORD });
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("invalid_credentials");
  });

  it("returns 401 invalid_credentials for a wrong password", async () => {
    const wrongPwEmail = "wrong-pw@example.com";
    await post("/auth/register", { email: wrongPwEmail, password: STRONG_PASSWORD });
    const { status, json } = await post("/auth/login", { email: wrongPwEmail, password: "totally-different-password" });
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("invalid_credentials");
  });

  it("returns an IDENTICAL response body for unknown-email and wrong-password (no enumeration)", async () => {
    const knownEmail = "enum-check@example.com";
    await post("/auth/register", { email: knownEmail, password: STRONG_PASSWORD });

    const unknownEmailAttempt = await post("/auth/login", {
      email: "definitely-not-registered@example.com",
      password: "whatever-12345"
    });
    const wrongPasswordAttempt = await post("/auth/login", { email: knownEmail, password: "whatever-12345" });

    expect(unknownEmailAttempt.status).toBe(wrongPasswordAttempt.status);
    expect(unknownEmailAttempt.json).toEqual(wrongPasswordAttempt.json);
  });

  it("does not set a session cookie on failed login", async () => {
    const { setCookie } = await post("/auth/login", { email: "no-such-user@example.com", password: STRONG_PASSWORD });
    expect(setCookie).toBeNull();
  });

  it("returns 400 validation_failed for a non-JSON body", async () => {
    const { status, json } = await post("/auth/login", "{not json");
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("returns 400 validation_failed for an oversized password, and never runs PBKDF2 over it", async () => {
    const hashSpy = vi.spyOn(passwordModule, "hashPassword");
    const verifySpy = vi.spyOn(passwordModule, "verifyPassword");

    const oversizedPassword = "a".repeat(1025);
    const { status, json } = await post("/auth/login", { email, password: oversizedPassword });

    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
    expect(hashSpy).not.toHaveBeenCalled();
    expect(verifySpy).not.toHaveBeenCalled();

    hashSpy.mockRestore();
    verifySpy.mockRestore();
  });

  it("returns 401 invalid_credentials (not 500) when the stored hash is corrupted, malformed base64", async () => {
    const corruptEmail = "corrupt-hash@example.com";
    await post("/auth/register", { email: corruptEmail, password: STRONG_PASSWORD });
    await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE email = ?`)
      .bind("not-valid-base64!!!", corruptEmail)
      .run();

    const { status, json } = await post("/auth/login", { email: corruptEmail, password: STRONG_PASSWORD });
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("invalid_credentials");
  });

  it("returns 401 invalid_credentials (not 500) when the stored salt is corrupted, malformed base64", async () => {
    const corruptEmail = "corrupt-salt@example.com";
    await post("/auth/register", { email: corruptEmail, password: STRONG_PASSWORD });
    await env.DB.prepare(`UPDATE users SET salt = ? WHERE email = ?`).bind("not-valid-base64!!!", corruptEmail).run();

    const { status, json } = await post("/auth/login", { email: corruptEmail, password: STRONG_PASSWORD });
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("invalid_credentials");
  });

  it("returns 401 invalid_credentials (not 500) when the stored hash is the wrong length", async () => {
    const corruptEmail = "corrupt-length@example.com";
    await post("/auth/register", { email: corruptEmail, password: STRONG_PASSWORD });
    await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE email = ?`)
      .bind("dG9vc2hvcnQ=", corruptEmail)
      .run();

    const { status, json } = await post("/auth/login", { email: corruptEmail, password: STRONG_PASSWORD });
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("invalid_credentials");
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const email = "logout-user@example.com";
    const { setCookie: registerCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    const cookie = sessionCookie(registerCookie);

    const { status } = await post("/auth/logout", undefined, cookie);
    expect(status).toBe(200);

    const { status: meStatus } = await get("/auth/me", cookie);
    expect(meStatus).toBe(401);
  });

  it("is idempotent: logging out twice is not an error", async () => {
    const email = "logout-twice@example.com";
    const { setCookie: registerCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    const cookie = sessionCookie(registerCookie);

    const first = await post("/auth/logout", undefined, cookie);
    expect(first.status).toBe(200);
    const second = await post("/auth/logout", undefined, cookie);
    expect(second.status).toBe(200);
  });

  it("is idempotent even with no cookie at all", async () => {
    const { status } = await post("/auth/logout");
    expect(status).toBe(200);
  });

  it("refuses a simple cross-site-shaped POST, leaving the session intact", async () => {
    // Logout reads only the cookie and no body, so it is the one state change
    // that never touches `parseJsonBody`. Without the surface-wide content-type
    // guard (see requireJsonContentType in ../index.ts) a plain cross-site HTML
    // form — which can only send text/plain and friends, and so is never
    // preflighted — could sign an operator out. That is unreachable today
    // because the session cookie is SameSite=Lax, but the guard is what keeps
    // it unreachable if that is ever loosened.
    const email = "logout-simple-request@example.com";
    const { setCookie: registerCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    const cookie = sessionCookie(registerCookie);

    const req = new Request("http://localhost/auth/logout", {
      method: "POST",
      headers: { "content-type": "text/plain", cookie }
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unsupported_media_type" } });

    // The session must have survived: a rejected request must not be a
    // half-executed one.
    const { status: meStatus } = await get("/auth/me", cookie);
    expect(meStatus).toBe(200);
  });
});

describe("GET /auth/me", () => {
  it("returns 401 unauthenticated with no cookie", async () => {
    const { status, json } = await get("/auth/me");
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("unauthenticated");
  });

  it("returns the current user, never the password hash or salt", async () => {
    const email = "me-user@example.com";
    const { setCookie } = await post("/auth/register", { email, password: STRONG_PASSWORD });
    const { status, json } = await get("/auth/me", sessionCookie(setCookie));
    expect(status).toBe(200);
    const body = json as ApiOk<{ user: PublicUser }>;
    expect(body.data.user.email).toBe(email);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("salt");
  });
});

describe("expired session cleanup on login", () => {
  it("deletes an already-expired session and keeps a still-valid one, after a successful login", async () => {
    const email = "cleanup-user@example.com";
    await post("/auth/register", { email, password: STRONG_PASSWORD });

    const store = createD1Store(env.DB);
    const user = await store.getUserByEmail(email);
    if (user === null) throw new Error("expected user to exist after registration");

    const expiredSession = {
      id: "session-expired-cleanup",
      userId: user.id,
      createdAt: "2000-01-01T00:00:00.000Z",
      expiresAt: "2000-01-02T00:00:00.000Z"
    };
    const liveSession = {
      id: "session-live-cleanup",
      userId: user.id,
      createdAt: "2100-01-01T00:00:00.000Z",
      expiresAt: "2100-01-02T00:00:00.000Z"
    };
    await store.createSession(expiredSession);
    await store.createSession(liveSession);

    const { status } = await post("/auth/login", { email, password: STRONG_PASSWORD });
    expect(status).toBe(200);

    expect(await store.getSession("session-expired-cleanup")).toBeNull();
    expect(await store.getSession("session-live-cleanup")).toEqual(liveSession);
  });

  it("does not fail the login when the cleanup call itself throws", async () => {
    const email = "cleanup-throws@example.com";
    await post("/auth/register", { email, password: STRONG_PASSWORD });

    const cleanupSpy = vi.spyOn(d1StoreModule, "createD1Store").mockImplementationOnce(
      (db: D1Database): Store => {
        const realStore = createD1Store(db);
        return {
          ...realStore,
          deleteExpiredSessions: async () => {
            throw new Error("boom - cleanup failed");
          }
        };
      }
    );

    const { status, json } = await post("/auth/login", { email, password: STRONG_PASSWORD });
    expect(status).toBe(200);
    const body = json as ApiOk<{ user: PublicUser }>;
    expect(body.data.user.email).toBe(email);

    cleanupSpy.mockRestore();
  });
});

describe("password storage", () => {
  it("never stores the plaintext password (spot-check via the store)", async () => {
    const email = "plaintext-check@example.com";
    await post("/auth/register", { email, password: STRONG_PASSWORD });
    const store = createD1Store(env.DB);
    const user = await store.getUserByEmail(email);
    expect(user?.passwordHash).not.toBe(STRONG_PASSWORD);
    expect(user?.salt).toBeTruthy();
  });
});
