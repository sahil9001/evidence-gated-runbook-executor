import { evidencePacketSchema, type EvidencePacket } from "../domain/evidence";
import { createAction, type Action } from "../domain/action";
import { approvalGateSchema, type ApprovalGate } from "../domain/approval";
import type {
  Store,
  RunRow,
  AuditEntry,
  IncidentRow,
  UserRow,
  SessionRow
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
    createdBy: record.created_by
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
          `INSERT INTO runs (id, incident_id, runbook_id, service, state, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(run.id, run.incidentId, run.runbookId, run.service, run.state, run.createdAt, run.updatedAt, run.createdBy)
        .run();
    },

    async getRun(id: string): Promise<RunRow | null> {
      const record = await db
        .prepare(
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by FROM runs WHERE id = ?`
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
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by FROM runs${where} ORDER BY created_at DESC${limitClause}`
        )
        .bind(...params)
        .all<RunRecord>();
      return results.map(toRunRow);
    },

    async listRunsByIncident(incidentId: string): Promise<RunRow[]> {
      const { results } = await db
        .prepare(
          `SELECT id, incident_id, runbook_id, service, state, created_at, updated_at, created_by FROM runs WHERE incident_id = ? ORDER BY created_at DESC`
        )
        .bind(incidentId)
        .all<RunRecord>();
      return results.map(toRunRow);
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
      const result = await db
        .prepare(
          `INSERT INTO gates (id, run_id, data) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data
           WHERE json_extract(gates.data, '$.state') = 'locked'`
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

    async appendAudit(entry: AuditEntry): Promise<void> {
      await db
        .prepare(`INSERT INTO audit_log (id, run_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)`)
        .bind(entry.id, entry.runId, entry.at, entry.kind, entry.detail)
        .run();
    },

    async listAudit(runId: string): Promise<AuditEntry[]> {
      const { results } = await db
        .prepare(`SELECT id, run_id, at, kind, detail FROM audit_log WHERE run_id = ? ORDER BY at ASC, id ASC`)
        .bind(runId)
        .all<AuditRecord>();
      return results.map(toAuditEntry);
    },

    async listRecentAudit(limit: number): Promise<AuditEntry[]> {
      const { results } = await db
        .prepare(`SELECT id, run_id, at, kind, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?`)
        .bind(limit)
        .all<AuditRecord>();
      return results.map(toAuditEntry);
    },

    async listIncidents(filter?: { status?: string }): Promise<IncidentRow[]> {
      const where = filter?.status !== undefined ? ` WHERE status = ?` : "";
      const stmt = db.prepare(
        `SELECT id, title, service, signals, status, created_by, created_at FROM incidents${where} ORDER BY created_at DESC`
      );
      const { results } =
        filter?.status !== undefined ? await stmt.bind(filter.status).all<IncidentRecord>() : await stmt.all<IncidentRecord>();
      return results.map(toIncidentRow);
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
