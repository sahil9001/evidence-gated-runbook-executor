import type { ReadOnlyAction, StateChangingAction } from "./action";
import { type ApprovalToken, tokenAuthorizes } from "./approval";

export type ExecutionResult = {
  readonly actionId: string;
  readonly executed: boolean;
  readonly dryRun: boolean;
  readonly output: string;
  readonly at: string;
};

/**
 * Execution is simulated for this slice: no real side effects are performed
 * against any target system. Wiring real production access is a separate
 * decision that has not been made.
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
 * Requires an ApprovalToken as a mandatory second positional argument. There
 * is deliberately no overload or wrapper that allows calling this without one
 * — the type system alone stops honest mistakes. The runtime re-check of
 * `tokenAuthorizes` below stops a valid token being replayed against a
 * different action than the one it was minted for.
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
