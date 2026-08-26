import { createLogSource } from "./logs";
import { createMetricSource } from "./metrics";
import { createDeploySource } from "./deploys";
import { ALL_RUNBOOKS } from "./runbooks";
import type { EvidenceCard } from "../domain/evidence";
import { matchRunbook, type Runbook } from "../domain/runbook";
import { createAction, type Action } from "../domain/action";
import { createGate, type ApprovalGate } from "../domain/approval";

/**
 * The domain-pure collectors take an injected clock so their output stays
 * deterministic in tests. The MCP transport layer is the boundary that
 * supplies the real wall clock — mirroring how the route layer stamps
 * `approvedAt`/`createdAt` from the server clock in `approval.ts`.
 */
const systemNow = (): string => new Date().toISOString();

export type CollectArgs = { incidentId: string; service: string };

export async function handleCollectLogs(args: CollectArgs): Promise<EvidenceCard[]> {
  return createLogSource().collect({ incidentId: args.incidentId, service: args.service, now: systemNow });
}

export async function handleCollectMetrics(args: CollectArgs): Promise<EvidenceCard[]> {
  return createMetricSource().collect({ incidentId: args.incidentId, service: args.service, now: systemNow });
}

export async function handleCollectDeploys(args: CollectArgs): Promise<EvidenceCard[]> {
  return createDeploySource().collect({ incidentId: args.incidentId, service: args.service, now: systemNow });
}

export type GetRunbookArgs = { service: string; signals: string[] };
export type GetRunbookResult = { matched: false } | { matched: true; runbook: Runbook };

/**
 * Matches an incident against the runbook set and returns the winning
 * runbook, including `allowedSources` — the point of exposing this as a
 * tool at all. An agent (and the operator watching it) can see exactly
 * which evidence sources it is permitted to touch before it touches any of
 * them.
 */
export function handleGetRunbook(args: GetRunbookArgs): GetRunbookResult {
  const runbook = matchRunbook(ALL_RUNBOOKS, { service: args.service, signals: args.signals });
  return runbook ? { matched: true, runbook } : { matched: false };
}

export type ProposeRollbackArgs = { service: string; commit: string; reason: string };
export type ProposeRollbackResult = {
  executed: false;
  action: Action;
  gate: ApprovalGate;
  message: string;
};

const ROLLBACK_GATE_TTL_MS = 15 * 60 * 1000;

/**
 * Proposes a rollback without performing one. TrueForge's own approval
 * checkpoint is what stops the agent from reaching this tool in the first
 * place (it is annotated `destructiveHint: true` in `server.ts`, so the
 * default `require_approval_for_tools: ["@write", "@destructive"]` catches
 * it). This handler adds a second, independent lock on top of that: it
 * mints a RunProof `ApprovalGate` in the `locked` state, bound to the exact
 * action fingerprint, via the same domain machinery every other RunProof
 * action goes through. That gate is not approved here — approving it is a
 * separate RunProof-side decision this call never makes. Nothing about
 * this call bypasses or shortcuts `approval.ts`.
 */
export function handleProposeRollback(args: ProposeRollbackArgs): ProposeRollbackResult {
  const actionId = `mcp-rollback-${args.service}-${args.commit}-${crypto.randomUUID()}`;
  const action = createAction({
    id: actionId,
    kind: "rollback",
    target: args.service,
    params: { commit: args.commit, reason: args.reason },
    reversible: true,
    description: `Roll back ${args.service} to ${args.commit}`
  });
  const gate = createGate({
    id: `gate-${actionId}`,
    actionId: action.id,
    createdAt: systemNow(),
    ttlMs: ROLLBACK_GATE_TTL_MS
  });

  return {
    executed: false,
    action,
    gate,
    message:
      `Rollback of ${args.service} to ${args.commit} was proposed, not executed. ` +
      `RunProof minted a LOCKED approval gate (${gate.id}) bound to this exact action fingerprint; ` +
      `it stays locked until a human approves it through RunProof's own approval flow — a check ` +
      `independent of whatever approval TrueForge already required before calling this tool. ` +
      `No state-changing operation has occurred.`
  };
}
