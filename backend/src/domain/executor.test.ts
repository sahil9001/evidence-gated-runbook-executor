import { describe, it, expect } from "vitest";
import { createAction, isStateChanging, type ReadOnlyAction, type StateChangingAction } from "./action";
import { createGate, approveGate } from "./approval";
import { executeReadOnly, executeStateChanging } from "./executor";

const T0 = "2026-08-25T02:00:00.000Z";
const TTL = 15 * 60 * 1000;

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
  params: { commit: "8f31c2b" },
  reversible: true,
  description: "Roll back payment-service to 8f31c2b"
});

const readOnlyAction = mustBeReadOnly({
  id: "r1",
  kind: "read_logs",
  target: "payment-service",
  params: {},
  reversible: true,
  description: "Read logs for payment-service"
});

describe("executeReadOnly", () => {
  it("executes immediately, with no approval involved", async () => {
    const result = await executeReadOnly(readOnlyAction, { now: () => T0 });
    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.actionId).toBe(readOnlyAction.id);
    expect(result.at).toBe(T0);
  });
});

describe("executeStateChanging", () => {
  it("executes when the token authorizes this exact action", async () => {
    const gate = createGate({ id: "g1", actionId: rollback.id, createdAt: T0, ttlMs: TTL });
    const { token } = approveGate(gate, rollback, { by: "sahil@example.com", at: T0 });

    const result = await executeStateChanging(rollback, token, { now: () => T0 });
    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.output).toContain("approved by sahil@example.com");
  });

  it("throws when the token was minted for a different action", async () => {
    const otherAction = mustBeStateChanging({
      id: "a2", kind: "restart", target: "checkout-service",
      params: {}, reversible: true, description: "Restart checkout-service"
    });
    const gate = createGate({ id: "g2", actionId: otherAction.id, createdAt: T0, ttlMs: TTL });
    const { token } = approveGate(gate, otherAction, { by: "sahil@example.com", at: T0 });

    await expect(executeStateChanging(rollback, token, { now: () => T0 })).rejects.toThrow(/does not authorize/i);
  });

  it("dryRun performs no execution and says so", async () => {
    const gate = createGate({ id: "g3", actionId: rollback.id, createdAt: T0, ttlMs: TTL });
    const { token } = approveGate(gate, rollback, { by: "sahil@example.com", at: T0 });

    const result = await executeStateChanging(rollback, token, { now: () => T0, dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.output).toMatch(/not performed/i);
    expect(result.output).not.toMatch(/rolled back|restarted|scaled|completed/i);
  });
});
