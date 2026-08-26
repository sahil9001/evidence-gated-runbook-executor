import { evidencePacketSchema, type EvidencePacket } from "./evidence";
import { createAction, type Action } from "./action";
import { approvalGateSchema, type ApprovalGate } from "./approval";

export type RunRow = {
  id: string;
  incidentId: string;
  runbookId: string;
  service: string;
  state: "collecting" | "awaiting_approval" | "approved" | "rejected" | "executed";
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  id: string;
  runId: string;
  at: string;
  kind: string;
  detail: string;
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
  savePacket(packet: EvidencePacket, runId: string): Promise<void>;
  getPacketByIncident(incidentId: string): Promise<EvidencePacket | null>;
  saveAction(action: Action, runId: string): Promise<void>;
  getAction(id: string): Promise<Action | null>;
  saveGate(gate: ApprovalGate, runId: string): Promise<void>;
  getGate(id: string): Promise<ApprovalGate | null>;
  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(runId: string): Promise<AuditEntry[]>;
}

type RunRecord = {
  id: string;
  incident_id: string;
  runbook_id: string;
  service: string;
  state: string;
  created_at: string;
  updated_at: string;
};

function toRunRow(record: RunRecord): RunRow {
  return {
    id: record.id,
    incidentId: record.incident_id,
    runbookId: record.runbook_id,
    service: record.service,
    state: record.state as RunRow["state"],
    createdAt: record.created_at,
    updatedAt: record.updated_at
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

/**
 * D1-backed implementation of Store. Packets, actions, and gates are read
 * whole and never queried by field, so each is persisted as a single
 * validated JSON blob rather than being decomposed into columns.
 *
 * The audit log is append-only: `audit_log.id` is a PRIMARY KEY, so a second
 * `appendAudit` call with a previously-used id fails at the database layer
 * instead of silently overwriting the original entry. No statement in this
 * file (or anywhere else in the codebase) may UPDATE or DELETE audit_log.
 */
export function createD1Store(db: D1Database): Store {
  return {
    async createRun(run: RunRow): Promise<void> {
      await db
        .prepare(
          `INSERT INTO runs (id, incident_id, runbook_id, service, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(run.id, run.incidentId, run.runbookId, run.service, run.state, run.createdAt, run.updatedAt)
        .run();
    },

    async getRun(id: string): Promise<RunRow | null> {
      const record = await db
        .prepare(`SELECT id, incident_id, runbook_id, service, state, created_at, updated_at FROM runs WHERE id = ?`)
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
      // atomic claim that closes the approve/reject TOCTOU race: two
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

    async savePacket(packet: EvidencePacket, runId: string): Promise<void> {
      const validated = evidencePacketSchema.parse(packet);
      await db
        .prepare(`INSERT INTO packets (id, incident_id, run_id, data) VALUES (?, ?, ?, ?)`)
        .bind(validated.id, validated.incidentId, runId, JSON.stringify(validated))
        .run();
    },

    async getPacketByIncident(incidentId: string): Promise<EvidencePacket | null> {
      const record = await db
        .prepare(`SELECT data FROM packets WHERE incident_id = ? ORDER BY id LIMIT 1`)
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
      // token check entirely. See docs/CONSOLE-STATUS.md invariants.
      return createAction(JSON.parse(record.data));
    },

    async saveGate(gate: ApprovalGate, runId: string): Promise<void> {
      // Gates hold current state (unlike audit_log, which holds immutable
      // history) — a gate is created locked, then decided exactly once, and
      // the decided variant must replace the locked row so `getGate` agrees
      // with `RunRow.state` across requests. Upsert on the `id` PRIMARY KEY.
      await db
        .prepare(
          `INSERT INTO gates (id, run_id, data) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`
        )
        .bind(gate.id, runId, JSON.stringify(gate))
        .run();
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
    }
  };
}
