import type { EvidencePacket } from "./evidence";
import type { Action } from "./action";
import type { ApprovalGate } from "./approval";

/**
 * Pure types and the `Store` port. No D1, no SQL, no bindings — this file
 * must be importable without a Worker runtime. Implementations live in
 * `src/store/*` (`createD1Store`, `createMemoryStore`); both are exercised
 * against the identical contract in `src/store/conformance.ts`.
 *
 * `ApprovalToken` is deliberately absent from this file and from every
 * `Store` method: it is backed by a module-private `WeakSet` (see
 * `./approval`) and is in-process-identity-only. It can never be
 * serialized and rehydrated, so persistence layers must persist the GATE
 * (`ApprovalGate`), never the token.
 */

/**
 * Thrown by a `create*`/`save*` write that collides with an existing row on
 * a primary key or unique constraint (a duplicate id, or — for users — a
 * duplicate email). In `createD1Store` this mirrors D1/SQLite rejecting the
 * same INSERT via a schema constraint (see `migrations/*.sql`); in
 * `createMemoryStore` it is this explicit class, since a `Map` has no
 * constraint of its own to violate. The two adapters are not guaranteed to
 * throw byte-identical error text — callers (and the conformance suite)
 * should assert on the shared shape (rejects, is an `Error`) rather than on
 * D1's exact SQLite message.
 */
export class StoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreConflictError";
  }
}

export type RunRow = {
  id: string;
  incidentId: string;
  runbookId: string;
  service: string;
  state: "collecting" | "awaiting_approval" | "approved" | "rejected" | "executed";
  createdAt: string;
  updatedAt: string;
  /** The operator whose session started this run, or null when there is no
   * attributable session. Never client-suppliable — a future route sets
   * this from the authenticated caller, the same discipline `by` on
   * approvals follows. */
  createdBy: string | null;
};

export type AuditEntry = {
  id: string;
  runId: string;
  at: string;
  kind: string;
  detail: string;
};

export type IncidentRow = {
  id: string;
  title: string;
  service: string;
  signals: string[];
  status: string;
  createdBy: string;
  createdAt: string;
};

export type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
};

export type SessionRow = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export interface Store {
  createRun(run: RunRow): Promise<void>;
  getRun(id: string): Promise<RunRow | null>;
  updateRunState(
    id: string,
    state: RunRow["state"],
    at: string,
    expectedState?: RunRow["state"]
  ): Promise<boolean>;
  listRuns(filter?: { limit?: number; state?: RunRow["state"] }): Promise<RunRow[]>;
  listRunsByIncident(incidentId: string): Promise<RunRow[]>;

  savePacket(packet: EvidencePacket, runId: string): Promise<void>;
  getPacketByIncident(incidentId: string): Promise<EvidencePacket | null>;
  /**
   * The packet built FOR this run, and only this run — never "whatever the
   * incident's most recent packet happens to be". A gate must be decided on
   * the evidence collected for the run it belongs to; resolving evidence via
   * `getPacketByIncident` instead lets a later, unrelated run on the same
   * incident (empty or otherwise) determine whether THIS run's gate can be
   * approved, which defeats the evidence gate. Ordered by `builtAt DESC`
   * like `getPacketByIncident` in case a run is ever associated with more
   * than one packet, though the current `/run` route writes exactly one.
   */
  getPacketByRun(runId: string): Promise<EvidencePacket | null>;

  saveAction(action: Action, runId: string): Promise<void>;
  getAction(id: string): Promise<Action | null>;

  /**
   * A gate is created locked, then decided exactly once: `locked ->
   * approved` or `locked -> rejected`, never anything else, and never back
   * to locked. Implementations MUST enforce this as a conditional
   * write — the call only takes effect while the stored gate (if any) is
   * still `locked` — and report whether it won via the returned boolean, so
   * two callers racing to decide the same gate can never both believe they
   * won, and a stale locked value can never revert an already-decided gate.
   */
  saveGate(gate: ApprovalGate, runId: string): Promise<boolean>;
  getGate(id: string): Promise<ApprovalGate | null>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(runId: string): Promise<AuditEntry[]>;
  /** The most recent audit entries across every run, newest first, capped at
   * `limit`. Backs a cross-run recent-activity view — a use case
   * `listAudit` (scoped to one run) can't provide. */
  listRecentAudit(limit: number): Promise<AuditEntry[]>;

  listIncidents(filter?: { status?: string }): Promise<IncidentRow[]>;
  getIncident(id: string): Promise<IncidentRow | null>;
  createIncident(row: IncidentRow): Promise<void>;

  createUser(row: UserRow): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;

  /**
   * Creates a user and its first session as a single atomic write:
   * `createUser` succeeding while the paired `createSession` fails (a
   * distinct write, on a separate round trip) would leave a stored user
   * with no way to reach it — and, worse, no way to ever create one, since
   * a retry of registration reports `email_taken` for a row the caller
   * never got a cookie for. Both rows land, or neither does. Implementations
   * MUST enforce this atomically (D1 via `db.batch()`, which SQLite commits
   * or rolls back as one transaction; the memory adapter by validating both
   * rows are conflict-free before mutating either map).
   *
   * "Paired" is load-bearing: implementations MUST also reject when
   * `session.userId !== user.id`, before writing anything. Nothing else
   * enforces that the session names the SAME user being created here — a
   * mismatched call would create the new user but hand back a session that
   * authenticates a different, already-existing account (or an unusable
   * session for a missing one). This is a programming-error guard, not a
   * user-facing condition: the register route always constructs a correctly
   * paired session, and the check exists so that stays true.
   */
  createUserWithSession(user: UserRow, session: SessionRow): Promise<void>;

  createSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(nowIso: string): Promise<void>;
}
