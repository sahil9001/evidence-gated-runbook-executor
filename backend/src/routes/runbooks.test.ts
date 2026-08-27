import { env, createExecutionContext, waitOnExecutionContext, applyD1Migrations } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { runbookRoutes } from "./runbooks";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

function buildApp(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/runbooks/*", requireAuth);
  app.route("/", runbookRoutes);
  return app;
}

async function get(app: Hono<AuthedEnv>, path: string, cookie?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) headers.cookie = cookie;
  const req = new Request(`http://localhost${path}`, { headers });
  const ctx = createExecutionContext();
  const response = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

let counter = 0;
async function registeredCookie(): Promise<string> {
  counter += 1;
  const store = createD1Store(env.DB);
  const userId = `user-rb-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `rb-${counter}@example.com`,
    passwordHash: "h",
    salt: "s",
    createdAt: nowIso
  });
  const session = await createSession(store, userId, nowIso);
  return `rp_session=${session.id}`;
}

describe("GET /runbooks", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await get(app, "/runbooks");
    expect(status).toBe(401);
  });

  it("lists every runbook, including allowedSources", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await get(app, "/runbooks", cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ id: string; allowedSources: string[] }[]>;
    expect(body.data.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data[0]?.allowedSources)).toBe(true);
    expect(body.data[0]?.allowedSources.length).toBeGreaterThan(0);
  });
});

describe("GET /runbooks/:id", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await get(app, "/runbooks/does-not-exist");
    expect(status).toBe(401);
  });

  it("404s for an unknown id", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await get(app, "/runbooks/does-not-exist", cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("returns the runbook with its allowedSources, steps, and proposedAction", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { json: listJson } = await get(app, "/runbooks", cookie);
    const first = (listJson as ApiOk<{ id: string }[]>).data[0];
    expect(first).toBeDefined();

    const { status, json } = await get(app, `/runbooks/${first?.id}`, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      id: string;
      trigger: unknown;
      allowedSources: string[];
      steps: unknown[];
      proposedAction: unknown;
    }>;
    expect(body.data.id).toBe(first?.id);
    expect(body.data.allowedSources.length).toBeGreaterThan(0);
    expect(body.data.steps.length).toBeGreaterThan(0);
    expect(body.data.proposedAction).toBeDefined();
  });
});
