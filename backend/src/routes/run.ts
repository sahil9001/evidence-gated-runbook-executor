import { Hono } from "hono";
import { z } from "zod";
import { apiError, type Env } from "../index";
import { parseJsonBody } from "./http";
import { loadRunbook, matchRunbook } from "../domain/runbook";
import { collectEvidence, ScopeViolationError } from "../domain/packet-builder";
import { createAction } from "../domain/action";
import { createGate } from "../domain/approval";
import { createD1Store } from "../domain/store";
import { ALL_SOURCES } from "../mcp";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

/**
 * This vertical slice ships exactly one runbook. A real deployment would
 * load every file under `testing/runbooks` (or a real runbook store); the
 * `matchRunbook` contract is unchanged either way.
 */
const RUNBOOKS = [loadRunbook(checkoutFailureRaw)];

/**
 * No TTL was specified for the route layer by the brief. 15 minutes matches
 * the value already used throughout the T3/T7/T8 fixtures and tests.
 */
const GATE_TTL_MS = 15 * 60 * 1000;

const runBodySchema = z.object({
  service: z.string().min(1),
  signals: z.array(z.string().min(1))
});

export const runRoutes = new Hono<{ Bindings: Env }>();

runRoutes.post("/incidents/:id/run", async (c) => {
  const parsed = await parseJsonBody(c, runBodySchema);
  if (!parsed.success) return parsed.response;
  const { service, signals } = parsed.data;
  const incidentId = c.req.param("id");

  const runbook = matchRunbook(RUNBOOKS, { service, signals });
  if (runbook === null) {
    return c.json(
      apiError(
        "no_matching_runbook",
        `No runbook matches service "${service}" with the given signals`
      ),
      404
    );
  }

  // Timestamps are injected here, at the route boundary, exactly once. The
  // domain layer below (collectEvidence, createGate, ...) stays pure.
  const now = (): string => new Date().toISOString();
  const nowIso = now();

  const store = createD1Store(c.env.DB);
  const runId = crypto.randomUUID();

  let collected: Awaited<ReturnType<typeof collectEvidence>>;
  try {
    collected = await collectEvidence({
      runbook,
      sources: ALL_SOURCES,
      incidentId,
      service,
      packetId: crypto.randomUUID(),
      now
    });
  } catch (error) {
    if (error instanceof ScopeViolationError) {
      return c.json(apiError("scope_violation", error.message), 403);
    }
    throw error;
  }

  const { packet } = collected;

  // The action and gate share the run's id. Separate tables mean no primary
  // key collision, and it lets `/approvals/:id` locate the run (and hence
  // its mutable `state`, the only field Store exposes an update for) from
  // the gate id alone — see task-9-report.md for the full rationale.
  const action = createAction({
    id: runId,
    kind: runbook.proposedAction.kind,
    target: runbook.proposedAction.target,
    params: runbook.proposedAction.params,
    reversible: runbook.proposedAction.reversible,
    description: runbook.proposedAction.description
  });

  const gate = createGate({ id: runId, actionId: action.id, createdAt: nowIso, ttlMs: GATE_TTL_MS });

  await store.createRun({
    id: runId,
    incidentId,
    runbookId: runbook.id,
    service,
    state: "awaiting_approval",
    createdAt: nowIso,
    updatedAt: nowIso
  });
  await store.savePacket(packet, runId);
  await store.saveAction(action, runId);
  await store.saveGate(gate, runId);
  await store.appendAudit({
    id: crypto.randomUUID(),
    runId,
    at: nowIso,
    kind: "run_created",
    detail: `Evidence collected for incident ${incidentId}; action ${action.id} locked pending approval`
  });

  const run = await store.getRun(runId);

  return c.json({ ok: true, data: { run, packet, action, gate } });
});

export default runRoutes;
