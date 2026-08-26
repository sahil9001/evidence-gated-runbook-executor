import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import app from "../index";
import { createD1Store } from "../domain/store";
import { createGate } from "../domain/approval";
import { createAction } from "../domain/action";

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
});
