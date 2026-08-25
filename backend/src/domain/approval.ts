import type { Action } from "./action";

declare const tokenBrand: unique symbol;

/**
 * Proof that a human approved a specific action. The brand symbol is not
 * exported, so no module outside this file can construct one — `approveGate` is
 * the only mint. This is the load-bearing safety property of RunProof.
 */
export type ApprovalToken = {
  readonly gateId: string;
  readonly actionId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly [tokenBrand]: true;
};

export type GateState = "locked" | "approved" | "rejected";

type GateBase = {
  readonly id: string;
  readonly actionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type LockedGate = GateBase & { readonly state: "locked" };
export type ApprovedGate = GateBase & { readonly state: "approved"; readonly decidedBy: string; readonly decidedAt: string; readonly reason?: string };
export type RejectedGate = GateBase & { readonly state: "rejected"; readonly decidedBy: string; readonly decidedAt: string; readonly reason: string };

export type ApprovalGate = LockedGate | ApprovedGate | RejectedGate;

export function createGate(input: {
  id: string; actionId: string; createdAt: string; ttlMs: number;
}): ApprovalGate {
  return {
    id: input.id,
    actionId: input.actionId,
    createdAt: input.createdAt,
    expiresAt: new Date(Date.parse(input.createdAt) + input.ttlMs).toISOString(),
    state: "locked"
  };
}

export function isExpired(gate: ApprovalGate, nowIso: string): boolean {
  return Date.parse(nowIso) >= Date.parse(gate.expiresAt);
}

function assertDecidable(gate: ApprovalGate, nowIso: string): void {
  if (gate.state !== "locked") {
    throw new Error(`Gate ${gate.id} was already decided (${gate.state})`);
  }
  if (isExpired(gate, nowIso)) {
    throw new Error(`Gate ${gate.id} expired at ${gate.expiresAt}`);
  }
}

export function approveGate(
  gate: ApprovalGate,
  decision: { by: string; at: string; reason?: string }
): { gate: ApprovedGate; token: ApprovalToken } {
  assertDecidable(gate, decision.at);
  if (decision.by.trim() === "") throw new Error("Approver identity is required");

  const approved: ApprovedGate = {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "approved", decidedBy: decision.by, decidedAt: decision.at,
    ...(decision.reason === undefined ? {} : { reason: decision.reason })
  };

  const token = {
    gateId: gate.id,
    actionId: gate.actionId,
    approvedBy: decision.by,
    approvedAt: decision.at
  } as ApprovalToken;

  return { gate: approved, token };
}

export function rejectGate(
  gate: ApprovalGate,
  decision: { by: string; at: string; reason: string }
): RejectedGate {
  assertDecidable(gate, decision.at);
  if (decision.by.trim() === "") throw new Error("Approver identity is required");
  if (decision.reason.trim() === "") throw new Error("A rejection reason is required");

  return {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "rejected", decidedBy: decision.by, decidedAt: decision.at, reason: decision.reason
  };
}

export function tokenAuthorizes(token: ApprovalToken, action: Action): boolean {
  return token.actionId === action.id;
}
