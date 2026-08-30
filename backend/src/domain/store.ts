import type { EvidencePacket } from "./evidence";
import type { Action } from "./action";
import type { ApprovalGate, ApprovedGate, RejectedGate } from "./approval";

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
  /**
   * How many sources the run's runbook allows that its packet has no cards
   * from -- 0 for a complete packet.
   *
   * `null` means the run predates this measurement, which is NOT the same as
   * 0. The Overview score excludes null runs from its evidence term rather
   * than counting them as complete, because "we never recorded it" and "we
   * recorded no gaps" are different claims.
   */
  evidenceGapCount: number | null;
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

/**
 * Every run state, in lifecycle order. Exported so the grouped-count adapters
 * can seed a zero for states the query returned no rows for, rather than each
 * one hard-coding the same five strings.
 */
export const RUN_STATES: readonly RunRow["state"][] = [
  "collecting",
  "awaiting_approval",
  "approved",
  "rejected",
  "executed"
];

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
  /** Newest-first. `limit`, when given, bounds the result the same way
   * `listRuns`'s does — omitted only where a caller has already applied its
   * own cap (or, in the memory adapter's test-only paths, genuinely wants
   * everything). */
  listRunsByIncident(incidentId: string, limit?: number): Promise<RunRow[]>;

  /**
   * `COUNT(*) ... WHERE state = ?` — never `(await listRuns()).filter(...)
   * .length`. The Overview screen only needs a number, and a caller that
   * materializes every run row into the Worker just to throw away
   * everything but a count pays a cost (time, memory) that grows with total
   * history forever, for a request an authenticated user can trigger at
   * will.
   */
  countRunsByState(state: RunRow["state"]): Promise<number>;
  /**
   * `COUNT(*) ... WHERE created_at >= ?` — bounds "how many runs since this
   * instant" (e.g. the start of today) without shipping every run row into
   * the Worker. Same reasoning as `countRunsByState`.
   */
  countRunsSince(sinceIso: string): Promise<number>;
  /**
   * Every run state and how many runs are in it, as one `GROUP BY state`
   * query. The Overview screen's readiness score needs all five counts at
   * once; issuing five separate `countRunsByState` round trips for a single
   * render would be five times the work for the same answer.
   *
   * States with no runs are present with a count of 0, so callers can read
   * `result.rejected` without a null check.
   */
  countRunsGroupedByState(): Promise<Readonly<Record<RunRow["state"], number>>>;
  /**
   * How many runs have a recorded evidence-gap measurement, and how many of
   * those recorded a gap. Both as counts; the score needs the pair, and a
   * caller that fetched rows to derive them would pay a cost that grows with
   * history forever.
   *
   * `measured` excludes runs predating the measurement (see
   * `RunRow#evidenceGapCount`), so the score's denominator only ever contains
   * runs it can actually speak to.
   */
  countRunsByEvidenceMeasurement(): Promise<{ readonly measured: number; readonly withGaps: number }>;

  /**
   * Creates a run and every artifact it is born with — its evidence packet,
   * proposed action, locked gate, and initiating audit entries — as one
   * atomic write. The alternative (independent `createRun` / `savePacket` /
   * `saveAction` / `saveGate` / `appendAudit` calls) can fail partway
   * through: a later failure leaves a run with no action and no gate, which
   * can never reach `awaiting_approval` and can't be repaired by retrying
   * the request, since a retry mints a brand new run id rather than
   * resuming the broken one. All rows land, or none do — mirrors
   * `createUserWithSession`'s reasoning and (in `createD1Store`) its
   * `db.batch()` mechanism.
   *
   * Atomicity alone is not enough: implementations MUST also verify the
   * aggregate is internally consistent BEFORE writing anything —
   * `packet.incidentId === run.incidentId`, `gate.actionId === action.id`,
   * and every audit entry's `runId === run.id` — and reject (writing
   * nothing) otherwise. Without this, a caller could commit a run whose
   * parts don't belong to each other (another incident's packet, a gate
   * that authorizes a different action, an audit entry attributed to a
   * different run), which a later lookup would then expose as if it
   * genuinely belonged to this run. Same reasoning as the `session.userId
   * !== user.id` guard on `createUserWithSession`.
   */
  createRunWithArtifacts(input: {
    run: RunRow;
    packet: EvidencePacket;
    action: Action;
    gate: ApprovalGate;
    auditEntries: readonly AuditEntry[];
  }): Promise<void>;

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

  /**
   * Atomically decides a gate: transitions its run from `awaiting_approval`
   * to the gate's own decided state (`approved`/`rejected`) AND persists
   * that decision on the gate itself, as one unit — either both writes take
   * effect, or neither does.
   *
   * This exists because `updateRunState` and `saveGate` are each
   * individually an atomic conditional write, but calling them back to back
   * (claim the run, then separately save the gate) is not: a failure
   * between the two — a dropped connection, a rejected write, a genuine
   * race — can leave the run claimed as decided while the gate is still
   * `locked`. That run is then unrecoverable by retry: a retry's
   * `loadDecidableGate`-style check sees `run.state !== "awaiting_approval"`
   * and refuses before ever reaching a gate write again. Implementations
   * MUST apply neither write unless both would succeed, returning `false`
   * (having mutated nothing) whenever the run is not `awaiting_approval` or
   * the gate is not decidable (same conditions `saveGate` alone already
   * enforces: still `locked`, and every immutable field — actionId,
   * createdAt, expiresAt, run association — equal to the stored row's).
   */
  decideGate(gate: ApprovedGate | RejectedGate, runId: string, at: string): Promise<boolean>;

  appendAudit(entry: AuditEntry): Promise<void>;
  /** Oldest-first (a run's own history reads top-to-bottom as a timeline).
   * `limit`, when given, bounds how many entries come back — a route that
   * advertises `?limit=` must apply it here too, not just on
   * `listRecentAudit`'s path. Omitted only where a caller genuinely wants
   * the run's entire history (there is no unbounded-request surface for
   * this form: a single run's audit trail is operator-created, not
   * attacker-controlled input). */
  listAudit(runId: string, limit?: number): Promise<AuditEntry[]>;
  /** The most recent audit entries across every run, newest first, capped at
   * `limit`. Backs a cross-run recent-activity view — a use case
   * `listAudit` (scoped to one run) can't provide. */
  listRecentAudit(limit: number): Promise<AuditEntry[]>;

  /** Newest-first. `limit`, when given, bounds the result the same way
   * `listRuns`'s does. */
  listIncidents(filter?: { status?: string; limit?: number }): Promise<IncidentRow[]>;
  getIncident(id: string): Promise<IncidentRow | null>;
  createIncident(row: IncidentRow): Promise<void>;
  /**
   * `COUNT(*) ... WHERE status != ?` — the Overview screen's "active
   * incidents" tile needs only a number, never every incident row filtered
   * in the Worker. See `countRunsByState`'s doc comment for the same
   * reasoning.
   */
  countIncidentsExcludingStatus(status: string): Promise<number>;

  /**
   * Removes an incident and everything that hangs off it — its runs, and for
   * each run the packet, action, gate, and audit entries — as one atomic
   * write, reporting whether the incident existed and how many runs went
   * with it.
   *
   * The cascade is explicit here rather than delegated to the database
   * because the schema declares no `ON DELETE CASCADE` (only
   * `sessions.user_id REFERENCES users`), so nothing would remove the child
   * rows on its own. Leaving them is not a cosmetic problem: `audit_log`,
   * `gates`, and `actions` are keyed by `run_id`, so orphans stay visible to
   * `listRecentAudit` and `getGate` — the recent-activity feed would render
   * entries for a run that no longer exists, and an orphaned locked gate
   * remains addressable by `/approvals/:id`.
   *
   * Atomicity matters for the same reason it does on
   * `createRunWithArtifacts`, in reverse: a partial delete can strip a run's
   * evidence packet while leaving the run and its gate, which is a run that
   * can never be approved (the evidence check refuses a packet-less run) and
   * can never be cleaned up by retrying, since the incident row it was
   * reached through may already be gone. All rows go, or none do.
   *
   * Deleting is unconditional by design: a run in `collecting` or
   * `awaiting_approval` is removed like any other. Runs only advance through
   * HTTP requests, so there is no in-flight execution to interrupt, and
   * refusing would leave a stuck run undeletable without first resolving its
   * gate.
   */
  deleteIncidentCascade(id: string): Promise<{ deleted: boolean; runCount: number }>;

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
