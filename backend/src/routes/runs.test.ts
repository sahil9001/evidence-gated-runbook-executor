import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { runListRoutes, MAX_RUN_LIMIT } from "./runs";
import { ALL_SOURCES } from "../mcp";
import type { IncidentRow } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

function buildApp(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.use("/runs/*", requireAuth);
  app.route("/", createRunRoutes(ALL_SOURCES));
  app.route("/", runListRoutes);
  return app;
}

async function request(
  app: Hono<AuthedEnv>,
  method: string,
  path: string,
  body: unknown,
  cookie?: string
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie !== undefined) headers.cookie = cookie;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(`http://localhost${path}`, init);
  const ctx = createExecutionContext();
  const response = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

let counter = 0;
async function registeredCookie(): Promise<string> {
  counter += 1;
  const store = createD1Store(env.DB);
  const userId = `user-runs-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `runs-${counter}@example.com`,
    passwordHash: "h",
    salt: "s",
    createdAt: nowIso
  });
  const session = await createSession(store, userId, nowIso);
  return `rp_session=${session.id}`;
}

async function seedIncident(overrides: Partial<IncidentRow> = {}): Promise<IncidentRow> {
  counter += 1;
  const store = createD1Store(env.DB);
  const incident: IncidentRow = {
    id: `inc-runs-${counter}`,
    title: "Checkout failing",
    service: "payment-service",
    signals: ["timeout"],
    status: "open",
    createdBy: "seed@example.com",
    createdAt: new Date().toISOString(),
    ...overrides
  };
  await store.createIncident(incident);
  return incident;
}

async function createRun(app: Hono<AuthedEnv>, cookie: string): Promise<{ id: string }> {
  const incident = await seedIncident();
  const { json } = await request(app, "POST", `/incidents/${incident.id}/run`, {}, cookie);
  return (json as ApiOk<{ run: { id: string } }>).data.run;
}

describe("GET /runs", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(app, "GET", "/runs", undefined);
    expect(status).toBe(401);
  });

  it("lists runs newest first", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const first = await createRun(app, cookie);
    const second = await createRun(app, cookie);

    const { status, json } = await request(app, "GET", "/runs", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ id: string }[]>;
    const ids = body.data.map((r) => r.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it("filters by state", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const run = await createRun(app, cookie);

    const { status, json } = await request(app, "GET", "/runs?state=awaiting_approval", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ id: string; state: string }[]>;
    expect(body.data.some((r) => r.id === run.id)).toBe(true);
    expect(body.data.every((r) => r.state === "awaiting_approval")).toBe(true);
  });

  it("400s on an unknown state", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(app, "GET", "/runs?state=bogus", undefined, cookie);
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("caps limit at MAX_RUN_LIMIT even when a client asks for more", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    for (let i = 0; i < 3; i += 1) await createRun(app, cookie);

    const { status, json } = await request(app, "GET", `/runs?limit=${MAX_RUN_LIMIT + 5000}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<unknown[]>;
    expect(body.data.length).toBeLessThanOrEqual(MAX_RUN_LIMIT);
  });
});

describe("GET /runs/:id", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(app, "GET", "/runs/does-not-exist", undefined);
    expect(status).toBe(401);
  });

  it("404s for an unknown id", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(app, "GET", "/runs/does-not-exist", undefined, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("returns run, incident, packet, action, gate, failures, and confidence", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const run = await createRun(app, cookie);

    const { status, json } = await request(app, "GET", `/runs/${run.id}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      run: { id: string };
      incident: { id: string };
      packet: { cards: unknown[] } | null;
      action: { id: string } | null;
      gate: { id: string } | null;
      failures: unknown[];
      confidence: string | null;
    }>;
    expect(body.data.run.id).toBe(run.id);
    expect(body.data.incident).not.toBeNull();
    expect(body.data.packet?.cards.length).toBeGreaterThan(0);
    expect(body.data.action?.id).toBe(run.id);
    expect(body.data.gate?.id).toBe(run.id);
    expect(Array.isArray(body.data.failures)).toBe(true);
    expect(["low", "medium", "high"]).toContain(body.data.confidence);
  });
});
