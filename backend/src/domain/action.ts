import { z } from "zod";

export const actionKindSchema = z.enum([
  "rollback", "restart", "scale", "read_logs", "read_metrics", "run_diagnostic"
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const STATE_CHANGING_KINDS: readonly ActionKind[] = ["rollback", "restart", "scale"];

/**
 * A JSON-safe value: exactly what can survive a lossless round trip through
 * `JSON.stringify`/`JSON.parse`, which is how `params` is persisted in D1.
 * Anything outside this shape (a function, `undefined`, a bigint, NaN,
 * Infinity, a symbol) is never legitimate action content — reject it at the
 * boundary rather than let it flow through and produce an ambiguous or
 * crashing fingerprint later (see `stableStringify` in `./approval`).
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema)
  ])
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type ActionBase = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly params: Readonly<Record<string, JsonValue>>;
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
  params: z.record(z.string(), jsonValueSchema),
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
