import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import type { RunRow } from "../domain/store";
import type { AuthedEnv } from "../auth/middleware";
import {
  approveGate,
  rejectGate,
  isExpired,
  ApprovalInputError,
  type ApprovalGate,
  type ApprovedGate,
  type RejectedGate,
  type ApprovalToken
} from "../domain/approval";
import { isStateChanging, type Action } from "../domain/action";
import { executeReadOnly, executeStateChanging } from "../domain/executor";

// `by` is deliberately absent from both schemas — see the route handlers
// below, which take the approver from `c.var.user.email` (the session
// requireAuth resolved), never from the request body. The same reasoning
// that makes `ApprovalToken` a branded type nobody outside `approval.ts` can
// construct: if the approver identity isn't in the payload, it cannot be
// forged by whoever sends the request.
const approveBodySchema = z.object({
  reason: z.string().min(1).optional()
});

const rejectBodySchema = z.object({
  reason: z.string().min(1)
});

export const approvalRoutes = new Hono<AuthedEnv>();

/**
 * Shared lookup for both approve and reject: resolves the gate and its run
 * (same id — see run.ts), and rules out the two decided-state error cases.
 * Returns either the pair or a Response the caller should return verbatim.
 */
async function loadDecidableGate(
  store: ReturnType<typeof createD1Store>,
  id: string,
  nowIso: string,
  jsonError: (code: string, message: string, status: 404 | 409) => Response
): Promise<{ gate: ApprovalGate; run: RunRow } | Response> {
  const gate = await store.getGate(id);
  if (gate === null) {
    return jsonError("not_found", `No approval gate found for id "${id}"`, 404);
  }

  const run = await store.getRun(id);
  if (run === null) {
    return jsonError("not_found", `No run found for gate "${id}"`, 404);
  }

  if (run.state !== "awaiting_approval") {
    return jsonError("gate_already_decided", `Gate "${id}" was already decided (run is ${run.state})`, 409);
  }

  if (isExpired(gate, nowIso)) {
    return jsonError("gate_expired", `Gate "${id}" expired at ${gate.expiresAt}`, 409);
  }

  return { gate, run };
}

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
  const jsonError = (code: string, message: string, status: 404 | 409): Response =>
    c.json(apiError(code, message), status);

  const loaded = await loadDecidableGate(store, id, nowIso, jsonError);
  if (loaded instanceof Response) return loaded;
  const { gate, run } = loaded;

  const action = await store.getAction(id);
  if (action === null) {
    return c.json(apiError("not_found", `No action found for gate "${id}"`), 404);
  }

  // I3: "evidence-gated" is the product's central claim, and a disabled
  // button in the dashboard is a UI convenience, not a guarantee — anyone
  // calling this endpoint directly bypasses it. Refuse here, before the
  // atomic claim below, so a rejected approval never marks the run decided.
  const packet = await store.getPacketByIncident(run.incidentId);
  if (packet === null || packet.cards.length === 0) {
    return c.json(
      apiError("insufficient_evidence", `Gate "${id}" has no evidence and cannot be approved`),
      409
    );
  }

  // Input validation (and token minting) happens before the atomic claim
  // too. approveGate is pure — it persists nothing and executes nothing —
  // so computing it early costs nothing on the losing side of a race. `by`
  // can no longer be malformed (it comes from the session, not the request
  // body), but approveGate's guard is defence in depth either way, and
  // keeping validation ahead of the claim means it still can't strand the
  // run mid-decision.
  let approved: { gate: ApprovedGate; token: ApprovalToken };
  try {
    approved = approveGate(gate, {
      by,
      at: nowIso,
      ...(reason === undefined ? {} : { reason })
    });
  } catch (error) {
    if (error instanceof ApprovalInputError) {
      return c.json(apiError("validation_failed", error.message), 400);
    }
    throw error;
  }
  const { gate: approvedGate, token } = approved;

  // Atomic claim, before persisting the decision or executing anything.
  // Two concurrent approvals can both pass loadDecidableGate's read of
  // run.state — this conditional UPDATE is the only point that can only
  // ever succeed for one of them (`meta.changes === 1`). The loser gets
  // 409 here and never reaches executeAction.
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

/**
 * Dispatches on the executor's two-function split rather than assuming
 * every proposed action is state-changing. This slice's only runbook
 * proposes a rollback (state-changing), but the route stays honest to the
 * split either way — a read-only proposed action needs no token.
 */
async function executeAction(
  action: Action,
  token: Parameters<typeof executeStateChanging>[1]
): ReturnType<typeof executeStateChanging> {
  const now = (): string => new Date().toISOString();
  if (isStateChanging(action)) {
    return executeStateChanging(action, token, { now });
  }
  return executeReadOnly(action, { now });
}

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
  const jsonError = (code: string, message: string, status: 404 | 409): Response =>
    c.json(apiError(code, message), status);

  const loaded = await loadDecidableGate(store, id, nowIso, jsonError);
  if (loaded instanceof Response) return loaded;
  const { gate } = loaded;

  // Validated before the claim, same reasoning as approve: rejectGate is
  // pure, so a malformed request (I2: whitespace-only `reason` — `by` can no
  // longer be malformed, see above) is rejected before the run is ever
  // marked decided.
  let rejectedGate: RejectedGate;
  try {
    rejectedGate = rejectGate(gate, { by, at: nowIso, reason });
  } catch (error) {
    if (error instanceof ApprovalInputError) {
      return c.json(apiError("validation_failed", error.message), 400);
    }
    throw error;
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
