import { createAction, type Action } from "../domain/action";
import { approvalGateSchema, type ApprovalGate } from "../domain/approval";
import { evidencePacketSchema, type EvidencePacket } from "../domain/evidence";
import type {
  Store,
  RunRow,
  AuditEntry,
  IncidentRow,
  UserRow,
  SessionRow
} from "../domain/store";

/**
 * Deep-copies a JSON-safe value. Every read from and write to this store
 * passes through here so callers can never hold a reference into internal
 * state — D1 can't be mutated this way (every read round-trips through
 * `JSON.parse`), and a memory store that handed out live references would
 * make the conformance suite lie about behavioural parity.
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

function byCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

type PacketRecord = { packet: EvidencePacket; runId: string };

/**
 * In-memory implementation of Store, backed by plain Maps. Exists to prove
 * the `Store` port is genuinely pluggable — see
 * `src/store/conformance.ts`, run against this and `createD1Store`
 * identically.
 *
 * Two behaviours are deliberately replicated even though nothing here
 * forces them:
 *  - `appendAudit` rejects a duplicate id. In D1 this is a PRIMARY KEY
 *    constraint; here it's an explicit check. Both enforce append-only.
 *  - `getAction`/`getGate` re-derive/validate on read (via `createAction`
 *    and `approvalGateSchema.parse`) rather than trusting the stored
 *    object, mirroring D1's parse-on-read defence from B1/B2 even though a
 *    `Map` can't hold a "corrupted JSON blob" the way a TEXT column can.
 */
export function createMemoryStore(): Store {
  const runs = new Map<string, RunRow>();
  const packets = new Map<string, PacketRecord>();
  const actions = new Map<string, Action>();
  const gates = new Map<string, ApprovalGate>();
  const auditLog = new Map<string, AuditEntry>();
  const incidents = new Map<string, IncidentRow>();
  const users = new Map<string, UserRow>();
  const userIdByEmail = new Map<string, string>();
  const sessions = new Map<string, SessionRow>();

  return {
    async createRun(run: RunRow): Promise<void> {
      runs.set(run.id, clone(run));
    },

    async getRun(id: string): Promise<RunRow | null> {
      const found = runs.get(id);
      return found === undefined ? null : clone(found);
    },

    async updateRunState(
      id: string,
      state: RunRow["state"],
      at: string,
      expectedState?: RunRow["state"]
    ): Promise<boolean> {
      const existing = runs.get(id);
      if (existing === undefined) return false;
      if (expectedState !== undefined && existing.state !== expectedState) return false;
      runs.set(id, { ...existing, state, updatedAt: at });
      return true;
    },

    async listRuns(filter?: { limit?: number; state?: RunRow["state"] }): Promise<RunRow[]> {
      let rows = [...runs.values()];
      if (filter?.state !== undefined) {
        const wantedState = filter.state;
        rows = rows.filter((r) => r.state === wantedState);
      }
      rows = rows.sort(byCreatedAtDesc);
      if (filter?.limit !== undefined) rows = rows.slice(0, filter.limit);
      return rows.map(clone);
    },

    async listRunsByIncident(incidentId: string): Promise<RunRow[]> {
      return [...runs.values()]
        .filter((r) => r.incidentId === incidentId)
        .sort(byCreatedAtDesc)
        .map(clone);
    },

    async savePacket(packet: EvidencePacket, runId: string): Promise<void> {
      const validated = evidencePacketSchema.parse(packet);
      packets.set(validated.id, { packet: clone(validated), runId });
    },

    async getPacketByIncident(incidentId: string): Promise<EvidencePacket | null> {
      // M1: latest by `builtAt`, matching the D1 adapter's `ORDER BY
      // built_at DESC` — never by id, which carries no notion of recency.
      const matches = [...packets.values()].filter((p) => p.packet.incidentId === incidentId);
      if (matches.length === 0) return null;
      const latest = matches.reduce((best, current) => (current.packet.builtAt > best.packet.builtAt ? current : best));
      return evidencePacketSchema.parse(clone(latest.packet));
    },

    async saveAction(action: Action): Promise<void> {
      actions.set(action.id, clone(action));
    },

    async getAction(id: string): Promise<Action | null> {
      const found = actions.get(id);
      if (found === undefined) return null;
      // createAction re-derives isStateChanging from kind — same defence as
      // the D1 adapter's getAction. See class doc comment.
      return createAction(clone(found));
    },

    async saveGate(gate: ApprovalGate): Promise<void> {
      gates.set(gate.id, clone(gate));
    },

    async getGate(id: string): Promise<ApprovalGate | null> {
      const found = gates.get(id);
      if (found === undefined) return null;
      // Validated on read, not cast — same defence as the D1 adapter's
      // getGate. See class doc comment.
      return approvalGateSchema.parse(clone(found));
    },

    async appendAudit(entry: AuditEntry): Promise<void> {
      // The append-only guarantee: in D1 this is enforced by
      // `audit_log.id`'s PRIMARY KEY; here it's this explicit check. Either
      // way a second write with a previously-used id must fail instead of
      // silently overwriting the original entry.
      if (auditLog.has(entry.id)) {
        throw new Error(`audit_log entry with id "${entry.id}" already exists (append-only)`);
      }
      auditLog.set(entry.id, clone(entry));
    },

    async listAudit(runId: string): Promise<AuditEntry[]> {
      return [...auditLog.values()]
        .filter((e) => e.runId === runId)
        .sort((a, b) => {
          if (a.at !== b.at) return a.at < b.at ? -1 : 1;
          if (a.id !== b.id) return a.id < b.id ? -1 : 1;
          return 0;
        })
        .map(clone);
    },

    async listIncidents(filter?: { status?: string }): Promise<IncidentRow[]> {
      let rows = [...incidents.values()];
      if (filter?.status !== undefined) {
        const wantedStatus = filter.status;
        rows = rows.filter((r) => r.status === wantedStatus);
      }
      return rows.sort(byCreatedAtDesc).map(clone);
    },

    async getIncident(id: string): Promise<IncidentRow | null> {
      const found = incidents.get(id);
      return found === undefined ? null : clone(found);
    },

    async createIncident(row: IncidentRow): Promise<void> {
      incidents.set(row.id, clone(row));
    },

    async createUser(row: UserRow): Promise<void> {
      users.set(row.id, clone(row));
      userIdByEmail.set(row.email, row.id);
    },

    async getUserByEmail(email: string): Promise<UserRow | null> {
      const id = userIdByEmail.get(email);
      if (id === undefined) return null;
      const found = users.get(id);
      return found === undefined ? null : clone(found);
    },

    async getUserById(id: string): Promise<UserRow | null> {
      const found = users.get(id);
      return found === undefined ? null : clone(found);
    },

    async createSession(row: SessionRow): Promise<void> {
      sessions.set(row.id, clone(row));
    },

    async getSession(id: string): Promise<SessionRow | null> {
      const found = sessions.get(id);
      return found === undefined ? null : clone(found);
    },

    async deleteSession(id: string): Promise<void> {
      sessions.delete(id);
    },

    async deleteExpiredSessions(nowIso: string): Promise<void> {
      const expiredIds = [...sessions.values()].filter((s) => s.expiresAt <= nowIso).map((s) => s.id);
      for (const id of expiredIds) sessions.delete(id);
    }
  };
}
