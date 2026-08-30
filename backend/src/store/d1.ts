import { evidencePacketSchema, type EvidencePacket } from "../domain/evidence";
import { createAction, type Action } from "../domain/action";
import { approvalGateSchema, type ApprovalGate, type ApprovedGate, type RejectedGate } from "../domain/approval";
import {
  RUN_STATES,
  type Store,
  type RunRow,
  type AuditEntry,
  type IncidentRow,
  type UserRow,
  type SessionRow
} from "../domain/store";

type RunRecord = {
  id: string;
  incident_id: string;
  runbook_id: string;
  service: string;
  state: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  evidence_gap_count: number | null;
};

function toRunRow(record: RunRecord): RunRow {
  return {
    id: record.id,
    incidentId: record.incident_id,
    runbookId: record.runbook_id,
    service: record.service,
    state: record.state as RunRow["state"],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    createdBy: record.created_by,
    evidenceGapCount: record.evidence_gap_count
  };
}

type JsonBodyRecord = { data: string };

type AuditRecord = {
  id: string;
  run_id: string;
  at: string;
  kind: string;
  detail: string;
};

function toAuditEntry(record: AuditRecord): AuditEntry {
  return { id: record.id, runId: record.run_id, at: record.at, kind: record.kind, detail: record.detail };
}

type IncidentRecord = {
  id: string;
  title: string;
  service: string;
  signals: string;
  status: string;
  created_by: string;
  created_at: string;
};

function toIncidentRow(record: IncidentRecord): IncidentRow {
  return {
    id: record.id,
    title: record.title,
    service: record.service,
    signals: JSON.parse(record.signals) as string[],
    status: record.status,
    createdBy: record.created_by,
    createdAt: record.created_at
  };
}

type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at: string;
};

function toUserRow(record: UserRecord): UserRow {
  return {
    id: record.id,
    email: record.email,
    passwordHash: record.password_hash,
    salt: record.salt,
    createdAt: record.created_at
  };
}

type SessionRecord = {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
};

function toSessionRow(record: SessionRecord): SessionRow {
  return { id: record.id, userId: record.user_id, createdAt: record.created_at, expiresAt: record.expires_at };
}

/**
 * D1-backed implementation of Store. Packets, actions, and gates are read
 * whole and never queried by field, so each is persisted as a single
 * validated JSON blob rather than being decomposed into columns.
 *
 * The audit log is append-only: `audit_log.id` is a PRIMARY KEY, so a second
 * `appendAudit` call with a previously-used id fails at the database layer
 * instead of silently overwriting the original entry. No statement in this
 * file (or anywhere else in the codebase) may UPDATE or DELETE audit_log.
 *
 * `ApprovalToken` is never persisted here — only `ApprovalGate`. Tokens are
 * in-process-identity-only (see `domain/approval.ts`) and cannot survive a
 * JSON round trip.
 */
export function createD1Store(db: D1Database): Store {
  return {
    async createRun(run: RunRow): Promise<void> {
      await db
        .prepare(
          `INSERT INTO runs (id, incident_id, runbook_id, service, state, created_at, updated_at, created_by, evidence_gap_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          run.id,
          run.incidentId,
          run.runbookId,
          run.service,
          run.state,
          run.createdAt,
          run.updatedAt,
          run.createdBy,
          run.evidenceGapCount
        )
        .run();
    },

    async getRun(id: string): Promise<RunRow | null> {
      const record = await db
        .prepare(
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by, evidence_gap_count FROM runs WHERE id = ?`
        )
        .bind(id)
        .first<RunRecord>();
      return record === null ? null : toRunRow(record);
    },

    async updateRunState(
      id: string,
      state: RunRow["state"],
      at: string,
      expectedState?: RunRow["state"]
    ): Promise<boolean> {
      // When `expectedState` is given, the WHERE clause makes this the
      // atomic claim that closes an approve/reject TOCTOU race: two
      // concurrent requests both reading `awaiting_approval` will race this
      // UPDATE, but only one row transitions (`state = 'awaiting_approval'`
      // matches for exactly one of them), so `meta.changes` distinguishes
      // the winner from the loser without a separate transaction.
      const result =
        expectedState === undefined
          ? await db.prepare(`UPDATE runs SET state = ?, updated_at = ? WHERE id = ?`).bind(state, at, id).run()
          : await db
              .prepare(`UPDATE runs SET state = ?, updated_at = ? WHERE id = ? AND state = ?`)
              .bind(state, at, id, expectedState)
              .run();
      return result.meta.changes === 1;
    },

    async listRuns(filter?: { limit?: number; state?: RunRow["state"] }): Promise<RunRow[]> {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter?.state !== undefined) {
        clauses.push("state = ?");
        params.push(filter.state);
      }
      const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
      const limitClause = filter?.limit !== undefined ? ` LIMIT ?` : "";
      if (filter?.limit !== undefined) params.push(filter.limit);

      const { results } = await db
        .prepare(
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by, evidence_gap_count FROM runs${where} ORDER BY created_at DESC${limitClause}`
        )
        .bind(...params)
        .all<RunRecord>();
      return results.map(toRunRow);
    },

    async listRunsByIncident(incidentId: string, limit?: number): Promise<RunRow[]> {
      const limitClause = limit !== undefined ? ` LIMIT ?` : "";
      const params = limit !== undefined ? [incidentId, limit] : [incidentId];
      const { results } = await db
        .prepare(
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by, evidence_gap_count FROM runs WHERE incident_id = ? ORDER BY created_at DESC${limitClause}`
        )
        .bind(...params)
        .all<RunRecord>();
      return results.map(toRunRow);
    },

    async countRunsByState(state: RunRow["state"]): Promise<number> {
      const record = await db
        .prepare(`SELECT COUNT(*) as count FROM runs WHERE state = ?`)
        .bind(state)
        .first<{ count: number }>();
      return record?.count ?? 0;
    },

    async countRunsSince(sinceIso: string): Promise<number> {
      const record = await db
        .prepare(`SELECT COUNT(*) as count FROM runs WHERE created_at >= ?`)
        .bind(sinceIso)
        .first<{ count: number }>();
      return record?.count ?? 0;
    },

    async countRunsGroupedByState(): Promise<Readonly<Record<RunRow["state"], number>>> {
      const result = await db
        .prepare(`SELECT state, COUNT(*) as count FROM runs GROUP BY state`)
        .all<{ state: RunRow["state"]; count: number }>();

      // Seeded with zeros so a state with no rows still reads as 0 rather
      // than undefined; GROUP BY only returns states that actually occur.
      const counts = Object.fromEntries(RUN_STATES.map((state) => [state, 0])) as Record<
        RunRow["state"],
        number
      >;
      for (const row of result.results ?? []) {
        if (row.state in counts) counts[row.state] = row.count;
      }
      return counts;
    },

    async countRunsByEvidenceMeasurement(): Promise<{ measured: number; withGaps: number }> {
      // One row, two counts: SUM over a boolean beats a second round trip,
      // and both terms stay index-backed by idx_runs_evidence_gap_count.
      const record = await db
        .prepare(
          `SELECT COUNT(*) as measured,
                  COALESCE(SUM(CASE WHEN evidence_gap_count > 0 THEN 1 ELSE 0 END), 0) as withGaps
             FROM runs
            WHERE evidence_gap_count IS NOT NULL`
        )
        .first<{ measured: number; withGaps: number }>();
      return { measured: record?.measured ?? 0, withGaps: record?.withGaps ?? 0 };
    },

    async createRunWithArtifacts(input: {
      run: RunRow;
      packet: EvidencePacket;
      action: Action;
      gate: ApprovalGate;
      auditEntries: readonly AuditEntry[];
    }): Promise<void> {
      const { run, packet, action, gate, auditEntries } = input;
      const validatedPacket = evidencePacketSchema.parse(packet);

      // Validating each row's OWN shape (above, and implicitly via the
      // typed parameters) says nothing about whether the rows belong
      // together. Nothing before this point stops a caller from handing
      // over an internally inconsistent aggregate — a packet built for a
      // different incident, a gate that authorizes a different action, or
      // an audit entry stamped with a different run's id — which the batch
      // below would otherwise commit as-is: every INSERT here is
      // unconditional, so D1 has no constraint of its own that would catch
      // it. A later lookup (getPacketByRun, getGate, listAudit) would then
      // hand back another run's evidence, action authorization, or audit
      // history as if it belonged to THIS run. Same class of bug as
      // createUserWithSession's session/user pairing check: relationships
      // must be verified before anything is written, not left to whatever
      // the caller happened to pass in.
      if (validatedPacket.incidentId !== run.incidentId) {
        throw new Error(
          `createRunWithArtifacts: packet.incidentId ("${validatedPacket.incidentId}") does not match run.incidentId ("${run.incidentId}")`
        );
      }
      if (gate.actionId !== action.id) {
        throw new Error(
          `createRunWithArtifacts: gate.actionId ("${gate.actionId}") does not match action.id ("${action.id}")`
        );
      }
      for (const entry of auditEntries) {
        if (entry.runId !== run.id) {
          throw new Error(
            `createRunWithArtifacts: audit entry "${entry.id}" has runId ("${entry.runId}") that does not match run.id ("${run.id}")`
          );
        }
      }

      // Every row is a plain (non-conditional) INSERT, so db.batch()'s
      // transaction is sufficient on its own: any single INSERT failing
      // (e.g. a duplicate id colliding with a PRIMARY KEY) throws, and D1
      // rolls back the whole batch rather than leaving a partial run
      // behind. See the doc comment on Store#createRunWithArtifacts.
      await db.batch([
        db
          .prepare(
            `INSERT INTO runs (id, incident_id, runbook_id, service, state, created_at, updated_at, created_by, evidence_gap_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            run.id,
            run.incidentId,
            run.runbookId,
            run.service,
            run.state,
            run.createdAt,
            run.updatedAt,
            run.createdBy,
            run.evidenceGapCount
          ),
        db
          .prepare(`INSERT INTO packets (id, incident_id, run_id, data, built_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(validatedPacket.id, validatedPacket.incidentId, run.id, JSON.stringify(validatedPacket), validatedPacket.builtAt),
        db
          .prepare(`INSERT INTO actions (id, run_id, data) VALUES (?, ?, ?)`)
          .bind(action.id, run.id, JSON.stringify(action)),
        db
          .prepare(`INSERT INTO gates (id, run_id, data) VALUES (?, ?, ?)`)
          .bind(gate.id, run.id, JSON.stringify(gate)),
        ...auditEntries.map((entry) =>
          db
            .prepare(`INSERT INTO audit_log (id, run_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)`)
            .bind(entry.id, entry.runId, entry.at, entry.kind, entry.detail)
        )
      ]);
    },

    async savePacket(packet: EvidencePacket, runId: string): Promise<void> {
      const validated = evidencePacketSchema.parse(packet);
      await db
        .prepare(`INSERT INTO packets (id, incident_id, run_id, data, built_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(validated.id, validated.incidentId, runId, JSON.stringify(validated), validated.builtAt)
        .run();
    },

    async getPacketByIncident(incidentId: string): Promise<EvidencePacket | null> {
      // Ordered by `built_at DESC`, not by the packet's UUID primary key —
      // a UUID has no relationship to recency, so ordering by id would
      // return an arbitrary packet whenever an incident had more than one.
      const record = await db
        .prepare(`SELECT data FROM packets WHERE incident_id = ? ORDER BY built_at DESC LIMIT 1`)
        .bind(incidentId)
        .first<JsonBodyRecord>();
      if (record === null) return null;
      return evidencePacketSchema.parse(JSON.parse(record.data));
    },

    async getPacketByRun(runId: string): Promise<EvidencePacket | null> {
      // Scoped strictly to this run's own packet(s) — never any other run's,
      // even one on the same incident. See the doc comment on
      // Store#getPacketByRun.
      const record = await db
        .prepare(`SELECT data FROM packets WHERE run_id = ? ORDER BY built_at DESC LIMIT 1`)
        .bind(runId)
        .first<JsonBodyRecord>();
      if (record === null) return null;
      return evidencePacketSchema.parse(JSON.parse(record.data));
    },

    async saveAction(action: Action, runId: string): Promise<void> {
      await db
        .prepare(`INSERT INTO actions (id, run_id, data) VALUES (?, ?, ?)`)
        .bind(action.id, runId, JSON.stringify(action))
        .run();
    },

    async getAction(id: string): Promise<Action | null> {
      const record = await db.prepare(`SELECT data FROM actions WHERE id = ?`).bind(id).first<JsonBodyRecord>();
      if (record === null) return null;
      // createAction re-derives isStateChanging from kind and ignores any
      // stored value — a cast here would let a corrupted or tampered row
      // (e.g. a persisted rollback with isStateChanging: false) resurrect a
      // state-changing action as read-only, routing it past the approval
      // token check entirely.
      return createAction(JSON.parse(record.data));
    },

    async saveGate(gate: ApprovalGate, runId: string): Promise<boolean> {
      // Gates hold current state (unlike audit_log, which holds immutable
      // history) — a gate is created locked, then decided exactly once
      // (`locked -> approved` or `locked -> rejected`), never anything
      // else, and never back to locked. The upsert is conditional on the
      // *stored* row still being `locked`: once a row has been decided, no
      // further write — a conflicting decision or a stale locked value —
      // may touch it. `meta.changes` distinguishes a write that actually
      // took effect (fresh insert, or an update that matched the WHERE
      // clause) from one the WHERE clause silently blocked, so two callers
      // racing to decide the same gate can never both believe they won.
      //
      // `state = 'locked'` alone is not enough: it only stops a write from
      // touching an already-decided row, but says nothing about *what* a
      // same-id write over a still-locked row is allowed to change. Without
      // more, a same-id gate with a different actionId/createdAt/expiresAt
      // (or a different run_id) would pass this check and replace the row
      // that was actually persisted — breaking the gate-to-action binding —
      // and then be free to be approved. So the WHERE clause additionally
      // pins every immutable field (actionId, createdAt, expiresAt, and the
      // run association) to equal the *stored* row's value: an upsert may
      // only ever advance a locked gate's decision, never rebind it.
      const result = await db
        .prepare(
          `INSERT INTO gates (id, run_id, data) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data
           WHERE json_extract(gates.data, '$.state') = 'locked'
             AND json_extract(gates.data, '$.actionId') = json_extract(excluded.data, '$.actionId')
             AND json_extract(gates.data, '$.createdAt') = json_extract(excluded.data, '$.createdAt')
             AND json_extract(gates.data, '$.expiresAt') = json_extract(excluded.data, '$.expiresAt')
             AND gates.run_id = excluded.run_id`
        )
        .bind(gate.id, runId, JSON.stringify(gate))
        .run();
      return result.meta.changes === 1;
    },

    async getGate(id: string): Promise<ApprovalGate | null> {
      const record = await db.prepare(`SELECT data FROM gates WHERE id = ?`).bind(id).first<JsonBodyRecord>();
      if (record === null) return null;
      // Validated on read like savePacket/getPacketByIncident, not cast: a
      // corrupt expiresAt must fail loudly here rather than produce a gate
      // that isExpired can never report as expired (Date.parse on garbage
      // is NaN, and every comparison against NaN is false).
      return approvalGateSchema.parse(JSON.parse(record.data));
    },

    async decideGate(gate: ApprovedGate | RejectedGate, runId: string, at: string): Promise<boolean> {
      // Both statements run inside one db.batch() transaction, and each is
      // additionally conditioned on the OTHER statement's target outcome via
      // a correlated subquery — not just each row's own prior state. This is
      // what makes the pair genuinely joint: a plain db.batch() of two
      // independently-conditioned writes only guarantees "both applied, or
      // an exception rolled both back" — it does nothing to stop one
      // conditional write succeeding (`meta.changes === 1`) while the other
      // is silently skipped (`meta.changes === 0`), which is exactly the
      // split-brain this method exists to prevent. See the doc comment on
      // Store#decideGate.
      //
      // Statement 1 (the run claim) additionally requires the gate to
      // currently be `locked` — read from its PRE-transaction value, since
      // this runs first. It is NOT enough to check `state = 'locked'` alone:
      // that only rules out an already-decided gate, but says nothing about
      // whether THIS particular decision is the one bound to that locked
      // row. Without pinning every immutable field (actionId, createdAt,
      // expiresAt) and the run association, a same-id decision for the
      // WRONG action (or the wrong run) would pass this check and commit the
      // run claim, while statement 2 below — which does pin those fields —
      // is silently skipped (`meta.changes === 0`). db.batch() does not
      // error on a conditional UPDATE that matches zero rows, so that split
      // would commit as part of the same transaction: the run flips to
      // approved/rejected while the gate stays locked forever, and no retry
      // can ever repair it (loadDecidableGate refuses once `run.state !==
      // "awaiting_approval"`). So statement 1 is conditioned on the exact
      // same binding statement 2 enforces, via a correlated EXISTS against
      // the gate's PRE-transaction row.
      //
      // Statement 2 (the gate decision) additionally requires the run to
      // now equal the gate's own decided state — read AFTER statement 1 has
      // applied (statements inside one transaction observe each other's
      // writes), so this only takes effect once the claim above has
      // actually landed.
      //
      // Unlike saveGate, this is a plain UPDATE — never an upsert. saveGate
      // is used at gate *creation* and may legitimately INSERT a fresh
      // locked row; decideGate only ever ADVANCES a gate that some prior
      // saveGate already locked. An `INSERT ... ON CONFLICT DO UPDATE`
      // would take its unconditional INSERT branch whenever `gate.id` names
      // no existing row — including a gate that was never created, or one
      // whose creation this same decision attempt just lost the race to
      // (statement 1's EXISTS would then also see nothing and refuse the
      // run claim) — and persist a decided gate for a run that was never
      // claimed. A bare UPDATE has no such branch: it simply matches zero
      // rows and changes nothing, so `decideGate` returning `false` and the
      // gate table being untouched stay the same fact.
      const results = await db.batch([
        db
          .prepare(
            `UPDATE runs SET state = ?, updated_at = ?
             WHERE id = ? AND state = 'awaiting_approval'
               AND EXISTS (
                 SELECT 1 FROM gates
                 WHERE id = ?
                   AND run_id = ?
                   AND json_extract(data, '$.state') = 'locked'
                   AND json_extract(data, '$.actionId') = ?
                   AND json_extract(data, '$.createdAt') = ?
                   AND json_extract(data, '$.expiresAt') = ?
               )`
          )
          .bind(gate.state, at, runId, gate.id, runId, gate.actionId, gate.createdAt, gate.expiresAt),
        db
          .prepare(
            `UPDATE gates SET data = ?
             WHERE id = ? AND run_id = ?
               AND json_extract(data, '$.state') = 'locked'
               AND json_extract(data, '$.actionId') = ?
               AND json_extract(data, '$.createdAt') = ?
               AND json_extract(data, '$.expiresAt') = ?
               AND (SELECT state FROM runs WHERE id = ?) = ?`
          )
          .bind(JSON.stringify(gate), gate.id, runId, gate.actionId, gate.createdAt, gate.expiresAt, runId, gate.state)
      ]);
      const [runResult, gateResult] = results;
      if (runResult === undefined || gateResult === undefined) return false;
      return runResult.meta.changes === 1 && gateResult.meta.changes === 1;
    },

    async appendAudit(entry: AuditEntry): Promise<void> {
      await db
        .prepare(`INSERT INTO audit_log (id, run_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)`)
        .bind(entry.id, entry.runId, entry.at, entry.kind, entry.detail)
        .run();
    },

    async listAudit(runId: string, limit?: number): Promise<AuditEntry[]> {
      // Unlimited: plain ascending order (the run-detail Audit tab's
      // top-to-bottom contract). Limited: a limit must cap to the NEWEST
      // entries, not the oldest, so this selects the newest `limit` rows
      // first (DESC) and re-sorts that window back to ascending in JS —
      // `ORDER BY at ASC LIMIT ?` would instead keep the OLDEST rows and
      // silently drop everything more recent than the cutoff.
      if (limit === undefined) {
        const { results } = await db
          .prepare(`SELECT id, run_id, at, kind, detail FROM audit_log WHERE run_id = ? ORDER BY at ASC, id ASC`)
          .bind(runId)
          .all<AuditRecord>();
        return results.map(toAuditEntry);
      }

      const { results } = await db
        .prepare(
          `SELECT id, run_id, at, kind, detail FROM audit_log WHERE run_id = ? ORDER BY at DESC, id DESC LIMIT ?`
        )
        .bind(runId, limit)
        .all<AuditRecord>();
      return results.map(toAuditEntry).reverse();
    },

    async listRecentAudit(limit: number): Promise<AuditEntry[]> {
      const { results } = await db
        .prepare(`SELECT id, run_id, at, kind, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?`)
        .bind(limit)
        .all<AuditRecord>();
      return results.map(toAuditEntry);
    },

    async listIncidents(filter?: { status?: string; limit?: number }): Promise<IncidentRow[]> {
      const where = filter?.status !== undefined ? ` WHERE status = ?` : "";
      const limitClause = filter?.limit !== undefined ? ` LIMIT ?` : "";
      const params: unknown[] = [];
      if (filter?.status !== undefined) params.push(filter.status);
      if (filter?.limit !== undefined) params.push(filter.limit);

      const { results } = await db
        .prepare(
          `SELECT id, title, service, signals, status, created_by, created_at FROM incidents${where} ORDER BY created_at DESC${limitClause}`
        )
        .bind(...params)
        .all<IncidentRecord>();
      return results.map(toIncidentRow);
    },

    async countIncidentsExcludingStatus(status: string): Promise<number> {
      const record = await db
        .prepare(`SELECT COUNT(*) as count FROM incidents WHERE status != ?`)
        .bind(status)
        .first<{ count: number }>();
      return record?.count ?? 0;
    },

    async getIncident(id: string): Promise<IncidentRow | null> {
      const record = await db
        .prepare(`SELECT id, title, service, signals, status, created_by, created_at FROM incidents WHERE id = ?`)
        .bind(id)
        .first<IncidentRecord>();
      return record === null ? null : toIncidentRow(record);
    },

    async createIncident(row: IncidentRow): Promise<void> {
      await db
        .prepare(
          `INSERT INTO incidents (id, title, service, signals, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(row.id, row.title, row.service, JSON.stringify(row.signals), row.status, row.createdBy, row.createdAt)
        .run();
    },

    async createUser(row: UserRow): Promise<void> {
      await db
        .prepare(`INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(row.id, row.email, row.passwordHash, row.salt, row.createdAt)
        .run();
    },

    async createUserWithSession(user: UserRow, session: SessionRow): Promise<void> {
      // The whole point of this method is that a user and THEIR OWN first
      // session commit together. Nothing about the batch below enforces
      // that: `sessions.user_id REFERENCES users (id)` only checks that
      // *some* row with that id exists, not that it's the row being created
      // in this same call. Without this check, a caller passing a session
      // whose userId names a different, already-existing user would create
      // the new user but hand back a session that authenticates the OTHER
      // account — an auth-bypass shape, not a data-integrity nit. This must
      // never be reachable from the register route (buildSession always
      // pairs userId to the freshly minted user id), so this throws rather
      // than degrading gracefully — it's a programming error, not a
      // user-facing condition.
      if (session.userId !== user.id) {
        throw new Error(
          `createUserWithSession: session.userId ("${session.userId}") does not match user.id ("${user.id}")`
        );
      }

      // db.batch() commits its statements as a single SQL transaction: if
      // either INSERT fails (e.g. a duplicate email or duplicate session
      // id), the whole batch rolls back rather than leaving a user row with
      // no session. See the doc comment on Store#createUserWithSession.
      await db.batch([
        db
          .prepare(`INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(user.id, user.email, user.passwordHash, user.salt, user.createdAt),
        db
          .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
          .bind(session.id, session.userId, session.createdAt, session.expiresAt)
      ]);
    },

    async getUserByEmail(email: string): Promise<UserRow | null> {
      const record = await db
        .prepare(`SELECT id, email, password_hash, salt, created_at FROM users WHERE email = ?`)
        .bind(email)
        .first<UserRecord>();
      return record === null ? null : toUserRow(record);
    },

    async getUserById(id: string): Promise<UserRow | null> {
      const record = await db
        .prepare(`SELECT id, email, password_hash, salt, created_at FROM users WHERE id = ?`)
        .bind(id)
        .first<UserRecord>();
      return record === null ? null : toUserRow(record);
    },

    async createSession(row: SessionRow): Promise<void> {
      await db
        .prepare(`INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
        .bind(row.id, row.userId, row.createdAt, row.expiresAt)
        .run();
    },

    async getSession(id: string): Promise<SessionRow | null> {
      const record = await db
        .prepare(`SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?`)
        .bind(id)
        .first<SessionRecord>();
      return record === null ? null : toSessionRow(record);
    },

    async deleteSession(id: string): Promise<void> {
      await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    },

    async deleteExpiredSessions(nowIso: string): Promise<void> {
      await db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(nowIso).run();
    }
  };
}
