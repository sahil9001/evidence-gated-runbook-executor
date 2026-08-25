import { Hono } from "hono";
import { z } from "zod";
import { apiError, type Env } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store, type RunRow } from "../domain/store";
import { approveGate, rejectGate, isExpired, type ApprovalGate } from "../domain/approval";
import { isStateChanging, type Action } from "../domain/action";
import { executeReadOnly, executeStateChanging } from "../domain/executor";

const approveBodySchema = z.object({
  by: z.string().min(1),
  reason: z.string().min(1).optional()
});

const rejectBodySchema = z.object({
  by: z.string().min(1),
  reason: z.string().min(1)
});

export const approvalRoutes = new Hono<{ Bindings: Env }>();

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
  const { by, reason } = parsed.data;
  const id = c.req.param("id");
  const nowIso = new Date().toISOString();

  const store = createD1Store(c.env.DB);
  const jsonError = (code: string, message: string, status: 404 | 409): Response =>
    c.json(apiError(code, message), status);

  const loaded = await loadDecidableGate(store, id, nowIso, jsonError);
  if (loaded instanceof Response) return loaded;
  const { gate } = loaded;

  const action = await store.getAction(id);
  if (action === null) {
    return c.json(apiError("not_found", `No action found for gate "${id}"`), 404);
  }

  const { gate: approvedGate, token } = approveGate(gate, {
    by,
    at: nowIso,
    ...(reason === undefined ? {} : { reason })
  });

  await store.saveGate(approvedGate, id);
  await store.updateRunState(id, "approved", nowIso);
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
  const { by, reason } = parsed.data;
  const id = c.req.param("id");
  const nowIso = new Date().toISOString();

  const store = createD1Store(c.env.DB);
  const jsonError = (code: string, message: string, status: 404 | 409): Response =>
    c.json(apiError(code, message), status);

  const loaded = await loadDecidableGate(store, id, nowIso, jsonError);
  if (loaded instanceof Response) return loaded;
  const { gate } = loaded;

  const rejectedGate = rejectGate(gate, { by, at: nowIso, reason });

  await store.saveGate(rejectedGate, id);
  await store.updateRunState(id, "rejected", nowIso);
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
