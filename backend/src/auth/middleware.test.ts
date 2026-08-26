import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import type { Env } from "../index";
import { createD1Store } from "../store/d1";
import { createSession } from "./session";
import { requireAuth, SESSION_COOKIE_NAME, type AuthedEnv } from "./middleware";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

function buildTestApp(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/protected/*", requireAuth);
  app.get("/protected/whoami", (c) => c.json({ ok: true, data: c.var.user }));
  return app;
}

type ApiErr = { ok: false; error: { code: string; message: string } };
type ApiOk<T> = { ok: true; data: T };

async function fetchProtected(app: Hono<AuthedEnv>, cookie?: string): Promise<{ status: number; json: unknown }> {
  const request = new Request("http://localhost/protected/whoami", {
    headers: cookie === undefined ? {} : { cookie }
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

describe("requireAuth", () => {
  it("returns 401 unauthenticated with no cookie", async () => {
    const app = buildTestApp();
    const { status, json } = await fetchProtected(app);
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("unauthenticated");
  });

  it("returns 401 unauthenticated for an unknown session id", async () => {
    const app = buildTestApp();
    const { status, json } = await fetchProtected(app, `${SESSION_COOKIE_NAME}=does-not-exist`);
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("unauthenticated");
  });

  it("returns 401 unauthenticated for an expired session", async () => {
    const store = createD1Store(env.DB);
    await store.createUser({
      id: "user-mw-expired",
      email: "expired-mw@example.com",
      passwordHash: "h",
      salt: "s",
      createdAt: "2020-01-01T00:00:00.000Z"
    });
    const session = await createSession(store, "user-mw-expired", "2020-01-01T00:00:00.000Z", 1000);

    const app = buildTestApp();
    const { status, json } = await fetchProtected(app, `${SESSION_COOKIE_NAME}=${session.id}`);
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("unauthenticated");
  });

  it("sets c.var.user and calls through for a valid session, without leaking passwordHash/salt", async () => {
    const store = createD1Store(env.DB);
    await store.createUser({
      id: "user-mw-ok",
      email: "mw-ok@example.com",
      passwordHash: "h",
      salt: "s",
      createdAt: "2026-08-26T00:00:00.000Z"
    });
    const session = await createSession(store, "user-mw-ok", new Date().toISOString());

    const app = buildTestApp();
    const { status, json } = await fetchProtected(app, `${SESSION_COOKIE_NAME}=${session.id}`);
    expect(status).toBe(200);
    const body = json as ApiOk<{ id: string; email: string }>;
    expect(body.data.id).toBe("user-mw-ok");
    expect(body.data.email).toBe("mw-ok@example.com");
    expect(body.data).not.toHaveProperty("passwordHash");
    expect(body.data).not.toHaveProperty("salt");
  });
});
