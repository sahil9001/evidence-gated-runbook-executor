import { describe, it, expect } from "vitest";
import { createAction } from "./action";
import { createGate, approveGate, rejectGate, isExpired, tokenAuthorizes, type ApprovalToken } from "./approval";

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
