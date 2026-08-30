import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { loadRunbook, matchRunbook, type Runbook } from "../domain/runbook";
import { collectEvidence, ScopeViolationError } from "../domain/packet-builder";
import { missingSources } from "../domain/evidence";
import { createAction } from "../domain/action";
import { createGate } from "../domain/approval";
import { createD1Store } from "../store/d1";
import { ALL_SOURCES, type EvidenceSource } from "../mcp";
import type { AuthedEnv } from "../auth/middleware";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

/**
 * This slice ships exactly one runbook. A real deployment would load every
 * file under `testing/runbooks` (or a real runbook store); the
 * `matchRunbook` contract is unchanged either way.
 */
export const RUNBOOKS: readonly Runbook[] = [loadRunbook(checkoutFailureRaw)];

/** Matches the TTL already used throughout the domain-layer tests and fixtures. */
const GATE_TTL_MS = 15 * 60 * 1000;

// `service`/`signals` are deliberately absent from this schema — same
// reasoning that keeps `by` out of the approve/reject bodies (see
// approvals.ts). The runbook match and the evidence collectors are both
// scoped by "what is this incident about", and the incident row — not
// whatever a caller's request body claims — is the only authority for that.
// A caller naming a different service here is either confused about which
// incident they're targeting or attempting to attach evidence and an action
// (e.g. a payment-service rollback) to an unrelated incident id. Extra keys
// in the body (including a legacy `service`/`signals` pair) are silently
// stripped by zod's default object parsing, so older callers that still
// send them keep working — the values are just never read.
const runBodySchema = z.object({});

/**
 * Factory rather than a bare `Hono` instance so tests can inject a source
 * that fails deterministically without reaching into module-level state.
 * Production wiring (`runRoutes` below, mounted by index.ts) always uses the
 * default `ALL_SOURCES`.
 */
export function createRunRoutes(sources: readonly EvidenceSource[] = ALL_SOURCES): Hono<AuthedEnv> {
  const routes = new Hono<AuthedEnv>();

  routes.post("/incidents/:id/run", async (c) => {
    const parsed = await parseJsonBody(c, runBodySchema);
    if (!parsed.success) return parsed.response;
    const incidentId = c.req.param("id");

    const store = createD1Store(c.env.DB);

    // A run against an incident that was never created is refused before any
    // evidence is collected.
    const incident = await store.getIncident(incidentId);
    if (incident === null) {
      return c.json(apiError("not_found", `No incident found for id "${incidentId}"`), 404);
    }

    // The incident row is the sole authority for what this run is about —
    // never the request body. See the schema comment above runBodySchema.
    const { service, signals } = incident;

    const runbook = matchRunbook(RUNBOOKS, { service, signals });
    if (runbook === null) {
      return c.json(
        apiError("no_matching_runbook", `No runbook matches service "${service}" with the given signals`),
        404
      );
    }

    // Timestamps are injected here, at the route boundary, exactly once. The
    // domain layer below (collectEvidence, createGate, ...) stays pure.
    const now = (): string => new Date().toISOString();
    const nowIso = now();

    const runId = crypto.randomUUID();

    let collected: Awaited<ReturnType<typeof collectEvidence>>;
    try {
      collected = await collectEvidence({
        runbook,
        sources,
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

    const { packet, failures } = collected;

    // The action and gate share the run's id. Separate tables mean no
    // primary key collision, and it lets /approvals/:id locate the run (and
    // hence its mutable `state`) from the gate id alone.
    const action = createAction({
      id: runId,
      kind: runbook.proposedAction.kind,
      target: runbook.proposedAction.target,
      params: runbook.proposedAction.params,
      reversible: runbook.proposedAction.reversible,
      description: runbook.proposedAction.description
    });

    const gate = createGate({ id: runId, actionId: action.id, createdAt: nowIso, ttlMs: GATE_TTL_MS });

    const run = {
      id: runId,
      incidentId,
      runbookId: runbook.id,
      service,
      state: "awaiting_approval" as const,
      createdAt: nowIso,
      updatedAt: nowIso,
      // From the session requireAuth resolved, never client-suppliable.
      createdBy: c.var.user.email
    };

    // A gap in the evidence must be observable, not silently absorbed into a
    // packet that looks complete. One audit entry names every absent source
    // (not one per failure), giving the log a single, greppable marker for
    // "this run's evidence has a gap".
    //
    // The gap is measured the same way GET /runs/:id measures it — a source
    // the runbook allows that contributed no cards — not merely by which
    // collectors threw. A collector that returns cleanly with zero cards
    // leaves exactly the same hole in the packet, and previously produced a
    // run the console labelled incomplete while the audit log recorded
    // nothing at all.
    const absentSources = missingSources(packet, runbook.allowedSources);
    const auditEntries = [
      {
        id: crypto.randomUUID(),
        runId,
        at: nowIso,
        kind: "run_created",
        detail: `Evidence collected for incident ${incidentId}; action ${action.id} locked pending approval`
      },
      ...(absentSources.length > 0
        ? [
            {
              id: crypto.randomUUID(),
              runId,
              at: nowIso,
              kind: "evidence_partial",
              detail: `Evidence collection incomplete for run ${runId}: no cards from ${absentSources.join(", ")}`
            }
          ]
        : [])
    ];

    // One atomic write: the run, its packet, its action, its locked gate,
    // and its initiating audit entries all land together, or none do. See
    // the doc comment on Store#createRunWithArtifacts — independent writes
    // here could leave a run with no action/gate that can never reach
    // `awaiting_approval` and that retrying (which always mints a new run
    // id) can never repair.
    await store.createRunWithArtifacts({ run, packet, action, gate, auditEntries });

    // This route executes NOTHING — it collects evidence and locks a gate.
    // The response deliberately has no `execution` field.
    return c.json({
      ok: true,
      data: {
        run,
        packet,
        action,
        gate,
        failures: failures.map((f) => ({ source: f.kind, message: f.message }))
      }
    });
  });

  return routes;
}

export const runRoutes: Hono<AuthedEnv> = createRunRoutes();
export default runRoutes;
