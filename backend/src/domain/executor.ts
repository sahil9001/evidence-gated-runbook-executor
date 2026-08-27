import type { ReadOnlyAction, StateChangingAction } from "./action";
import { tokenAuthorizes, type ApprovalToken } from "./approval";

/**
 * Execution is SIMULATED: nothing here touches a real target system. Both
 * functions return a descriptive string; no HTTP call, no subprocess, no
 * infrastructure API is invoked. Wiring real production access is a
 * separate, unmade decision.
 */
export type ExecutionResult = {
  readonly actionId: string;
  readonly executed: boolean;
  readonly dryRun: boolean;
  readonly output: string;
  readonly at: string;
};

/**
 * Executes a read-only action. No approval is required or possible for a
 * read-only action — there is nothing here for a human to sign off on.
 */
export async function executeReadOnly(
  action: ReadOnlyAction,
  opts: { now: () => string }
): Promise<ExecutionResult> {
  return {
    actionId: action.id,
    executed: true,
    dryRun: false,
    output: `Simulated read-only execution of '${action.kind}' against ${action.target}: ${action.description}`,
    at: opts.now()
  };
}

/**
 * Executes a state-changing action. `token` is a mandatory second positional
 * argument — there is deliberately no overload, default, or wrapper that
 * allows calling this without one. That is what turns "execute without
 * approval" into a compile error rather than a runtime check: the only way
 * to obtain an `ApprovalToken` is `approveGate()` (see `./approval`), and
 * the only way to spend one is here.
 *
 * The type system stops honest mistakes (forgetting to pass a token, or
 * passing a hand-built object shaped like one). It cannot stop a token
 * being reused against a different action than the one it was minted for —
 * `tokenAuthorizes` is re-checked here, at the moment of execution, for
 * that: both the token's identity (only something `approveGate` actually
 * minted in this process passes `isIssuedToken`) and its binding to this
 * exact action's content (via `actionFingerprint`) are verified again,
 * never trusted merely because a caller managed to produce a value that
 * type-checks as `ApprovalToken`.
 */
export async function executeStateChanging(
  action: StateChangingAction,
  token: ApprovalToken,
  opts: { now: () => string; dryRun?: boolean }
): Promise<ExecutionResult> {
  if (!tokenAuthorizes(token, action)) {
    throw new Error(
      `Approval token for gate '${token.gateId}' (action '${token.actionId}') does not authorize action '${action.id}'`
    );
  }

  const dryRun = opts.dryRun ?? false;
  const at = opts.now();

  if (dryRun) {
    return {
      actionId: action.id,
      executed: false,
      dryRun: true,
      output: `Dry run only: '${action.kind}' against ${action.target} was NOT performed. No side effects occurred.`,
      at
    };
  }

  return {
    actionId: action.id,
    executed: true,
    dryRun: false,
    output: `Simulated execution of '${action.kind}' against ${action.target} (approved by ${token.approvedBy}): ${action.description}`,
    at
  };
}
