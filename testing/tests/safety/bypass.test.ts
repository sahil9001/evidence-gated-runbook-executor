import { describe, it, expect } from "vitest";
import {
  createAction,
  isStateChanging,
  type Action,
  type ReadOnlyAction,
  type StateChangingAction
} from "../../../backend/src/domain/action";
import { createGate, approveGate, type ApprovalToken } from "../../../backend/src/domain/approval";
import { executeReadOnly, executeStateChanging } from "../../../backend/src/domain/executor";

// createAction's declared return type is the Action union — the kind alone
// determines isStateChanging at runtime, not at the type level. These
// helpers narrow via the isStateChanging type guard so fixtures below carry
// concrete ReadOnlyAction / StateChangingAction types. Without that, the
// compile-error assertions further down would see the union type and never
// trip a real error to suppress.
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

/**
 * RunProof's entire premise is that nothing state-changing runs without a
 * human approval. That is a claim about code paths that must not exist. This
 * suite tries to bypass the gate every way a caller might attempt it, and
 * asserts each attempt fails — either at compile time (a suppressed-error
 * directive that must suppress a REAL error — if tsc ever reports one of
 * these as unused, the guarantee this test exists to prove is broken) or at
 * runtime (a thrown/rejected error with a specific message).
 *
 * A test here that cannot fail is worse than no test, because it reads like
 * proof.
 */

const T0 = "2026-08-25T02:00:00.000Z";
const T_EXPIRED = "2026-08-25T03:00:00.000Z";
const TTL = 15 * 60 * 1000;

const rollback = mustBeStateChanging({
  id: "a1",
  kind: "rollback",
  target: "payment-service",
  params: {},
  reversible: true,
  description: "Roll back payment-service to previous release"
});

const otherAction = mustBeStateChanging({
  id: "a2",
  kind: "restart",
  target: "checkout-service",
  params: {},
  reversible: true,
  description: "Restart checkout-service"
});

const readOnlyAction = mustBeReadOnly({
  id: "r1",
  kind: "read_logs",
  target: "payment-service",
  params: {},
  reversible: true,
  description: "Read logs for payment-service"
});

function tokenFor(action: Action, at = T0): ApprovalToken {
  const gate = createGate({ id: `g-${action.id}`, actionId: action.id, createdAt: T0, ttlMs: TTL });
  return approveGate(gate, action, { by: "sahil@example.com", at }).token;
}

describe("safety: nothing state-changing runs without a token", () => {
  it("calling executeStateChanging without a token is a compile error", async () => {
    // @ts-expect-error executeStateChanging requires an ApprovalToken as a
    // mandatory second positional argument — (action, opts) is one argument
    // short, not (action, token, opts) with token omitted.
    await executeStateChanging(rollback, { now: () => T0 }).catch(() => {});
  });

  it("cannot be called with a hand-made token without defeating the type system", async () => {
    const forged = {
      gateId: "g-forged",
      actionId: rollback.id,
      actionFingerprint: "whatever",
      approvedBy: "attacker",
      approvedAt: T0
    };
    // @ts-expect-error a plain object is not a branded ApprovalToken — the
    // brand field is not exported, so nothing outside approval.ts can
    // construct a value that satisfies this type honestly.
    await executeStateChanging(rollback, forged, { now: () => T0 }).catch(() => {});
  });

  it("routes a state-changing action away from the read-only path", () => {
    // @ts-expect-error executeReadOnly does not accept a StateChangingAction
    void executeReadOnly(rollback, { now: () => T0 });
  });

  it("rejects a token minted for a different action", async () => {
    const token = tokenFor(otherAction);
    await expect(
      executeStateChanging(rollback, token, { now: () => T0 })
    ).rejects.toThrow(/does not authorize/i);
  });

  it("rejects a token that round-tripped through JSON — serialization loses WeakSet identity", async () => {
    const token = tokenFor(rollback);
    // A real token, but revived from a plain-data round trip: exactly the
    // shape persisting and reloading a token would produce. ApprovalToken is
    // never meant to survive this (see approval.ts's module doc comment) —
    // this simulates a caller who tried anyway.
    const revived = JSON.parse(JSON.stringify(token)) as ApprovalToken;
    await expect(
      executeStateChanging(rollback, revived, { now: () => T0 })
    ).rejects.toThrow(/does not authorize/i);
  });

  it("dryRun does not claim side effects occurred", async () => {
    const token = tokenFor(rollback);
    const result = await executeStateChanging(rollback, token, { now: () => T0, dryRun: true });
    expect(result.executed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.output).not.toMatch(/rolled back|restarted|scaled|completed/i);
  });

  it("an expired gate cannot produce a usable token", () => {
    const gate = createGate({ id: "g-exp", actionId: rollback.id, createdAt: T0, ttlMs: TTL });
    expect(() => approveGate(gate, rollback, { by: "sahil@example.com", at: T_EXPIRED })).toThrow(/expired/i);
  });

  it("a correctly-authorized token executes successfully (control case — the gate is not just always closed)", async () => {
    const token = tokenFor(rollback);
    const result = await executeStateChanging(rollback, token, { now: () => T0 });
    expect(result.executed).toBe(true);
    expect(result.actionId).toBe(rollback.id);
  });

  it("read-only execution needs no token at all (control case for the read-only path)", async () => {
    const result = await executeReadOnly(readOnlyAction, { now: () => T0 });
    expect(result.executed).toBe(true);
    expect(result.dryRun).toBe(false);
  });
});
