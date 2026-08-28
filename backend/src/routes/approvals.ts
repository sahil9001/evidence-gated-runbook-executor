import { Hono } from "hono";
import { z } from "zod";
import { apiError, type Env } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import type { RunRow, Store } from "../domain/store";
import type { AuthedEnv } from "../auth/middleware";
import { approveGate, rejectGate, isExpired, type ApprovalGate, type ApprovedGate, type RejectedGate, type ApprovalToken } from "../domain/approval";
import { isStateChanging, type Action } from "../domain/action";
import { executeReadOnly, executeStateChanging, type ExecutionResult } from "../domain/executor";

// `by` is deliberately absent from both schemas — the route handlers below
// take the approver from `c.var.user.email` (the session `requireAuth`
// resolved), never from the request body. If the approver identity isn't in
// the payload, it cannot be forged by whoever sends the request.
const approveBodySchema = z.object({
  reason: z.string().min(1).optional()
});

const rejectBodySchema = z.object({
  reason: z.string().min(1)
});

/**
 * Shared lookup for both approve and reject: resolves the gate and its run
 * (same id — see run.ts), and rules out the two decided-state error cases.
 * Returns either the pair or a Response the caller should return verbatim.
 */
async function loadDecidableGate(
  store: Store,
  id: string,
  nowIso: string
): Promise<{ gate: ApprovalGate; run: RunRow } | Response> {
  const gate = await store.getGate(id);
  if (gate === null) {
    return Response.json(apiError("not_found", `No approval gate found for id "${id}"`), { status: 404 });
  }

  const run = await store.getRun(id);
  if (run === null) {
    return Response.json(apiError("not_found", `No run found for gate "${id}"`), { status: 404 });
  }

  if (run.state !== "awaiting_approval") {
    return Response.json(
      apiError("gate_already_decided", `Gate "${id}" was already decided (run is ${run.state})`),
      { status: 409 }
    );
  }

  if (isExpired(gate, nowIso)) {
    return Response.json(apiError("gate_expired", `Gate "${id}" expired at ${gate.expiresAt}`), { status: 409 });
  }

  return { gate, run };
}

/**
 * Dispatches on the executor's two-function split rather than assuming
 * every proposed action is state-changing. This slice's only runbook
 * proposes a rollback (state-changing), but the route stays honest to the
 * split either way — a read-only proposed action needs no token.
 */
async function executeAction(action: Action, token: ApprovalToken): Promise<ExecutionResult> {
  const now = (): string => new Date().toISOString();
  if (isStateChanging(action)) {
    return executeStateChanging(action, token, { now });
  }
  return executeReadOnly(action, { now });
}

/**
 * Factory rather than a bare `Hono` instance so tests can inject a `Store`
 * that fails or refuses deterministically (e.g. a `decideGate` that always
 * returns `false`) without reaching into module-level state or racing real
 * concurrent requests. Production wiring (`approvalRoutes` below, mounted by
 * index.ts) always uses the default `createD1Store`.
 */
export function createApprovalRoutes(makeStore: (env: Env) => Store = (env) => createD1Store(env.DB)): Hono<AuthedEnv> {
  const routes = new Hono<AuthedEnv>();

  routes.post("/approvals/:id/approve", async (c) => {
    const parsed = await parseJsonBody(c, approveBodySchema);
    if (!parsed.success) return parsed.response;
    const { reason } = parsed.data;
    // The approver is the session `requireAuth` resolved, never something the
    // client sent — see the schema comment above.
    const by = c.var.user.email;
    const id = c.req.param("id");
    const nowIso = new Date().toISOString();

    const store = makeStore(c.env);

    const loaded = await loadDecidableGate(store, id, nowIso);
    if (loaded instanceof Response) return loaded;
    const { gate, run } = loaded;

    const action = await store.getAction(id);
    if (action === null) {
      return c.json(apiError("not_found", `No action found for gate "${id}"`), 404);
    }

    // "Evidence-gated" is the product's central claim, and a disabled button
    // in the dashboard is a UI convenience, not a guarantee — anyone calling
    // this endpoint directly bypasses it. Refuse here, before the atomic
    // decision below, so a rejected approval never marks the run decided.
    //
    // Resolved for THIS run specifically (getPacketByRun), never "whatever
    // the incident's latest packet is" — see the doc comment on
    // Store#getPacketByRun.
    const packet = await store.getPacketByRun(run.id);
    if (packet === null || packet.cards.length === 0) {
      return c.json(apiError("insufficient_evidence", `Gate "${id}" has no evidence and cannot be approved`), 409);
    }

    // Validation (and token minting) happens before the atomic decision too.
    // approveGate is pure — it persists nothing and executes nothing — so
    // computing it early costs nothing on the losing side of a race, and
    // means a validation failure can never strand the run mid-decision.
    let approved: { gate: ApprovedGate; token: ApprovalToken };
    try {
      approved = approveGate(gate, action, { by, at: nowIso, ...(reason === undefined ? {} : { reason }) });
    } catch (error) {
      return c.json(apiError("validation_failed", error instanceof Error ? error.message : "Invalid approval"), 400);
    }
    const { gate: approvedGate, token } = approved;

    // Atomic decision: the run's `awaiting_approval -> approved` claim and
    // the gate's `locked -> approved` write land together, or neither does.
    // Two concurrent approvals can both pass loadDecidableGate's read of
    // run.state — decideGate is the only point that can only ever succeed
    // for one of them. See the doc comment on Store#decideGate for why the
    // previous shape (an independent claim + saveGate, with saveGate's
    // returned boolean ignored) could strand a run approved-but-unexecuted
    // with no retry able to recover it.
    const decided = await store.decideGate(approvedGate, id, nowIso);
    if (!decided) {
      await store.appendAudit({
        id: crypto.randomUUID(),
        runId: id,
        at: nowIso,
        kind: "gate_decision_failed",
        detail: `Gate ${id} approval was refused (lost a race, or the run/gate state changed underneath it); no state was modified`
      });
      return c.json(apiError("gate_already_decided", `Gate "${id}" was already decided`), 409);
    }

    await store.appendAudit({
      id: crypto.randomUUID(),
      runId: id,
      at: nowIso,
      kind: "gate_approved",
      detail: `Gate ${id} approved by ${by}`
    });

    const execution = await executeAction(action, token);

    const executedAt = execution.at;
    await store.updateRunState(id, "executed", executedAt);
    await store.appendAudit({
      id: crypto.randomUUID(),
      runId: id,
      at: executedAt,
      kind: "action_executed",
      detail: `Action ${action.id} executed: ${execution.output}`
    });

    // Qodo finding: the run's final state here is "executed", not
    // "approved" — `gate.state` alone doesn't tell a caller that. Rather
    // than have the console infer it (wrongly), hand back the real value.
    return c.json({ ok: true, data: { gate: approvedGate, execution, runState: "executed" as const } });
  });

  routes.post("/approvals/:id/reject", async (c) => {
    const parsed = await parseJsonBody(c, rejectBodySchema);
    if (!parsed.success) return parsed.response;
    const { reason } = parsed.data;
    // The approver is the session `requireAuth` resolved, never something the
    // client sent — see the schema comment near approveBodySchema.
    const by = c.var.user.email;
    const id = c.req.param("id");
    const nowIso = new Date().toISOString();

    const store = makeStore(c.env);

    const loaded = await loadDecidableGate(store, id, nowIso);
    if (loaded instanceof Response) return loaded;
    const { gate } = loaded;

    // Validated before the decision, same reasoning as approve: rejectGate
    // is pure, so a malformed request is rejected before the run is ever
    // marked decided.
    let rejectedGate: RejectedGate;
    try {
      rejectedGate = rejectGate(gate, { by, at: nowIso, reason });
    } catch (error) {
      return c.json(apiError("validation_failed", error instanceof Error ? error.message : "Invalid rejection"), 400);
    }

    // Same atomic decision as approve, for the same reason: two concurrent
    // decisions on the same gate (reject/reject, or reject racing approve)
    // must not both win, and a refused write must not strand the run.
    const decided = await store.decideGate(rejectedGate, id, nowIso);
    if (!decided) {
      await store.appendAudit({
        id: crypto.randomUUID(),
        runId: id,
        at: nowIso,
        kind: "gate_decision_failed",
        detail: `Gate ${id} rejection was refused (lost a race, or the run/gate state changed underneath it); no state was modified`
      });
      return c.json(apiError("gate_already_decided", `Gate "${id}" was already decided`), 409);
    }

    await store.appendAudit({
      id: crypto.randomUUID(),
      runId: id,
      at: nowIso,
      kind: "gate_rejected",
      detail: `Gate ${id} rejected by ${by}: ${reason}`
    });

    // Same reasoning as approve's `runState` — hand back the run's actual
    // final state rather than have the console infer it from the gate.
    return c.json({ ok: true, data: { gate: rejectedGate, runState: "rejected" as const } });
  });

  return routes;
}

export const approvalRoutes: Hono<AuthedEnv> = createApprovalRoutes();
export default approvalRoutes;
