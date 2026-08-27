import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { packetRoutes } from "./packet";
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
  app.route("/", createRunRoutes(ALL_SOURCES));
  app.route("/", packetRoutes);
  return app;
}

async function request(
  app: Hono<AuthedEnv>,
  method: string,
  path: string,
  body: unknown,
  cookie: string
): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = { method, headers: { "content-type": "application/json", cookie } };
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
  const userId = `user-packet-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `packet-${counter}@example.com`,
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
    id: `inc-packet-${counter}`,
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

describe("GET /incidents/:id/packet", () => {
  it("404s when no packet exists for the incident", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(app, "GET", "/incidents/does-not-exist/packet", undefined, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("returns the latest packet with a computed confidence", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident();
    const app = buildApp();

    await request(app, "POST", `/incidents/${incident.id}/run`, { service: "payment-service", signals: ["timeout"] }, cookie);

    const { status, json } = await request(app, "GET", `/incidents/${incident.id}/packet`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ packet: { incidentId: string; cards: unknown[] }; confidence: string }>;
    expect(body.data.packet.incidentId).toBe(incident.id);
    expect(body.data.packet.cards.length).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(body.data.confidence);
  });
});
