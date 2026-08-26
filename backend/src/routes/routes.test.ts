import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { beforeAll, describe, it, expect } from "vitest";
import app, { type Env } from "../index";
import { createD1Store } from "../domain/store";
import { createGate } from "../domain/approval";
import { createAction } from "../domain/action";
import { buildPacket } from "../domain/evidence";
import { createRunRoutes } from "./run";
import { createLogSource, createMetricSource, createDeploySource } from "../mcp";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

async function get(path: string): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`);
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

const runBody = { service: "payment-service", signals: ["timeout", "error_rate"] };

describe("POST /incidents/:id/run", () => {
  it("collects evidence, creates a LOCKED gate, and executes nothing", async () => {
    const { status, json } = await post("/incidents/inc-happy/run", runBody);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      run: { id: string; state: string };
      packet: { cards: unknown[] };
      action: { id: string; kind: string };
      gate: { id: string; state: string };
    }>;
    expect(body.ok).toBe(true);
    expect(body.data.packet.cards.length).toBeGreaterThan(0);
    expect(body.data.gate.state).toBe("locked");
    expect(body.data.action.kind).toBe("rollback");
    expect(body.data).not.toHaveProperty("execution");
  });

  it("does not execute anything on the run endpoint (explicit check)", async () => {
    const { json } = await post("/incidents/inc-no-exec/run", runBody);
    const body = json as ApiOk<{ gate: { state: string } }>;
    expect(body.data.gate.state).toBe("locked");
    expect(body.data).not.toHaveProperty("execution");
  });

  it("returns 404 no_matching_runbook when the incident matches no runbook", async () => {
    const { status, json } = await post("/incidents/inc-nomatch/run", {
      service: "unknown-service",
      signals: ["timeout"]
    });
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("no_matching_runbook");
  });

  it("returns 400 validation_failed for a malformed (non-JSON) body", async () => {
    const { status, json } = await post("/incidents/inc-malformed/run", "{not json");
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });

  it("returns 400 validation_failed when required fields are missing", async () => {
    const { status, json } = await post("/incidents/inc-missing-fields/run", { service: "payment-service" });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });
});

describe("POST /incidents/:id/run — evidence honesty (I1)", () => {
  // collectEvidence's `failures` are only observable if something can be
  // made to fail deterministically. createRunRoutes accepts sources as a
  // parameter for exactly this: mount a fresh app whose metrics collector
  // is fed a malformed fixture (the reviewer's own reproduction scenario),
  // while logs and deploys still succeed, so the packet is real but partial.
  it("names the failed source in the response and records one evidence_partial audit entry", async () => {
    const failingMetrics = createMetricSource([{ id: "bad", value: "not-a-number" }]);
    const testApp = new Hono<{ Bindings: Env }>();
    testApp.route("/", createRunRoutes([createLogSource(), failingMetrics, createDeploySource()]));

    const request = new Request("http://localhost/incidents/inc-i1-partial/run", {
      method: "POST",
      body: JSON.stringify(runBody),
      headers: { "content-type": "application/json" }
    });
    const ctx = createExecutionContext();
    const response = await testApp.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as ApiOk<{
      run: { id: string };
      packet: { cards: unknown[] };
      failures: { source: string; message: string }[];
    }>;

    // The packet is still built from what succeeded — it must not be empty.
    expect(body.data.packet.cards.length).toBeGreaterThan(0);

    // But the gap must now be visible: exactly one failure, naming "metrics".
    expect(body.data.failures.map((f) => f.source)).toEqual(["metrics"]);
    expect(body.data.failures[0]?.message).toContain("[metrics]");

    const store = createD1Store(env.DB);
    const audit = await store.listAudit(body.data.run.id);
    const partialEntries = audit.filter((e) => e.kind === "evidence_partial");
    expect(partialEntries).toHaveLength(1);
    expect(partialEntries[0]?.detail).toContain("metrics");
  });

  it("emits no evidence_partial entry when every source succeeds", async () => {
    const incidentId = "inc-i1-complete";
    const { json } = await post(`/incidents/${incidentId}/run`, runBody);
    const body = json as ApiOk<{ run: { id: string }; failures: unknown[] }>;
    expect(body.data.failures).toEqual([]);

    const store = createD1Store(env.DB);
    const audit = await store.listAudit(body.data.run.id);
    expect(audit.some((e) => e.kind === "evidence_partial")).toBe(false);
  });
});

describe("GET /incidents/:id/packet", () => {
  it("returns the packet and its confidence after a run", async () => {
    const incidentId = "inc-packet-1";
    await post(`/incidents/${incidentId}/run`, runBody);

    const { status, json } = await get(`/incidents/${incidentId}/packet`);
    expect(status).toBe(200);
    const body = json as ApiOk<{ packet: { incidentId: string }; confidence: string }>;
    expect(body.data.packet.incidentId).toBe(incidentId);
    expect(["high", "medium", "low"]).toContain(body.data.confidence);
  });

  it("returns 404 not_found for an incident with no packet", async () => {
    const { status, json } = await get("/incidents/inc-nonexistent/packet");
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.error.code).toBe("not_found");
  });
});

describe("approval flow", () => {
  async function runAndGetGateId(incidentId: string): Promise<string> {
    const { json } = await post(`/incidents/${incidentId}/run`, runBody);
    const body = json as ApiOk<{ gate: { id: string } }>;
    return body.data.gate.id;
  }

  it("approving moves the gate to approved and returns an execution result", async () => {
    const gateId = await runAndGetGateId("inc-approve-1");

    const { status, json } = await post(`/approvals/${gateId}/approve`, { by: "sahil", reason: "looks good" });
    expect(status).toBe(200);
    const body = json as ApiOk<{ gate: { state: string }; execution: { executed: boolean } }>;
    expect(body.data.gate.state).toBe("approved");
    expect(body.data.execution).toBeDefined();
    expect(body.data.execution.executed).toBe(true);
  });

  it("persists the approved gate in the store, not just in the response", async () => {
    const gateId = await runAndGetGateId("inc-approve-persist");

    const { status } = await post(`/approvals/${gateId}/approve`, { by: "sahil", reason: "looks good" });
    expect(status).toBe(200);

    const store = createD1Store(env.DB);
    const persisted = await store.getGate(gateId);
    expect(persisted?.state).not.toBe("locked");
    expect(persisted?.state).toBe("approved");
    if (persisted?.state !== "approved") throw new Error("expected approved gate");
    expect(persisted.decidedBy).toBe("sahil");
  });

  it("approving twice returns 409 gate_already_decided", async () => {
    const gateId = await runAndGetGateId("inc-approve-twice");
    await post(`/approvals/${gateId}/approve`, { by: "sahil" });

    const { status, json } = await post(`/approvals/${gateId}/approve`, { by: "sahil" });
    expect(status).toBe(409);
    const body = json as ApiErr;
    expect(body.error.code).toBe("gate_already_decided");
  });

  it("two concurrent approvals: exactly one 200, one 409, and exactly one action_executed audit entry", async () => {
    // Reproduces the TOCTOU race: loadDecidableGate reads run.state, then
    // several awaits later the route writes it back, with no conditional
    // guard in between. Firing both requests via Promise.all (not awaited
    // sequentially) lets both reach the read before either writes.
    const gateId = await runAndGetGateId("inc-approve-race");

    const [first, second] = await Promise.all([
      post(`/approvals/${gateId}/approve`, { by: "sahil" }),
      post(`/approvals/${gateId}/approve`, { by: "priya" })
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    const winnerBody = winner.json as ApiOk<{ execution: { executed: boolean } }>;
    expect(winnerBody.data.execution.executed).toBe(true);

    const loser = first.status === 409 ? first : second;
    const loserBody = loser.json as ApiErr;
    expect(loserBody.error.code).toBe("gate_already_decided");

    const store = createD1Store(env.DB);
    const audit = await store.listAudit(gateId);
    const executedEntries = audit.filter((e) => e.kind === "action_executed");
    expect(executedEntries).toHaveLength(1);
  });

  it("approving an unknown gate id returns 404 not_found", async () => {
    const { status, json } = await post("/approvals/no-such-gate/approve", { by: "sahil" });
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.error.code).toBe("not_found");
  });

  it("rejecting without a reason returns 400 validation_failed", async () => {
    const gateId = await runAndGetGateId("inc-reject-no-reason");

    const { status, json } = await post(`/approvals/${gateId}/reject`, { by: "sahil" });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejecting with an empty reason returns 400 validation_failed", async () => {
    const gateId = await runAndGetGateId("inc-reject-empty-reason");

    const { status, json } = await post(`/approvals/${gateId}/reject`, { by: "sahil", reason: "" });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejecting leaves execution absent and the run state rejected", async () => {
    const gateId = await runAndGetGateId("inc-reject-ok");

    const { status, json } = await post(`/approvals/${gateId}/reject`, { by: "sahil", reason: "not safe" });
    expect(status).toBe(200);
    const body = json as ApiOk<{ gate: { state: string } }>;
    expect(body.data.gate.state).toBe("rejected");
    expect(body.data).not.toHaveProperty("execution");

    // a second decision (approve) must now see it as already decided
    const second = await post(`/approvals/${gateId}/approve`, { by: "sahil" });
    expect(second.status).toBe(409);
  });

  it("approving an expired gate returns 409 gate_expired", async () => {
    // The route stamps `now` from the real clock at request time, so an
    // expired gate can't be produced by waiting out a 15-minute TTL in a
    // unit test. Instead we seed the store directly with a gate whose
    // createdAt is far enough in the past that its expiresAt has already
    // elapsed relative to the real clock, then hit the HTTP layer.
    const store = createD1Store(env.DB);
    const id = "expired-gate-1";
    const longAgo = "2020-01-01T00:00:00.000Z";
    const action = createAction({
      id,
      kind: "rollback",
      target: "payment-service",
      params: { commit: "8f31c2b" },
      reversible: true,
      description: "Roll back payment-service to 8f31c2b"
    });
    const gate = createGate({ id, actionId: id, createdAt: longAgo, ttlMs: 15 * 60 * 1000 });

    await store.createRun({
      id,
      incidentId: "inc-approve-expired",
      runbookId: "checkout-failure",
      service: "payment-service",
      state: "awaiting_approval",
      createdAt: longAgo,
      updatedAt: longAgo
    });
    await store.saveAction(action, id);
    await store.saveGate(gate, id);

    const { status, json } = await post(`/approvals/${id}/approve`, { by: "sahil" });
    expect(status).toBe(409);
    const body = json as ApiErr;
    expect(body.error.code).toBe("gate_expired");
  });

  it("refuses to approve a gate whose packet has zero evidence cards (I3)", async () => {
    // "Evidence-gated" was only enforced by a disabled button in the
    // dashboard; the server had no equivalent check. Seed a run whose
    // packet has cards: [] directly (every collector failing, or a fixture
    // regression, produces exactly this on the real code path) and confirm
    // POST /approve refuses it server-side.
    const store = createD1Store(env.DB);
    const id = "no-evidence-gate-1";
    const nowIso = new Date().toISOString();
    const action = createAction({
      id,
      kind: "rollback",
      target: "payment-service",
      params: { commit: "8f31c2b" },
      reversible: true,
      description: "Roll back payment-service to 8f31c2b"
    });
    const gate = createGate({ id, actionId: id, createdAt: nowIso, ttlMs: 15 * 60 * 1000 });
    const emptyPacket = buildPacket({
      id: "packet-no-evidence-1",
      incidentId: "inc-no-evidence-1",
      runbookId: "checkout-failure",
      cards: [],
      builtAt: nowIso
    });

    await store.createRun({
      id,
      incidentId: "inc-no-evidence-1",
      runbookId: "checkout-failure",
      service: "payment-service",
      state: "awaiting_approval",
      createdAt: nowIso,
      updatedAt: nowIso
    });
    await store.savePacket(emptyPacket, id);
    await store.saveAction(action, id);
    await store.saveGate(gate, id);

    const { status, json } = await post(`/approvals/${id}/approve`, { by: "sahil" });
    expect(status).toBe(409);
    const body = json as ApiErr;
    expect(body.error.code).toBe("insufficient_evidence");

    // Refused BEFORE the atomic claim: the run must still be awaiting
    // approval, the gate must still be locked, and nothing was executed or
    // audited — a rejected approval must leave no trace of having decided.
    const run = await store.getRun(id);
    expect(run?.state).toBe("awaiting_approval");
    const persistedGate = await store.getGate(id);
    expect(persistedGate?.state).toBe("locked");
    const audit = await store.listAudit(id);
    expect(audit).toHaveLength(0);
    expect(audit.some((e) => e.kind === "action_executed")).toBe(false);
  });

  it("approving with a whitespace-only `by` returns 400 validation_failed, not 500 (I2)", async () => {
    // Zod's z.string().min(1) accepts whitespace; the domain guard's
    // .trim() === "" check is what actually catches this, and it must map
    // to 400, not fall through app.onError as a 500.
    const gateId = await runAndGetGateId("inc-approve-whitespace-by");

    const { status, json } = await post(`/approvals/${gateId}/approve`, { by: "   " });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");

    // The run must not be stranded in "approved" with no persisted decision.
    const store = createD1Store(env.DB);
    const run = await store.getRun(gateId);
    expect(run?.state).toBe("awaiting_approval");
  });

  it("rejecting with a whitespace-only reason returns 400 validation_failed, not 500 (I2)", async () => {
    const gateId = await runAndGetGateId("inc-reject-whitespace-reason");

    const { status, json } = await post(`/approvals/${gateId}/reject`, { by: "sahil", reason: "   " });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");

    const store = createD1Store(env.DB);
    const run = await store.getRun(gateId);
    expect(run?.state).toBe("awaiting_approval");
  });
});
