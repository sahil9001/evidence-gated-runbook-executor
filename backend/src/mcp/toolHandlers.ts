import { createLogSource } from "./logs";
import { createMetricSource } from "./metrics";
import { createDeploySource } from "./deploys";
import { ALL_RUNBOOKS } from "./runbooks";
import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";
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

export type CollectArgs = { incidentId: string; service: string; signals: string[] };

/**
 * The subset of args every scope check actually needs. `CollectArgs` (which
 * also carries `incidentId`, unused by `authorizeSource` itself) and
 * `GetDiagnosticScriptArgs` (which is exactly this shape) are both
 * structurally assignable to it, so `authorizeSource` serves both without
 * widening what it depends on.
 */
type ScopeCheckArgs = { service: string; signals: string[] };

/**
 * Enforces RunProof's central safety property at the MCP boundary: a
 * collector — or, via `handleGetDiagnosticScript`, the diagnostic-script
 * handoff — may run only once the caller's service+signals resolve to a
 * runbook that authorizes `source`. Every collect_* handler and
 * `handleGetDiagnosticScript` route through this one function —
 * deliberately not duplicated per handler — so there is exactly one place
 * that can drift from `matchRunbook`, the same matcher `get_runbook` uses to
 * decide what an agent is even allowed to see.
 *
 * Throwing here (rather than returning an empty result) is deliberate: the
 * MCP SDK converts a thrown error into a `{ isError: true }` tool result
 * naming exactly what was refused, so a calling agent can act on it instead
 * of misreading an empty array as "no evidence found".
 */
/**
 * Resolves the runbook that authorizes an incident's service+signals, or
 * throws a refusal naming exactly what could not be matched. This is the one
 * place `matchRunbook` is called from a tool handler — `authorizeSource` (the
 * five collector/diagnostic tools) and `handleProposeRollback` (the one
 * destructive tool) both route through it, so there is exactly one matching
 * codepath to keep in sync with `matchRunbook` itself rather than two that
 * can drift apart.
 */
function requireMatchedRunbook(args: ScopeCheckArgs, refusalContext: string): Runbook {
  const runbook = matchRunbook(ALL_RUNBOOKS, { service: args.service, signals: args.signals });
  if (!runbook) {
    throw new Error(
      `No runbook matches service "${args.service}" with signals [${args.signals.join(", ")}]. ` +
        `Refusing to ${refusalContext} without an authorized runbook scope.`
    );
  }
  return runbook;
}

function authorizeSource(args: ScopeCheckArgs, source: EvidenceSourceKind): Runbook {
  const runbook = requireMatchedRunbook(args, `collect ${source} evidence`);
  if (!runbook.allowedSources.includes(source)) {
    throw new Error(
      `Runbook "${runbook.id}" does not authorize the "${source}" source ` +
        `(allowedSources: [${runbook.allowedSources.join(", ")}]). Refusing to collect.`
    );
  }
  return runbook;
}

export async function handleCollectLogs(args: CollectArgs): Promise<EvidenceCard[]> {
  authorizeSource(args, "logs");
  return createLogSource().collect({ incidentId: args.incidentId, service: args.service, now: systemNow });
}

export async function handleCollectMetrics(args: CollectArgs): Promise<EvidenceCard[]> {
  authorizeSource(args, "metrics");
  return createMetricSource().collect({ incidentId: args.incidentId, service: args.service, now: systemNow });
}

export async function handleCollectDeploys(args: CollectArgs): Promise<EvidenceCard[]> {
  authorizeSource(args, "deploys");
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

export type GetDiagnosticScriptArgs = { service: string; signals: string[] };
export type GetDiagnosticScriptResult = {
  runbookId: string;
  description: string;
  script: string;
  expectedOutput: string;
};

/**
 * Hands back the diagnostic script a matched runbook authorizes running —
 * RunProof does not execute it. TrueForge owns the sandbox (local fallback
 * or a configured provider like Daytona); the calling agent is expected to
 * take this script and run it there, then interpret stdout against
 * `expectedOutput`. Scope is enforced through the exact same
 * `authorizeSource` check every collect_* handler uses, with `"sandbox"` as
 * the guarded source: a runbook that doesn't list `sandbox` in
 * `allowedSources` refuses this the same way it refuses an unauthorized
 * collector, and a runbook with no `diagnostic` authored refuses too rather
 * than returning nothing useful. Read-only: returning text is not itself
 * destructive (see `readOnlyHint: true` on this tool in `server.ts`).
 */
export function handleGetDiagnosticScript(args: GetDiagnosticScriptArgs): GetDiagnosticScriptResult {
  const runbook = authorizeSource(args, "sandbox");
  if (!runbook.diagnostic) {
    throw new Error(
      `Runbook "${runbook.id}" authorizes the "sandbox" source but has no diagnostic script defined. ` +
        `Refusing to fabricate one.`
    );
  }
  return {
    runbookId: runbook.id,
    description: runbook.diagnostic.description,
    script: runbook.diagnostic.script,
    expectedOutput: runbook.diagnostic.expectedOutput
  };
}

export type ProposeRollbackArgs = { service: string; commit: string; reason: string; signals: string[] };
export type ProposeRollbackResult = {
  executed: false;
  action: Action;
  gate: ApprovalGate;
  message: string;
};

const ROLLBACK_GATE_TTL_MS = 15 * 60 * 1000;

/**
 * Proposes a rollback without performing one. Like every other tool here,
 * this call is constrained by the matched runbook: it resolves a runbook
 * from `args.service`/`args.signals` via `requireMatchedRunbook` (refusing,
 * same as the collectors, when nothing matches) and then checks that the
 * runbook's own `proposedAction` actually authorizes *this* rollback — same
 * `kind` ("rollback") and same `target` as the requested service. A runbook
 * whose proposedAction is a restart, or that targets a different service,
 * does not license this call; it is refused before any `Action` or
 * `ApprovalGate` is created. This is deliberately the same authorization
 * shape as the collectors (`authorizeSource`), just checked against
 * `proposedAction` instead of `allowedSources`, because propose_rollback is
 * the one tool that turns a runbook's *recommendation* into a concrete,
 * approvable action rather than reading evidence within its scope.
 *
 * TrueForge's own approval checkpoint is what stops the agent from reaching
 * this tool in the first place (it is annotated `destructiveHint: true` in
 * `server.ts`, so the default `require_approval_for_tools: ["@write",
 * "@destructive"]` catches it). This handler adds a second, independent lock
 * on top of that: once a matching runbook has authorized the proposal, it
 * mints a RunProof `ApprovalGate` in the `locked` state, bound to the exact
 * action fingerprint, via the same domain machinery every other RunProof
 * action goes through. That gate is not approved here — approving it is a
 * separate RunProof-side decision this call never makes. Nothing about
 * this call bypasses or shortcuts `approval.ts`.
 */
export function handleProposeRollback(args: ProposeRollbackArgs): ProposeRollbackResult {
  const runbook = requireMatchedRunbook(args, "propose a rollback");
  if (runbook.proposedAction.kind !== "rollback" || runbook.proposedAction.target !== args.service) {
    throw new Error(
      `Runbook "${runbook.id}" does not authorize a rollback of "${args.service}": its proposedAction is a ` +
        `"${runbook.proposedAction.kind}" action targeting "${runbook.proposedAction.target}". Refusing to ` +
        `propose an action the matched runbook does not authorize.`
    );
  }

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
