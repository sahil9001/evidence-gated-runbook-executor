import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect, vi } from "vitest";
import { createD1Store } from "../store/d1";
import * as d1StoreModule from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { overviewRoutes } from "./overview";
import { ALL_SOURCES } from "../mcp";
import type { IncidentRow, RunRow, Store } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };

function buildApp(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.use("/overview/*", requireAuth);
  app.route("/", createRunRoutes(ALL_SOURCES));
  app.route("/", overviewRoutes);
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
  const userId = `user-ov-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `ov-${counter}@example.com`,
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
    id: `inc-ov-${counter}`,
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

describe("GET /overview", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(app, "GET", "/overview", undefined);
    expect(status).toBe(401);
  });

  it("counts awaiting-approval runs, active incidents, runs today, and recent activity", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const incident = await seedIncident();
    await request(app, "POST", `/incidents/${incident.id}/run`, {}, cookie);

    const { status, json } = await request(app, "GET", "/overview", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      awaitingApproval: number;
      activeIncidents: number;
      runsToday: number;
      recentActivity: unknown[];
    }>;
    expect(body.data.awaitingApproval).toBeGreaterThanOrEqual(1);
    expect(body.data.activeIncidents).toBeGreaterThanOrEqual(1);
    expect(body.data.runsToday).toBeGreaterThanOrEqual(1);
    expect(body.data.recentActivity.length).toBeGreaterThan(0);
  });

  // Qodo finding: every request loaded every run and every incident into the
  // Worker to filter them in memory for three counts, so runtime and memory
  // grew with total history. The fix pushes counting into the store
  // (Store#countRunsByState / #countRunsSince / #countIncidentsExcludingStatus)
  // — this test proves both halves: the counts are still correct against a
  // known seeded delta, AND the route genuinely no longer calls the
  // unbounded `listRuns` / `listIncidents` methods to get them.
  it("computes counts correctly against a seeded delta, without calling listRuns or listIncidents", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();

    const before = await request(app, "GET", "/overview", undefined, cookie);
    const beforeData = (
      before.json as ApiOk<{ awaitingApproval: number; activeIncidents: number; runsToday: number }>
    ).data;

    const store = createD1Store(env.DB);
    const nowIso = new Date().toISOString();
    counter += 1;
    const seedId = `overview-seed-${counter}`;

    // Two non-resolved incidents (both count as "active") and one resolved
    // one (must not).
    const incidentRow = (status: string, suffix: string): IncidentRow => ({
      id: `${seedId}-inc-${suffix}`,
      title: "Seeded for overview count test",
      service: "payment-service",
      signals: ["timeout"],
      status,
      createdBy: "seed@example.com",
      createdAt: nowIso
    });
    await store.createIncident(incidentRow("open", "a"));
    await store.createIncident(incidentRow("investigating", "b"));
    await store.createIncident(incidentRow("resolved", "c"));

    // Two awaiting-approval runs (count toward both awaitingApproval AND
    // runsToday) and one collecting run (counts toward runsToday only).
    // `runs.incident_id` carries no foreign key, so these can be seeded
    // directly without a matching incident row.
    const runRow = (state: RunRow["state"], suffix: string): RunRow => ({
      id: `${seedId}-run-${suffix}`,
      incidentId: `${seedId}-inc-a`,
      runbookId: "checkout-failure",
      service: "payment-service",
      state,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: null
    });
    await store.createRun(runRow("awaiting_approval", "a"));
    await store.createRun(runRow("awaiting_approval", "b"));
    await store.createRun(runRow("collecting", "c"));

    // `mockImplementation` (not `-Once`): `requireAuth` middleware also calls
    // `createD1Store` to resolve the session, BEFORE the route handler's own
    // call — an `Once` mock would be consumed by that middleware call and
    // the route's own `createD1Store` would silently get the real,
    // un-spied store, making this assertion vacuous. The original is
    // captured BEFORE spying and called by its own reference inside the
    // mock, since `createD1Store` (the imported binding) now points at the
    // spy itself — calling it recursively would blow the call stack.
    const originalCreateD1Store = d1StoreModule.createD1Store;
    const listRunsSpy = vi.fn();
    const listIncidentsSpy = vi.fn();
    const createSpy = vi.spyOn(d1StoreModule, "createD1Store").mockImplementation((db: D1Database): Store => {
      const realStore = originalCreateD1Store(db);
      return { ...realStore, listRuns: listRunsSpy, listIncidents: listIncidentsSpy };
    });

    const after = await request(app, "GET", "/overview", undefined, cookie);
    createSpy.mockRestore();

    expect(after.status).toBe(200);
    const afterData = (
      after.json as ApiOk<{ awaitingApproval: number; activeIncidents: number; runsToday: number }>
    ).data;

    expect(afterData.awaitingApproval - beforeData.awaitingApproval).toBe(2);
    expect(afterData.activeIncidents - beforeData.activeIncidents).toBe(2);
    expect(afterData.runsToday - beforeData.runsToday).toBe(3);

    expect(listRunsSpy).not.toHaveBeenCalled();
    expect(listIncidentsSpy).not.toHaveBeenCalled();
  });
});
