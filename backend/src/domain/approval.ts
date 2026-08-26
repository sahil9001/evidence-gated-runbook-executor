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
 *
 * This is total (every input produces a string, never throwing on a value it
 * merely dislikes) and unambiguous: every primitive is type-tagged so that
 * no two distinct values — regardless of type — can ever serialize to the
 * same string. `undefined` and `NaN`/`null` in particular must NOT collide;
 * an action's `params` is expected to be pre-validated as JSON-safe by
 * `createAction` (see `./action`'s `jsonValueSchema`), but this function is
 * defence in depth and must stay safe even if something slips past that
 * boundary — it never trusts the caller to have done that validation.
 *
 * Cycle detection: a `WeakSet` of objects/arrays currently being visited
 * catches a cyclic structure and throws a clear error instead of recursing
 * until the stack overflows.
 *
 * Exported so callers outside this module can compare arbitrary JSON-safe
 * values with the exact same key-order-independent, type-tagged semantics
 * `fingerprintAction` uses for `params` — e.g. `mcp/toolHandlers.ts` uses it
 * to check a caller's requested params against what a matched runbook's
 * `proposedAction.params` actually prescribes. `fingerprintAction` itself
 * isn't the right tool there: it fingerprints an entire `Action` keyed to
 * whole-record equality of `params`, but that check must compare only the
 * subset of params a runbook prescribes (a runbook may authorize `commit`
 * while the request also carries a free-form `reason` the runbook never
 * sees). Reusing this primitive instead of `fingerprintAction` keeps both
 * comparisons on one deterministic serialization so they cannot drift on
 * what counts as "the same value".
 */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  function stringify(val: unknown, path: string): string {
    if (val === null) return "z";
    if (val === undefined) return "u";
    const type = typeof val;

    if (type === "boolean") return `b:${val}`;
    if (type === "number") {
      const n = val as number;
      if (Number.isNaN(n)) return "n:NaN";
      if (n === Infinity) return "n:Infinity";
      if (n === -Infinity) return "n:-Infinity";
      return `n:${n}`;
    }
    if (type === "bigint") return `g:${(val as bigint).toString()}`;
    if (type === "string") return `s:${JSON.stringify(val)}`;
    if (type === "function" || type === "symbol") {
      throw new Error(`Cannot fingerprint a ${type} value at ${path || "<root>"}`);
    }

    // type === "object" from here on (arrays included).
    const obj = val as object;
    if (seen.has(obj)) {
      throw new Error(`Cannot fingerprint a cyclic structure at ${path || "<root>"}`);
    }
    seen.add(obj);
    try {
      if (Array.isArray(val)) {
        return `[${val.map((item, index) => stringify(item, `${path}[${index}]`)).join(",")}]`;
      }
      const sortedEntries = Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0
      );
      const body = sortedEntries
        .map(([key, entryVal]) => `${JSON.stringify(key)}:${stringify(entryVal, `${path}.${key}`)}`)
        .join(",");
      return `{${body}}`;
    } finally {
      seen.delete(obj);
    }
  }

  return stringify(value, "");
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

/**
 * Parse an ISO timestamp and reject anything that does not resolve to a
 * finite epoch. `Date.parse` returns `NaN` for garbage input, and `NaN`
 * compared with anything is always `false` — left unchecked that makes an
 * invalid `approvedAt`/`nowIso` look "not expired", the wrong direction for
 * a safety check. Every timestamp that crosses into this module is treated
 * as untrusted external input and validated here, the same way any other
 * boundary value gets Zod-validated.
 *
 * NOTE: this only rejects malformed timestamps. It cannot detect a
 * well-formed but backdated one — the domain layer intentionally has no
 * access to wall-clock time (the clock is injected so it stays pure and
 * testable). The caller that supplies `nowIso`/`decision.at` is responsible
 * for that: the route layer MUST stamp these from the server's own clock
 * and must NEVER accept a client-supplied timestamp for `at`/`nowIso`.
 */
function assertValidTimestamp(iso: string, label: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new Error(`${label} is not a valid timestamp: ${JSON.stringify(iso)}`);
  }
  return ms;
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
  const createdAtMs = assertValidTimestamp(input.createdAt, "createdAt");
  return {
    id: input.id,
    actionId: input.actionId,
    createdAt: input.createdAt,
    expiresAt: new Date(createdAtMs + input.ttlMs).toISOString(),
    state: "locked"
  };
}

export function isExpired(gate: ApprovalGate, nowIso: string): boolean {
  const now = assertValidTimestamp(nowIso, "nowIso");
  const expiresAt = assertValidTimestamp(gate.expiresAt, "gate.expiresAt");
  return now >= expiresAt;
}

function assertDecidable(gate: ApprovalGate, nowIso: string): void {
  if (gate.state !== "locked") {
    throw new Error(`Gate ${gate.id} was already decided (${gate.state})`);
  }
  const at = assertValidTimestamp(nowIso, "nowIso");
  const createdAt = assertValidTimestamp(gate.createdAt, "gate.createdAt");
  if (at < createdAt) {
    throw new Error(`Decision timestamp ${nowIso} predates gate ${gate.id} created at ${gate.createdAt}`);
  }
  if (isExpired(gate, nowIso)) {
    throw new Error(`Gate ${gate.id} expired at ${gate.expiresAt}`);
  }
}

/**
 * `decision.at` is TRUSTED input: this function has no independent clock, so
 * it cannot distinguish a legitimate server timestamp from a plausible but
 * backdated one supplied by a caller. Callers MUST stamp `at` from a server
 * clock (e.g. `new Date().toISOString()` in the Worker, never a client
 * request body) — no route may accept a client-supplied timestamp for
 * `at`/`nowIso`. `assertDecidable` only catches timestamps that are
 * provably impossible (predating the gate's own `createdAt`); it cannot and
 * does not attempt to catch a timestamp that is merely implausible.
 */
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
