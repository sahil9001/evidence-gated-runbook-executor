import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { auditRoutes, MAX_AUDIT_LIMIT } from "./audit";
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
  app.use("/audit/*", requireAuth);
  app.route("/", createRunRoutes(ALL_SOURCES));
  app.route("/", auditRoutes);
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
  const userId = `user-audit-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `audit-${counter}@example.com`,
    passwordHash: "h",
    salt: "s",
    createdAt: nowIso
  });
  const session = await createSession(store, userId, nowIso);
  return `rp_session=${session.id}`;
}

async function seedIncident(): Promise<IncidentRow> {
  counter += 1;
  const store = createD1Store(env.DB);
  const incident: IncidentRow = {
    id: `inc-audit-${counter}`,
    title: "Checkout failing",
    service: "payment-service",
    signals: ["timeout"],
    status: "open",
    createdBy: "seed@example.com",
    createdAt: new Date().toISOString()
  };
  await store.createIncident(incident);
  return incident;
}

async function createRun(app: Hono<AuthedEnv>, cookie: string): Promise<{ id: string }> {
  const incident = await seedIncident();
  const { json } = await request(app, "POST", `/incidents/${incident.id}/run`, {}, cookie);
  return (json as ApiOk<{ run: { id: string } }>).data.run;
}

describe("GET /audit", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(app, "GET", "/audit", undefined);
    expect(status).toBe(401);
  });

  it("returns entries scoped to a run when runId is given", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const runA = await createRun(app, cookie);
    const runB = await createRun(app, cookie);

    const { status, json } = await request(app, "GET", `/audit?runId=${runA.id}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ runId: string }[]>;
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((e) => e.runId === runA.id)).toBe(true);
    expect(body.data.some((e) => e.runId === runB.id)).toBe(false);
  });

  it("returns recent entries across every run when runId is absent", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    await createRun(app, cookie);

    const { status, json } = await request(app, "GET", "/audit", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<unknown[]>;
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("caps limit at MAX_AUDIT_LIMIT even when a client asks for more", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    await createRun(app, cookie);

    const { status, json } = await request(app, "GET", `/audit?limit=${MAX_AUDIT_LIMIT + 5000}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<unknown[]>;
    expect(body.data.length).toBeLessThanOrEqual(MAX_AUDIT_LIMIT);
  });

  // Qodo finding: when `runId` is present, `?limit=` was silently ignored —
  // the runId branch always called the unbounded `listAudit(runId)` path,
  // so `/audit?runId=...&limit=1` could return every entry for that run.
  it("honours ?limit= on the runId-scoped path too, not just the recent-activity path", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const run = await createRun(app, cookie);

    // The run's own creation writes exactly one audit entry in the happy
    // path (see createRunWithArtifacts's call site in run.ts); append two
    // more directly so this run genuinely has more entries than the limit
    // being tested, making the assertion discriminate a real bug from a
    // coincidentally-small history.
    const store = createD1Store(env.DB);
    await store.appendAudit({ id: crypto.randomUUID(), runId: run.id, at: new Date().toISOString(), kind: "note", detail: "extra-1" });
    await store.appendAudit({ id: crypto.randomUUID(), runId: run.id, at: new Date().toISOString(), kind: "note", detail: "extra-2" });

    const { status, json } = await request(app, "GET", `/audit?runId=${run.id}&limit=1`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ runId: string }[]>;
    expect(body.data.length).toBe(1);
  });
});
