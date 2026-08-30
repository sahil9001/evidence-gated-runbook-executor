import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { incidentRoutes, MAX_INCIDENT_LIMIT } from "./incidents";
import { MAX_RUN_LIMIT } from "./runs";
import type { IncidentRow } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

function buildApp(): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.route("/", incidentRoutes);
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
async function registeredCookie(): Promise<{ cookie: string; email: string }> {
  counter += 1;
  const store = createD1Store(env.DB);
  const userId = `user-inc-${counter}`;
  const email = `inc-${counter}@example.com`;
  const nowIso = new Date().toISOString();
  await store.createUser({ id: userId, email, passwordHash: "h", salt: "s", createdAt: nowIso });
  const session = await createSession(store, userId, nowIso);
  return { cookie: `rp_session=${session.id}`, email };
}

async function seedIncident(overrides: Partial<IncidentRow> = {}): Promise<IncidentRow> {
  counter += 1;
  const store = createD1Store(env.DB);
  const incident: IncidentRow = {
    id: `inc-list-${counter}`,
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

describe("GET /incidents", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status, json } = await request(app, "GET", "/incidents", undefined);
    expect(status).toBe(401);
    expect((json as ApiErr).error.code).toBe("unauthenticated");
  });

  it("lists incidents newest first", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const older = await seedIncident({ createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = await seedIncident({ createdAt: "2026-01-02T00:00:00.000Z" });

    const { status, json } = await request(app, "GET", "/incidents", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentRow[]>;
    const ids = body.data.map((i) => i.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it("filters by status", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const open = await seedIncident({ status: "open" });
    const resolved = await seedIncident({ status: "resolved" });

    const { status, json } = await request(app, "GET", "/incidents?status=resolved", undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentRow[]>;
    const ids = body.data.map((i) => i.id);
    expect(ids).toContain(resolved.id);
    expect(ids).not.toContain(open.id);
  });

  // Qodo finding: GET /incidents returned every matching incident with no
  // pagination or maximum, unlike the capped run and audit listings. Seeds
  // strictly MORE than MAX_INCIDENT_LIMIT rows directly through the store
  // (bypassing the slower HTTP round trip) so this genuinely exercises the
  // cap rather than coincidentally staying under it.
  it("caps limit at MAX_INCIDENT_LIMIT even when a client asks for more", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    for (let i = 0; i < MAX_INCIDENT_LIMIT + 5; i += 1) await seedIncident();

    const { status, json } = await request(
      app,
      "GET",
      `/incidents?limit=${MAX_INCIDENT_LIMIT + 5000}`,
      undefined,
      cookie
    );
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentRow[]>;
    expect(body.data.length).toBeLessThanOrEqual(MAX_INCIDENT_LIMIT);
  });
});

describe("POST /incidents", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(
      app,
      "POST",
      "/incidents",
      { title: "t", service: "s", signals: ["x"] },
      undefined
    );
    expect(status).toBe(401);
  });

  it("creates an incident with createdBy from the session, ignoring a body-supplied value", async () => {
    const { cookie, email } = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(
      app,
      "POST",
      "/incidents",
      { title: "Checkout down", service: "payment-service", signals: ["timeout"], createdBy: "attacker@evil.com" },
      cookie
    );
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentRow>;
    expect(body.data.createdBy).toBe(email);
    expect(body.data.createdBy).not.toBe("attacker@evil.com");
    expect(body.data.status).toBe("open");
  });

  it("400s on a malformed body", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(app, "POST", "/incidents", { title: "" }, cookie);
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });
});

describe("GET /incidents/:id", () => {
  it("401s with no session cookie", async () => {
    const app = buildApp();
    const { status } = await request(app, "GET", "/incidents/does-not-exist", undefined);
    expect(status).toBe(401);
  });

  it("404s for an unknown id", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const { status, json } = await request(app, "GET", "/incidents/does-not-exist", undefined, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("returns the incident plus its runs", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const incident = await seedIncident();

    const { status, json } = await request(app, "GET", `/incidents/${incident.id}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ incident: IncidentRow; runs: unknown[] }>;
    expect(body.data.incident.id).toBe(incident.id);
    expect(body.data.runs).toEqual([]);
  });

  // Qodo finding: the incident's complete run history came back via
  // listRunsByIncident with no limit, even though the dedicated run listing
  // (GET /runs) is capped at MAX_RUN_LIMIT. Runs are seeded directly through
  // the store (rather than the full run-creation route) purely for test
  // speed — `runs.incident_id` carries no foreign key, so this is a valid
  // way to populate the table for this assertion.
  it("bounds the embedded run list at MAX_RUN_LIMIT, even with a longer history", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const incident = await seedIncident();

    const store = createD1Store(env.DB);
    const overflow = MAX_RUN_LIMIT + 5;
    for (let i = 0; i < overflow; i += 1) {
      const nowIso = new Date(Date.now() + i).toISOString();
      await store.createRun({
        id: `${incident.id}-run-${i}`,
        incidentId: incident.id,
        runbookId: "checkout-failure",
        service: "payment-service",
        state: "collecting",
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: null,
        evidenceGapCount: 0
      });
    }

    const { status, json } = await request(app, "GET", `/incidents/${incident.id}`, undefined, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ incident: IncidentRow; runs: unknown[] }>;
    expect(body.data.runs.length).toBeLessThanOrEqual(MAX_RUN_LIMIT);
    expect(body.data.runs.length).toBeLessThan(overflow);
  });
});
