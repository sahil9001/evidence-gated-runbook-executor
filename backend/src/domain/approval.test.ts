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
    const { gate: g, token } = approveGate(gate(), { by: "sahil", at: T5 });
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
    approveGate(original, { by: "sahil", at: T5 });
    expect(original.state).toBe("locked");
  });
});

describe("illegal transitions", () => {
  it("cannot approve twice", () => {
    const { gate: approved } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(() => approveGate(approved, { by: "other", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot approve a rejected gate", () => {
    const rejected = rejectGate(gate(), { by: "sahil", at: T5, reason: "no" });
    expect(() => approveGate(rejected, { by: "sahil", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot reject an approved gate", () => {
    const { gate: approved } = approveGate(gate(), { by: "sahil", at: T5 });
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

  it("refuses to approve an expired gate — stale proof is not proof", () => {
    expect(() => approveGate(gate(), { by: "sahil", at: T30 })).toThrow(/expired/i);
  });
});

describe("token scope", () => {
  it("authorizes exactly the action it was minted for", () => {
    const { token } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(tokenAuthorizes(token, action())).toBe(true);
  });

  it("does not authorize a different action", () => {
    const { token } = approveGate(gate(), { by: "sahil", at: T5 });
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
    const { token } = approveGate(gate(), { by: "sahil", at: T5 });
    const cloned = structuredClone(token);
    expect(tokenAuthorizes(cloned, action())).toBe(false);
  });
});
