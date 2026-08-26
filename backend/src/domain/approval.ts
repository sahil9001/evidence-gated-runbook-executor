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
  /**
   * Deterministic fingerprint of the action's material content at the moment
   * of approval (see `fingerprintAction`). Binds the token to what a human
   * actually saw and approved, not merely to an id — an action recreated
   * with the same id but a different target/kind/params must not inherit
   * approval.
   */
  readonly actionFingerprint: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly [tokenBrand]: true;
};

/**
 * Runtime identity for minted tokens. The `unique symbol` brand above is a
 * compile-time-only construct — it is erased by the TypeScript compiler and
 * leaves no trace on the object at runtime, so it cannot by itself stop a
 * hand-built object (or JSON/D1/any untyped boundary value) with a matching
 * shape from type-casting its way into `ApprovalToken` and passing authorization.
 *
 * This WeakSet is the actual non-forgeability mechanism: it is module-private
 * and identity-based, so only objects that were produced by `approveGate` in
 * this process can ever be members, regardless of shape.
 *
 * Consequence: tokens are in-process only and must NEVER be serialized and
 * rehydrated (JSON.stringify/parse, structuredClone, storing in D1/KV, etc).
 * A token that round-trips through serialization legitimately loses its
 * runtime identity and will be rejected by `tokenAuthorizes` — that is
 * correct behaviour, not a bug. If a caller needs to persist an approval
 * durably, persist the GATE (which is plain, serializable data), not the
 * token.
 */
const issuedTokens = new WeakSet<ApprovalToken>();

/** True only for objects actually minted by `approveGate` in this process. */
export function isIssuedToken(value: unknown): value is ApprovalToken {
  if (typeof value !== "object" || value === null) return false;
  return issuedTokens.has(value as ApprovalToken);
}

/**
 * Deterministically stringify a value with object keys sorted, so two
 * objects that differ only in key insertion order produce identical output.
 * Arrays keep their given order (order is semantically meaningful there).
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    const body = sortedEntries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint the material content of an action: id, kind, target,
 * isStateChanging, and params, with keys sorted so key order never changes
 * the result. A token is bound to this fingerprint, not just the action id,
 * so an action recreated with the same id but different content is rejected.
 */
function fingerprintAction(action: Action): string {
  return stableStringify({
    id: action.id,
    kind: action.kind,
    target: action.target,
    isStateChanging: action.isStateChanging,
    params: action.params
  });
}

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
  action: Action,
  decision: { by: string; at: string; reason?: string }
): { gate: ApprovedGate; token: ApprovalToken } {
  assertDecidable(gate, decision.at);
  if (gate.actionId !== action.id) {
    throw new Error(
      `Gate ${gate.id} is bound to actionId ${gate.actionId}, not ${action.id}`
    );
  }
  if (decision.by.trim() === "") throw new Error("Approver identity is required");

  const approved: ApprovedGate = {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "approved", decidedBy: decision.by, decidedAt: decision.at,
    ...(decision.reason === undefined ? {} : { reason: decision.reason })
  };

  const token = {
    gateId: gate.id,
    actionId: gate.actionId,
    actionFingerprint: fingerprintAction(action),
    approvedBy: decision.by,
    approvedAt: decision.at
  } as ApprovalToken;
  issuedTokens.add(token);

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
  if (!isIssuedToken(token)) return false;
  if (token.actionId !== action.id) return false;
  return token.actionFingerprint === fingerprintAction(action);
}
