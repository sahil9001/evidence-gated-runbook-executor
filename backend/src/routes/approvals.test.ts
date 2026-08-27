import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "../store/d1";
import { createSession } from "../auth/session";
import { requireAuth, type AuthedEnv } from "../auth/middleware";
import { createRunRoutes } from "./run";
import { createApprovalRoutes } from "./approvals";
import { ALL_SOURCES } from "../mcp";
import type { IncidentRow, Store } from "../domain/store";
import type { ApprovedGate, RejectedGate } from "../domain/approval";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string } };

function buildApp(sources = ALL_SOURCES): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.use("/approvals/*", requireAuth);
  app.route("/", createRunRoutes(sources));
  app.route("/", createApprovalRoutes());
  return app;
}

/**
 * Builds an app whose approval routes see a `Store` wrapping the real D1
 * store but with `decideGate` forced to always refuse (return `false`
 * without mutating anything) — simulating the D1 write being rejected (a
 * lost race, a dropped connection, ...) at exactly the point Finding 1
 * describes, deterministically rather than by trying to win a real
 * concurrency race. `/incidents/*` still uses the real store so evidence
 * collection and run creation behave normally; only the approve/reject
 * decision itself is made to fail.
 */
function buildAppWithFailingDecide(sources = ALL_SOURCES): Hono<AuthedEnv> {
  const app = new Hono<AuthedEnv>();
  app.use("/incidents/*", requireAuth);
  app.use("/approvals/*", requireAuth);
  app.route("/", createRunRoutes(sources));
  app.route(
    "/",
    createApprovalRoutes((env) => {
      const real = createD1Store(env.DB);
      const failing: Store = {
        ...real,
        decideGate: async (_gate: ApprovedGate | RejectedGate, _runId: string, _at: string) => false
      };
      return failing;
    })
  );
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

const post = (app: Hono<AuthedEnv>, path: string, body: unknown, cookie: string): ReturnType<typeof request> =>
  request(app, "POST", path, body, cookie);

let counter = 0;

async function registeredCookie(): Promise<{ cookie: string; email: string }> {
  counter += 1;
  const store = createD1Store(env.DB);
  const userId = `user-appr-${counter}`;
  const email = `appr-${counter}@example.com`;
  const nowIso = new Date().toISOString();
  await store.createUser({ id: userId, email, passwordHash: "h", salt: "s", createdAt: nowIso });
  const session = await createSession(store, userId, nowIso);
  return { cookie: `rp_session=${session.id}`, email };
}

async function seedIncident(): Promise<IncidentRow> {
  counter += 1;
  const store = createD1Store(env.DB);
  const incident: IncidentRow = {
    id: `inc-appr-${counter}`,
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

/** Runs the checkout-failure runbook end to end and returns the run/gate id
 * (they share one id — see run.ts). `sources` defaults to the real fixture
 * collectors so the resulting packet has evidence, unless a test needs an
 * empty packet. Accepts an existing incident so a test can run the runbook
 * more than once against the SAME incident (e.g. to prove one run's gate
 * decision only ever depends on that run's own evidence). */
async function seedAwaitingApprovalGate(
  app: Hono<AuthedEnv>,
  cookie: string,
  incident?: IncidentRow
): Promise<string> {
  const targetIncident = incident ?? (await seedIncident());
  const { json } = await post(app, `/incidents/${targetIncident.id}/run`, {
    service: "payment-service",
    signals: ["timeout"]
  }, cookie);
  const body = json as ApiOk<{ run: { id: string } }>;
  return body.data.run.id;
}

describe("POST /approvals/:id/approve", () => {
  it("404s for an unknown gate id", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const { status, json } = await post(app, "/approvals/does-not-exist/approve", {}, cookie);
    expect(status).toBe(404);
    expect((json as ApiErr).error.code).toBe("not_found");
  });

  it("409s insufficient_evidence for a gate whose packet has no cards", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp([]); // no evidence sources at all -> zero-card packet
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/approve`, {}, cookie);
    expect(status).toBe(409);
    expect((json as ApiErr).error.code).toBe("insufficient_evidence");

    // Refusing on insufficient evidence must not strand the run as decided.
    const store = createD1Store(env.DB);
    const run = await store.getRun(id);
    expect(run?.state).toBe("awaiting_approval");
  });

  it("approves, mints and spends a token, and executes the action — the response carries the executor's output", async () => {
    const { cookie, email } = await registeredCookie();
    const app = buildApp();
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/approve`, {}, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      gate: { state: string; decidedBy: string };
      execution: { executed: boolean; dryRun: boolean; output: string };
    }>;
    expect(body.data.gate.state).toBe("approved");
    expect(body.data.gate.decidedBy).toBe(email);
    expect(body.data.execution.executed).toBe(true);
    expect(body.data.execution.dryRun).toBe(false);

    const store = createD1Store(env.DB);
    const run = await store.getRun(id);
    expect(run?.state).toBe("executed");

    const audit = await store.listAudit(id);
    expect(audit.some((entry) => entry.kind === "gate_approved")).toBe(true);
    expect(audit.filter((entry) => entry.kind === "action_executed")).toHaveLength(1);
  });

  it("409s gate_already_decided on a second approve of the same gate", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const id = await seedAwaitingApprovalGate(app, cookie);

    await post(app, `/approvals/${id}/approve`, {}, cookie);
    const { status, json } = await post(app, `/approvals/${id}/approve`, {}, cookie);
    expect(status).toBe(409);
    expect((json as ApiErr).error.code).toBe("gate_already_decided");
  });

  it(
    "under genuine concurrency, exactly one of two simultaneous approvals wins, and exactly one action_executed audit entry is written",
    async () => {
      const { cookie } = await registeredCookie();
      const app = buildApp();
      const id = await seedAwaitingApprovalGate(app, cookie);

      // Promise.all, not sequential awaits: both requests are in flight at
      // once, racing the same atomic claim (`updateRunState` with
      // `expectedState`). A sequential test (await, then await) can never
      // exercise that race — it would pass even if the claim weren't atomic.
      const [r1, r2] = await Promise.all([
        post(app, `/approvals/${id}/approve`, {}, cookie),
        post(app, `/approvals/${id}/approve`, {}, cookie)
      ]);

      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const winner = r1.status === 200 ? r1 : r2;
      const loser = r1.status === 200 ? r2 : r1;
      expect((winner.json as ApiOk<unknown>).ok).toBe(true);
      expect((loser.json as ApiErr).error.code).toBe("gate_already_decided");

      const store = createD1Store(env.DB);
      const run = await store.getRun(id);
      expect(run?.state).toBe("executed");

      const audit = await store.listAudit(id);
      expect(audit.filter((entry) => entry.kind === "action_executed")).toHaveLength(1);
      expect(audit.filter((entry) => entry.kind === "gate_approved")).toHaveLength(1);
    }
  );

  // Evidence must be resolved for THIS run specifically, never "whatever
  // the incident's latest packet is" — otherwise a later run on the same
  // incident can flip whether an earlier run's gate is approvable.
  it(
    "stays refused for an empty-evidence run even after a LATER run on the same incident collected evidence",
    async () => {
      const { cookie } = await registeredCookie();
      const incident = await seedIncident();

      const emptyApp = buildApp([]); // forces a zero-card packet
      const emptyRunId = await seedAwaitingApprovalGate(emptyApp, cookie, incident);

      // A later run on the SAME incident, with real evidence.
      const evidenceApp = buildApp(ALL_SOURCES);
      await seedAwaitingApprovalGate(evidenceApp, cookie, incident);

      // Approving the FIRST (empty-evidence) run's gate must still be
      // refused — the incident's latest packet (from the second run) having
      // cards must not matter.
      const { status, json } = await post(emptyApp, `/approvals/${emptyRunId}/approve`, {}, cookie);
      expect(status).toBe(409);
      expect((json as ApiErr).error.code).toBe("insufficient_evidence");

      const store = createD1Store(env.DB);
      expect((await store.getRun(emptyRunId))?.state).toBe("awaiting_approval");
    }
  );

  it(
    "approves a run based on its own evidence even when a LATER run on the same incident has an empty packet",
    async () => {
      const { cookie } = await registeredCookie();
      const incident = await seedIncident();

      const evidenceApp = buildApp(ALL_SOURCES);
      const runId = await seedAwaitingApprovalGate(evidenceApp, cookie, incident);

      // A later run on the SAME incident, with an empty packet.
      const emptyApp = buildApp([]);
      await seedAwaitingApprovalGate(emptyApp, cookie, incident);

      // The FIRST run's own evidence is what decides its gate — the
      // incident's latest packet (from the second, empty-evidence run) must
      // not matter.
      const { status, json } = await post(evidenceApp, `/approvals/${runId}/approve`, {}, cookie);
      expect(status).toBe(200);
      expect((json as ApiOk<{ gate: { state: string } }>).data.gate.state).toBe("approved");

      const store = createD1Store(env.DB);
      expect((await store.getRun(runId))?.state).toBe("executed");
    }
  );

  // Finding 1: a refused gate decision must not report success, must not
  // strand the run approved-but-undecided, and must leave a trace.
  it("a refused decideGate does not produce a 200, leaves the run awaiting_approval, and is audited", async () => {
    const { cookie } = await registeredCookie();
    const app = buildAppWithFailingDecide();
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/approve`, {}, cookie);
    expect(status).not.toBe(200);
    expect((json as ApiErr).error.code).toBe("gate_already_decided");

    const store = createD1Store(env.DB);
    // The run must never end up "approved" (or any other decided state)
    // while its gate stays locked — a state no retry could resolve, since a
    // retry's loadDecidableGate refuses as soon as run.state isn't
    // awaiting_approval.
    const run = await store.getRun(id);
    expect(run?.state).toBe("awaiting_approval");
    const gate = await store.getGate(id);
    expect(gate?.state).toBe("locked");

    // The audit trail shows what happened, and nothing claims the action
    // executed.
    const audit = await store.listAudit(id);
    expect(audit.some((entry) => entry.kind === "gate_decision_failed")).toBe(true);
    expect(audit.some((entry) => entry.kind === "gate_approved")).toBe(false);
    expect(audit.some((entry) => entry.kind === "action_executed")).toBe(false);

    // And a retry against a store that actually works succeeds cleanly —
    // the run was never stranded.
    const workingApp = buildApp();
    const retry = await post(workingApp, `/approvals/${id}/approve`, {}, cookie);
    expect(retry.status).toBe(200);
    expect((await store.getRun(id))?.state).toBe("executed");
  });
});

describe("POST /approvals/:id/reject", () => {
  it("400s when reason is missing", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/reject`, {}, cookie);
    expect(status).toBe(400);
    expect((json as ApiErr).error.code).toBe("validation_failed");
  });

  it("rejects without executing anything, using the session identity for `by`", async () => {
    const { cookie, email } = await registeredCookie();
    const app = buildApp();
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/reject`, { reason: "not confident yet" }, cookie);
    expect(status).toBe(200);
    const body = json as ApiOk<{ gate: { state: string; decidedBy: string; reason: string } }>;
    expect(body.data.gate.state).toBe("rejected");
    expect(body.data.gate.decidedBy).toBe(email);
    expect(body.data.gate.reason).toBe("not confident yet");

    const store = createD1Store(env.DB);
    const run = await store.getRun(id);
    expect(run?.state).toBe("rejected");
    const audit = await store.listAudit(id);
    expect(audit.some((entry) => entry.kind === "action_executed")).toBe(false);
  });

  it("409s gate_already_decided when the gate was already approved", async () => {
    const { cookie } = await registeredCookie();
    const app = buildApp();
    const id = await seedAwaitingApprovalGate(app, cookie);

    await post(app, `/approvals/${id}/approve`, {}, cookie);
    const { status, json } = await post(app, `/approvals/${id}/reject`, { reason: "too late" }, cookie);
    expect(status).toBe(409);
    expect((json as ApiErr).error.code).toBe("gate_already_decided");
  });

  // Finding 1, reject side: same requirement as approve — a refused
  // decideGate must not report success and must not strand the run.
  it("a refused decideGate does not produce a 200 and leaves the run awaiting_approval", async () => {
    const { cookie } = await registeredCookie();
    const app = buildAppWithFailingDecide();
    const id = await seedAwaitingApprovalGate(app, cookie);

    const { status, json } = await post(app, `/approvals/${id}/reject`, { reason: "no" }, cookie);
    expect(status).not.toBe(200);
    expect((json as ApiErr).error.code).toBe("gate_already_decided");

    const store = createD1Store(env.DB);
    expect((await store.getRun(id))?.state).toBe("awaiting_approval");
    expect((await store.getGate(id))?.state).toBe("locked");
    const audit = await store.listAudit(id);
    expect(audit.some((entry) => entry.kind === "gate_decision_failed")).toBe(true);
    expect(audit.some((entry) => entry.kind === "gate_rejected")).toBe(false);
  });
});
