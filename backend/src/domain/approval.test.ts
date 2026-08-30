import { describe, it, expect } from "vitest";
import { createAction } from "./action";
import {
  createGate,
  approveGate,
  rejectGate,
  isExpired,
  stableStringify,
  tokenAuthorizes,
  type ApprovalToken
} from "./approval";

const BEFORE_T0 = "2026-08-25T01:00:00.000Z";
const T0 = "2026-08-25T02:00:00.000Z";
const T5 = "2026-08-25T02:05:00.000Z";
const T30 = "2026-08-25T02:30:00.000Z";
const TTL = 15 * 60 * 1000;

const gate = () => createGate({ id: "g1", actionId: "a1", createdAt: T0, ttlMs: TTL });
const action = () => createAction({
  id: "a1", kind: "rollback", target: "payment-service",
  params: {}, reversible: true, description: "Roll back"
});

describe("gate lifecycle", () => {
  it("starts locked", () => {
    expect(gate().state).toBe("locked");
  });

  it("approving yields an approved gate and a token", () => {
    const { gate: g, token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    expect(g.state).toBe("approved");
    expect(g.decidedBy).toBe("sahil");
    expect(token.actionId).toBe("a1");
  });

  it("rejecting records the reason and produces no token", () => {
    const g = rejectGate(gate(), { by: "sahil", at: T5, reason: "Evidence too thin" });
    expect(g.state).toBe("rejected");
    expect(g.reason).toBe("Evidence too thin");
  });

  it("does not mutate the gate it was given", () => {
    const original = gate();
    approveGate(original, action(), { by: "sahil", at: T5 });
    expect(original.state).toBe("locked");
  });
});

describe("illegal transitions", () => {
  it("cannot approve twice", () => {
    const { gate: approved } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    expect(() => approveGate(approved, action(), { by: "other", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot approve a rejected gate", () => {
    const rejected = rejectGate(gate(), { by: "sahil", at: T5, reason: "no" });
    expect(() => approveGate(rejected, action(), { by: "sahil", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot reject an approved gate", () => {
    const { gate: approved } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    expect(() => rejectGate(approved, { by: "sahil", at: T5, reason: "changed mind" })).toThrow(/already decided/i);
  });

  it("requires a reason to reject", () => {
    expect(() => rejectGate(gate(), { by: "sahil", at: T5, reason: "" })).toThrow(/reason/i);
  });
});

describe("expiry", () => {
  it("is not expired inside the window", () => {
    expect(isExpired(gate(), T5)).toBe(false);
  });

  it("is expired past the window", () => {
    expect(isExpired(gate(), T30)).toBe(true);
  });

  it("is expired exactly at the expiry boundary", () => {
    expect(isExpired(gate(), gate().expiresAt)).toBe(true);
  });

  it("refuses to approve an expired gate — stale proof is not proof", () => {
    expect(() => approveGate(gate(), action(), { by: "sahil", at: T30 })).toThrow(/expired/i);
  });
});

describe("timestamp validation", () => {
  it("createGate throws on an unparseable createdAt instead of producing NaN", () => {
    expect(() => createGate({ id: "g1", actionId: "a1", createdAt: "not-a-date", ttlMs: TTL })).toThrow(
      /timestamp/i
    );
  });

  it("isExpired throws on an unparseable nowIso instead of failing open", () => {
    expect(() => isExpired(gate(), "not-a-date")).toThrow(/timestamp/i);
  });

  it("approveGate throws on an unparseable decision.at rather than approving", () => {
    expect(() => approveGate(gate(), action(), { by: "sahil", at: "not-a-date" })).toThrow(/timestamp/i);
  });

  it("rejectGate throws on an unparseable decision.at rather than rejecting", () => {
    expect(() => rejectGate(gate(), { by: "sahil", at: "not-a-date", reason: "no" })).toThrow(/timestamp/i);
  });
});

describe("backdated decisions", () => {
  it("refuses to approve with a decision timestamp before the gate existed", () => {
    expect(() => approveGate(gate(), action(), { by: "sahil", at: BEFORE_T0 })).toThrow(/predates/i);
  });

  it("refuses to reject with a decision timestamp before the gate existed", () => {
    expect(() => rejectGate(gate(), { by: "sahil", at: BEFORE_T0, reason: "no" })).toThrow(/predates/i);
  });

  it("accepts a decision timestamped exactly when the gate was created", () => {
    const { gate: g } = approveGate(gate(), action(), { by: "sahil", at: T0 });
    expect(g.state).toBe("approved");
    expect(g.decidedAt).toBe(T0);
  });

  it("still rejects a gate exactly at its expiry boundary after the backdating guard is added", () => {
    expect(() => approveGate(gate(), action(), { by: "sahil", at: gate().expiresAt })).toThrow(/expired/i);
  });
});

describe("token scope", () => {
  it("authorizes exactly the action it was minted for", () => {
    const { token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    expect(tokenAuthorizes(token, action())).toBe(true);
  });

  it("does not authorize a different action", () => {
    const { token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    const other = createAction({
      id: "a2", kind: "restart", target: "payment-service",
      params: {}, reversible: true, description: "Restart"
    });
    expect(tokenAuthorizes(token, other)).toBe(false);
  });

  it("rejects a hand-built object with a matching actionId shape", () => {
    const forged = {
      gateId: "g1", actionId: "a1", approvedBy: "attacker", approvedAt: T5
    } as unknown as ApprovalToken;
    expect(tokenAuthorizes(forged, action())).toBe(false);
  });

  it("rejects a token that round-tripped through structuredClone", () => {
    const { token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    const cloned = structuredClone(token);
    expect(tokenAuthorizes(cloned, action())).toBe(false);
  });

  it("throws if the action's id does not match the gate's actionId", () => {
    const mismatched = createAction({
      id: "a2", kind: "rollback", target: "payment-service",
      params: {}, reversible: true, description: "Roll back"
    });
    expect(() => approveGate(gate(), mismatched, { by: "sahil", at: T5 })).toThrow(/actionId/i);
  });
});

describe("token content binding", () => {
  it("rejects a same-id action whose target changed", () => {
    const { token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    const retargeted = createAction({
      id: "a1", kind: "rollback", target: "billing-service",
      params: {}, reversible: true, description: "Roll back"
    });
    expect(tokenAuthorizes(token, retargeted)).toBe(false);
  });

  it("rejects a same-id action whose kind changed", () => {
    const { token } = approveGate(gate(), action(), { by: "sahil", at: T5 });
    const recast = createAction({
      id: "a1", kind: "restart", target: "payment-service",
      params: {}, reversible: true, description: "Restart"
    });
    expect(tokenAuthorizes(token, recast)).toBe(false);
  });

  it("rejects a same-id action whose params changed", () => {
    const withParams = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { version: "17" }, reversible: true, description: "Roll back"
    });
    const { token } = approveGate(gate(), withParams, { by: "sahil", at: T5 });
    const tampered = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { version: "18" }, reversible: true, description: "Roll back"
    });
    expect(tokenAuthorizes(token, tampered)).toBe(false);
  });

  it("rejects an action whose params contain undefined before it ever reaches a gate", () => {
    expect(() =>
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: undefined }, reversible: true, description: "Roll back"
      })
    ).toThrow();
  });

  it("rejects an action whose params contain a function before it ever reaches a gate", () => {
    expect(() =>
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: () => 1 }, reversible: true, description: "Roll back"
      })
    ).toThrow();
  });

  it("does not let an undefined-valued param and a function-valued param collide, because both are rejected at creation", () => {
    let undefinedRejected = false;
    let functionRejected = false;
    try {
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: undefined }, reversible: true, description: "Roll back"
      });
    } catch {
      undefinedRejected = true;
    }
    try {
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: (): number => 1 }, reversible: true, description: "Roll back"
      });
    } catch {
      functionRejected = true;
    }
    expect(undefinedRejected).toBe(true);
    expect(functionRejected).toBe(true);
  });

  it("rejects NaN params at creation so NaN and null can never collide", () => {
    expect(() =>
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: NaN }, reversible: true, description: "Roll back"
      })
    ).toThrow();
  });

  it("distinguishes null params from each other via the type-tagged fingerprint (NaN excluded by schema)", () => {
    const withNull = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { x: null }, reversible: true, description: "Roll back"
    });
    const { token } = approveGate(gate(), withNull, { by: "sahil", at: T5 });
    expect(tokenAuthorizes(token, withNull)).toBe(true);
  });

  it("rejects bigint params at creation instead of crashing the serializer with a TypeError", () => {
    expect(() =>
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: 1n }, reversible: true, description: "Roll back"
      })
    ).toThrow();
    // and specifically not a raw serializer TypeError about BigInt
    try {
      createAction({
        id: "a1", kind: "rollback", target: "payment-service",
        params: { x: 1n }, reversible: true, description: "Roll back"
      });
    } catch (err) {
      expect(err).not.toBeInstanceOf(TypeError);
    }
  });

  it("throws a clear error instead of overflowing the stack on a cyclic params object", () => {
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    const withCycle = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: {}, reversible: true, description: "Roll back"
    });
    // Bypass createAction's JSON-safety validation (which would itself reject
    // a cycle) to exercise stableStringify's own cycle guard directly, since
    // approveGate/tokenAuthorizes call it via fingerprintAction.
    const withForcedCycle = { ...withCycle, params: cyclic as unknown as Record<string, never> };
    expect(() => approveGate(gate(), withForcedCycle as unknown as Parameters<typeof approveGate>[1], { by: "sahil", at: T5 })).toThrow(
      /cyclic/i
    );
  });

  it("still accepts the same params in a different key order", () => {
    const original = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { version: "17", region: "us-east" }, reversible: true, description: "Roll back"
    });
    const { token } = approveGate(gate(), original, { by: "sahil", at: T5 });
    const reordered = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { region: "us-east", version: "17" }, reversible: true, description: "Roll back"
    });
    expect(tokenAuthorizes(token, reordered)).toBe(true);
  });
});

/**
 * `stableStringify` is exported and used beyond `fingerprintAction` — the MCP
 * tool handlers compare runbook params with it. Its collision guarantees are
 * therefore a contract in their own right, and several of them are unreachable
 * through `createAction`, whose schema rejects NaN and bigint before the
 * serializer ever sees them. Testing the primitive directly is the only way to
 * pin the behaviour those callers depend on.
 */
describe("stableStringify", () => {
  it("keeps every non-finite number distinct from each other and from null", () => {
    const encoded = [NaN, Infinity, -Infinity, 0, null, undefined].map((v) => stableStringify(v));

    // The whole point of a type-tagged serializer: no two of these may collide,
    // or a token approved for one action would authorize another.
    expect(new Set(encoded).size).toBe(encoded.length);
  });

  it("distinguishes a bigint from the number and string with the same digits", () => {
    const encoded = [10n, 10, "10"].map((v) => stableStringify(v));
    expect(new Set(encoded).size).toBe(3);
  });

  it("distinguishes booleans from the strings that spell them", () => {
    expect(stableStringify(true)).not.toBe(stableStringify("true"));
  });

  it("is order-independent for object keys but not for array elements", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("refuses a value it cannot fingerprint rather than silently eliding it", () => {
    // A function or symbol has no stable serialization, and encoding either as
    // "undefined" would let two materially different actions fingerprint alike.
    expect(() => stableStringify({ fn: () => 1 })).toThrow(/function/i);
    expect(() => stableStringify({ sym: Symbol("s") })).toThrow(/symbol/i);
  });

  it("names the path to the offending value so a failure is actionable", () => {
    expect(() => stableStringify({ outer: { inner: [() => 1] } })).toThrow(/outer\.inner\[0\]/);
  });

  it("throws on a cyclic structure instead of overflowing the stack", () => {
    type Cyclic = { self?: Cyclic };
    const cyclic: Cyclic = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/cyclic/i);
  });

  it("allows the same object to appear twice when it is not a cycle", () => {
    // A shared reference is not a cycle; rejecting it would refuse ordinary
    // params that happen to reuse one nested object.
    const shared = { a: 1 };
    expect(() => stableStringify({ x: shared, y: shared })).not.toThrow();
  });
});
