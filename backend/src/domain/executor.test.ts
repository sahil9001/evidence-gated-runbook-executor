import { describe, it, expect } from "vitest";
import { createAction, isStateChanging, type ReadOnlyAction, type StateChangingAction } from "./action";
import { createGate, approveGate } from "./approval";
import { executeReadOnly, executeStateChanging } from "./executor";

const T0 = "2026-08-25T02:00:00.000Z";
const T5 = "2026-08-25T02:05:00.000Z";
const TTL = 15 * 60 * 1000;

// createAction's declared return type is the Action union (by design — the
// kind alone determines isStateChanging at runtime, not at the type level).
// These helpers narrow via the isStateChanging type guard so fixtures below
// have concrete ReadOnlyAction / StateChangingAction types, which is required
// for the executor's arity-based type safety to actually be exercised here.
function mustBeStateChanging(input: unknown): StateChangingAction {
  const action = createAction(input);
  if (!isStateChanging(action)) throw new Error("fixture expected to be state-changing");
  return action;
}

function mustBeReadOnly(input: unknown): ReadOnlyAction {
  const action = createAction(input);
  if (isStateChanging(action)) throw new Error("fixture expected to be read-only");
  return action;
}

const rollback = mustBeStateChanging({
  id: "a1",
  kind: "rollback",
  target: "payment-service",
  params: {},
  reversible: true,
  description: "Roll back payment-service to previous release"
});

const readLogs = mustBeReadOnly({
  id: "r1",
  kind: "read_logs",
  target: "payment-service",
  params: {},
  reversible: true,
  description: "Read logs for payment-service"
});

function authorizedToken() {
  const gate = createGate({ id: "g1", actionId: rollback.id, createdAt: T0, ttlMs: TTL });
  return approveGate(gate, { by: "sahil", at: T5 }).token;
}

describe("executeReadOnly", () => {
  it("executes immediately without any token, marking executed true and dryRun false", async () => {
    const result = await executeReadOnly(readLogs, { now: () => T0 });
    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.actionId).toBe(readLogs.id);
  });

  it("takes `at` from the injected now(), never the wall clock", async () => {
    const result = await executeReadOnly(readLogs, { now: () => T5 });
    expect(result.at).toBe(T5);
  });

  it("output describes the action performed", async () => {
    const result = await executeReadOnly(readLogs, { now: () => T0 });
    expect(result.output).toContain(readLogs.target);
  });
});

describe("executeStateChanging", () => {
  it("executes when the token authorizes the action", async () => {
    const token = authorizedToken();
    const result = await executeStateChanging(rollback, token, { now: () => T5 });
    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.actionId).toBe(rollback.id);
    expect(result.at).toBe(T5);
  });

  it("defaults dryRun to false when opts.dryRun is omitted", async () => {
    const token = authorizedToken();
    const result = await executeStateChanging(rollback, token, { now: () => T5 });
    expect(result.dryRun).toBe(false);
  });

  it("dryRun: true executes nothing and says so in the output", async () => {
    const token = authorizedToken();
    const result = await executeStateChanging(rollback, token, { now: () => T5, dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.output).toMatch(/not performed|no side effects/i);
  });

  it("throws with a message naming both the gate and the mismatched action when the token doesn't authorize", async () => {
    const gate = createGate({ id: "g2", actionId: "some-other-action", createdAt: T0, ttlMs: TTL });
    const token = approveGate(gate, { by: "sahil", at: T5 }).token;
    await expect(executeStateChanging(rollback, token, { now: () => T5 })).rejects.toThrow(
      /does not authorize/i
    );
  });
});
