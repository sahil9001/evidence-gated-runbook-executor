import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { overviewRoutes } from "./overview";
import { ALL_SOURCES } from "../mcp";
import type { IncidentRow } from "../domain/store";

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
});
