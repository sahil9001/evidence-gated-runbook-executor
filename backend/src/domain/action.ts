import { z } from "zod";

export const actionKindSchema = z.enum([
  "rollback", "restart", "scale", "read_logs", "read_metrics", "run_diagnostic"
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const STATE_CHANGING_KINDS: readonly ActionKind[] = ["rollback", "restart", "scale"];

type ActionBase = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly reversible: boolean;
  readonly description: string;
};

export type ReadOnlyAction = ActionBase & { readonly isStateChanging: false };
export type StateChangingAction = ActionBase & { readonly isStateChanging: true };
export type Action = ReadOnlyAction | StateChangingAction;

const actionInputSchema = z.object({
  id: z.string().min(1),
  kind: actionKindSchema,
  target: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  reversible: z.boolean(),
  description: z.string().min(1)
});

/**
 * The `isStateChanging` flag is derived from the action kind and can never be
 * supplied by a caller. A runbook that claims a rollback is read-only is wrong,
 * and this function overrules it.
 */
export function createAction(input: unknown): Action {
  const parsed = actionInputSchema.parse(input);
  const stateChanging = STATE_CHANGING_KINDS.includes(parsed.kind);
  return stateChanging
    ? { ...parsed, isStateChanging: true }
    : { ...parsed, isStateChanging: false };
}

export function isStateChanging(action: Action): action is StateChangingAction {
  return action.isStateChanging;
}
