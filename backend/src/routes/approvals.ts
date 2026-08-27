import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import type { RunRow } from "../domain/store";
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

type Store = ReturnType<typeof createD1Store>;

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

export const approvalRoutes = new Hono<AuthedEnv>();

approvalRoutes.post("/approvals/:id/approve", async (c) => {
  const parsed = await parseJsonBody(c, approveBodySchema);
  if (!parsed.success) return parsed.response;
  const { reason } = parsed.data;
  // The approver is the session `requireAuth` resolved, never something the
  // client sent — see the schema comment above.
  const by = c.var.user.email;
  const id = c.req.param("id");
  const nowIso = new Date().toISOString();

  const store = createD1Store(c.env.DB);

  const loaded = await loadDecidableGate(store, id, nowIso);
  if (loaded instanceof Response) return loaded;
  const { gate, run } = loaded;

  const action = await store.getAction(id);
  if (action === null) {
    return c.json(apiError("not_found", `No action found for gate "${id}"`), 404);
  }

  // "Evidence-gated" is the product's central claim, and a disabled button
  // in the dashboard is a UI convenience, not a guarantee — anyone calling
  // this endpoint directly bypasses it. Refuse here, before the atomic claim
  // below, so a rejected approval never marks the run decided.
  //
  // Resolved for THIS run specifically (getPacketByRun), never "whatever the
  // incident's latest packet is" — see the doc comment on
  // Store#getPacketByRun. Using getPacketByIncident here let a later,
  // unrelated run on the same incident (empty or otherwise) determine
  // whether this run's gate could be approved, which defeats the evidence
  // gate: an empty-evidence run could ride a later run's non-empty packet to
  // approval, and a run that genuinely collected evidence could be wrongly
  // blocked by a later, unrelated empty one.
  const packet = await store.getPacketByRun(run.id);
  if (packet === null || packet.cards.length === 0) {
    return c.json(apiError("insufficient_evidence", `Gate "${id}" has no evidence and cannot be approved`), 409);
  }

  // Validation (and token minting) happens before the atomic claim too.
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

  // Atomic claim, before persisting the decision or executing anything. Two
  // concurrent approvals can both pass loadDecidableGate's read of
  // run.state — this conditional UPDATE is the only point that can only
  // ever succeed for one of them. The loser gets 409 here and never reaches
  // executeAction.
  const claimed = await store.updateRunState(id, "approved", nowIso, "awaiting_approval");
  if (!claimed) {
    return c.json(apiError("gate_already_decided", `Gate "${id}" was already decided`), 409);
  }

  await store.saveGate(approvedGate, id);
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

  return c.json({ ok: true, data: { gate: approvedGate, execution } });
});

approvalRoutes.post("/approvals/:id/reject", async (c) => {
  const parsed = await parseJsonBody(c, rejectBodySchema);
  if (!parsed.success) return parsed.response;
  const { reason } = parsed.data;
  // The approver is the session `requireAuth` resolved, never something the
  // client sent — see the schema comment near approveBodySchema.
  const by = c.var.user.email;
  const id = c.req.param("id");
  const nowIso = new Date().toISOString();

  const store = createD1Store(c.env.DB);

  const loaded = await loadDecidableGate(store, id, nowIso);
  if (loaded instanceof Response) return loaded;
  const { gate } = loaded;

  // Validated before the claim, same reasoning as approve: rejectGate is
  // pure, so a malformed request is rejected before the run is ever marked
  // decided.
  let rejectedGate: RejectedGate;
  try {
    rejectedGate = rejectGate(gate, { by, at: nowIso, reason });
  } catch (error) {
    return c.json(apiError("validation_failed", error instanceof Error ? error.message : "Invalid rejection"), 400);
  }

  // Same atomic claim as approve, for the same reason: two concurrent
  // decisions on the same gate (reject/reject, or reject racing approve)
  // must not both win.
  const claimed = await store.updateRunState(id, "rejected", nowIso, "awaiting_approval");
  if (!claimed) {
    return c.json(apiError("gate_already_decided", `Gate "${id}" was already decided`), 409);
  }

  await store.saveGate(rejectedGate, id);
  await store.appendAudit({
    id: crypto.randomUUID(),
    runId: id,
    at: nowIso,
    kind: "gate_rejected",
    detail: `Gate ${id} rejected by ${by}: ${reason}`
  });

  return c.json({ ok: true, data: { gate: rejectedGate } });
});

export default approvalRoutes;
