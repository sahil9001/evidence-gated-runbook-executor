import { z } from "zod";
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

/**
 * Thrown for malformed approve/reject input — a blank or whitespace-only
 * approver identity or rejection reason. Zod's `min(1)` at the route
 * boundary accepts whitespace, so this guard is the layer that actually
 * catches it; giving it a distinct type (rather than a bare `Error`) lets
 * the route map it to `400 validation_failed` instead of letting it fall
 * through to `app.onError`'s `500`. Deliberately narrower than the
 * already-decided/expired checks in `assertDecidable`, which stay plain
 * `Error`s — those are defence-in-depth the route already prevents via
 * `loadDecidableGate`, not client input errors.
 */
export class ApprovalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalInputError";
  }
}

/**
 * A gate's `expiresAt` decides whether it can still be decided (see
 * `isExpired`) — a corrupted or malformed value here must fail loudly on
 * read rather than silently produce a gate that can never expire (a
 * `Date.parse` on garbage yields `NaN`, and `now >= NaN` is always false).
 * Mirrors `evidencePacketSchema`: Zod-validated on both write and read.
 */
const isoDateString = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "must be a valid ISO date string"
});

const gateBaseSchema = z.object({
  id: z.string().min(1),
  actionId: z.string().min(1),
  createdAt: isoDateString,
  expiresAt: isoDateString
});

const lockedGateSchema = gateBaseSchema.extend({
  state: z.literal("locked")
});

const approvedGateSchema = gateBaseSchema.extend({
  state: z.literal("approved"),
  decidedBy: z.string().min(1),
  decidedAt: isoDateString,
  reason: z.string().min(1).optional()
});

const rejectedGateSchema = gateBaseSchema.extend({
  state: z.literal("rejected"),
  decidedBy: z.string().min(1),
  decidedAt: isoDateString,
  reason: z.string().min(1)
});

export const approvalGateSchema = z.discriminatedUnion("state", [
  lockedGateSchema,
  approvedGateSchema,
  rejectedGateSchema
]);

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
  if (decision.by.trim() === "") throw new ApprovalInputError("Approver identity is required");

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
  if (decision.by.trim() === "") throw new ApprovalInputError("Approver identity is required");
  if (decision.reason.trim() === "") throw new ApprovalInputError("A rejection reason is required");

  return {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "rejected", decidedBy: decision.by, decidedAt: decision.at, reason: decision.reason
  };
}

export function tokenAuthorizes(token: ApprovalToken, action: Action): boolean {
  return token.actionId === action.id;
}
