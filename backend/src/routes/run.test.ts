import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { CollectorError, type EvidenceSource } from "../mcp/source";
import { ALL_SOURCES } from "../mcp";
import type { IncidentRow } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

function buildApp(sources?: readonly EvidenceSource[]): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.route("/", createRunRoutes(sources));
  return app;
}

async function post(
  app: Hono<AuthedEnv>,
  path: string,
  body: unknown,
  cookie: string
): Promise<{ status: number; json: unknown }> {
  const req = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body)
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

let counter = 0;
async function registeredCookie(): Promise<string> {
  counter += 1;
  const store = createD1Store(env.DB);
  const userId = `user-run-${counter}`;
  const nowIso = new Date().toISOString();
  await store.createUser({
    id: userId,
    email: `run-${counter}@example.com`,
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
    id: `inc-run-${counter}`,
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

describe("POST /incidents/:id/run", () => {
  it("404s for an incident that was never created", async () => {
    const cookie = await registeredCookie();
    const app = buildApp();
    const { status, json } = await post(app, "/incidents/does-not-exist/run", {}, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("400s on a malformed body", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident();
    const app = buildApp();
    // The route no longer reads `service`/`signals` from the body (see
    // below), so a body must merely BE a JSON object — anything else
    // (a string here) still fails schema validation.
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, "not-an-object", cookie);
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("404s no_matching_runbook when no runbook matches the incident's own service/signals", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident({ service: "some-other-service" });
    const app = buildApp();
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, {}, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("no_matching_runbook");
  });

  it("uses the incident's own service/signals, ignoring body-supplied values naming a different service", async () => {
    const cookie = await registeredCookie();
    // Incident is genuinely about payment-service/timeout (matches the
    // fixture runbook); the request body claims an unrelated service. If
    // the body were trusted, this would either 404 no_matching_runbook (no
    // runbook matches "some-other-service") or — worse — attach evidence
    // and a proposed action for a service the incident was never about.
    const incident = await seedIncident();
    const app = buildApp(ALL_SOURCES);
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, {
      service: "some-other-service",
      signals: ["nothing-matches"]
    }, cookie);

    expect(status).toBe(200);
    const body = json as ApiOk<{ run: { service: string }; action: { target: string } }>;
    expect(body.data.run.service).toBe("payment-service");
    expect(body.data.action.target).toBe("payment-service");
  });

  it("collects evidence, locks a gate, and executes NOTHING — no `execution` field in the response", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident();
    const app = buildApp(ALL_SOURCES);
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, {}, cookie);

    expect(status).toBe(200);
    const body = json as ApiOk<{
      run: { id: string; state: string };
      packet: { cards: unknown[] };
      action: { isStateChanging: boolean };
      gate: { state: string };
      failures: unknown[];
    }>;
    expect(body.data.run.state).toBe("awaiting_approval");
    expect(body.data.packet.cards.length).toBeGreaterThan(0);
    expect(body.data.action.isStateChanging).toBe(true);
    expect(body.data.gate.state).toBe("locked");
    expect(body.data).not.toHaveProperty("execution");
    expect(JSON.stringify(body.data)).not.toContain('"execution"');
  });

  it("returns failures and appends one evidence_partial audit entry when a source fails", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident();
    const failingSource: EvidenceSource = {
      kind: "metrics",
      collect: async () => {
        throw new CollectorError("metrics", "upstream unavailable");
      }
    };
    const app = buildApp([failingSource]);
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, {}, cookie);

    expect(status).toBe(200);
    const body = json as ApiOk<{ run: { id: string }; failures: { source: string; message: string }[] }>;
    expect(body.data.failures).toHaveLength(1);
    expect(body.data.failures[0]?.source).toBe("metrics");

    const store = createD1Store(env.DB);
    const audit = await store.listAudit(body.data.run.id);
    const partials = audit.filter((entry) => entry.kind === "evidence_partial");
    expect(partials).toHaveLength(1);
  });

  it("appends evidence_partial when a source returns cleanly but contributes no cards", async () => {
    const cookie = await registeredCookie();
    const incident = await seedIncident();
    // Succeeds, throws nothing, and yields nothing. This leaves exactly the
    // same hole in the packet as a thrown CollectorError, and GET /runs/:id
    // reports it as a missing source either way -- so the audit log has to
    // agree. It previously recorded nothing here.
    const emptySource: EvidenceSource = {
      kind: "metrics",
      collect: async () => []
    };
    const app = buildApp([emptySource]);
    const { status, json } = await post(app, `/incidents/${incident.id}/run`, {}, cookie);

    expect(status).toBe(200);
    const body = json as ApiOk<{ run: { id: string } }>;

    const store = createD1Store(env.DB);
    const audit = await store.listAudit(body.data.run.id);
    const partials = audit.filter((entry) => entry.kind === "evidence_partial");
    expect(partials).toHaveLength(1);
    expect(partials[0]?.detail).toContain("metrics");
  });
});
