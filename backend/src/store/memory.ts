import { createAction, type Action } from "../domain/action";
import { approvalGateSchema, type ApprovalGate, type ApprovedGate, type RejectedGate } from "../domain/approval";
import { evidencePacketSchema, type EvidencePacket } from "../domain/evidence";
import {
  StoreConflictError,
  type Store,
  type RunRow,
  type AuditEntry,
  type IncidentRow,
  type UserRow,
  type SessionRow
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
type GateRecord = { gate: ApprovalGate; runId: string };

/**
 * In-memory implementation of Store, backed by plain Maps. Exists to prove
 * the `Store` port is genuinely pluggable — see `src/store/conformance.ts`,
 * run against this and `createD1Store` identically.
 *
 * Several behaviours are deliberately replicated even though nothing here
 * forces them:
 *  - `appendAudit` rejects a duplicate id. In D1 this is a PRIMARY KEY
 *    constraint; here it's an explicit check. Both enforce append-only.
 *  - `getAction`/`getGate` re-derive/validate on read (via `createAction`
 *    and `approvalGateSchema.parse`) rather than trusting the stored
 *    object, mirroring D1's parse-on-read defence even though a `Map`
 *    can't hold a "corrupted JSON blob" the way a TEXT column can.
 *  - Every `create*`/`save*` write that D1 backs with a plain (non-upsert)
 *    INSERT on a PRIMARY KEY or UNIQUE column (`runs`, `packets`, `actions`,
 *    `incidents`, `sessions`, and `users` on both `id` and `email`) throws
 *    `StoreConflictError` on a duplicate here too, instead of `Map.set`
 *    silently overwriting or remapping. The uniqueness check runs before
 *    any map is mutated, so a rejected write can never leave a stale index
 *    entry behind (e.g. `userIdByEmail` pointing at a row whose email no
 *    longer matches). `saveGate` is the one exception: its one-way
 *    locked -> decided upsert rule is enforced separately, see below.
 *  - `createSession` rejects a `userId` naming a user that doesn't exist,
 *    mirroring the `sessions.user_id REFERENCES users (id)` foreign key
 *    (migrations/0002_auth_and_incidents.sql) — the only FK in the schema.
 *    `createUserWithSession` additionally rejects a `session.userId` that
 *    doesn't match the `user.id` it's being paired with; see its own doc
 *    comment on `Store#createUserWithSession`.
 *
 * `ApprovalToken` is never persisted here either — same rule as the D1
 * adapter. Only `ApprovalGate` is stored.
 */
export function createMemoryStore(): Store {
  const runs = new Map<string, RunRow>();
  const packets = new Map<string, PacketRecord>();
  const actions = new Map<string, Action>();
  const gates = new Map<string, GateRecord>();
  const auditLog = new Map<string, AuditEntry>();
  const incidents = new Map<string, IncidentRow>();
  const users = new Map<string, UserRow>();
  const userIdByEmail = new Map<string, string>();
  const sessions = new Map<string, SessionRow>();

  return {
    async createRun(run: RunRow): Promise<void> {
      if (runs.has(run.id)) throw new StoreConflictError(`run with id "${run.id}" already exists`);
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

    async createRunWithArtifacts(input: {
      run: RunRow;
      packet: EvidencePacket;
      action: Action;
      gate: ApprovalGate;
      auditEntries: readonly AuditEntry[];
    }): Promise<void> {
      const { run, packet, action, gate, auditEntries } = input;
      const validatedPacket = evidencePacketSchema.parse(packet);

      // Mirrors the D1 adapter's relationship checks (store/d1.ts) before
      // its own conflict checks below: validating each row's own shape says
      // nothing about whether the rows belong together, and a `Map.set`
      // would happily accept a packet built for a different incident, a
      // gate that authorizes a different action, or an audit entry stamped
      // with a different run's id. Left unchecked, a later lookup
      // (getPacketByRun, getGate, listAudit) would hand back another run's
      // evidence, action authorization, or audit history as if it belonged
      // to THIS run. Same class of check as createUserWithSession's
      // session/user pairing.
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

      // Every conflict check for every row runs before any map is touched —
      // same discipline as createUserWithSession — so a rejected write can
      // never leave a partial run (e.g. a run row with no action/gate)
      // behind. See the doc comment on Store#createRunWithArtifacts.
      if (runs.has(run.id)) throw new StoreConflictError(`run with id "${run.id}" already exists`);
      if (packets.has(validatedPacket.id)) {
        throw new StoreConflictError(`packet with id "${validatedPacket.id}" already exists`);
      }
      if (actions.has(action.id)) throw new StoreConflictError(`action with id "${action.id}" already exists`);
      if (gates.has(gate.id)) throw new StoreConflictError(`gate with id "${gate.id}" already exists`);
      for (const entry of auditEntries) {
        if (auditLog.has(entry.id)) {
          throw new Error(`audit_log entry with id "${entry.id}" already exists (append-only)`);
        }
      }

      runs.set(run.id, clone(run));
      packets.set(validatedPacket.id, { packet: clone(validatedPacket), runId: run.id });
      actions.set(action.id, clone(action));
      gates.set(gate.id, { gate: clone(gate), runId: run.id });
      for (const entry of auditEntries) auditLog.set(entry.id, clone(entry));
    },

    async savePacket(packet: EvidencePacket, runId: string): Promise<void> {
      const validated = evidencePacketSchema.parse(packet);
      if (packets.has(validated.id)) {
        throw new StoreConflictError(`packet with id "${validated.id}" already exists`);
      }
      packets.set(validated.id, { packet: clone(validated), runId });
    },

    async getPacketByIncident(incidentId: string): Promise<EvidencePacket | null> {
      // Latest by `builtAt`, matching the D1 adapter's `ORDER BY built_at
      // DESC` — never by id, which carries no notion of recency.
      const matches = [...packets.values()].filter((p) => p.packet.incidentId === incidentId);
      if (matches.length === 0) return null;
      const latest = matches.reduce((best, current) => (current.packet.builtAt > best.packet.builtAt ? current : best));
      return evidencePacketSchema.parse(clone(latest.packet));
    },

    async getPacketByRun(runId: string): Promise<EvidencePacket | null> {
      // Scoped strictly to this run's own packet(s) — never any other run's,
      // even one on the same incident. See the doc comment on
      // Store#getPacketByRun.
      const matches = [...packets.values()].filter((p) => p.runId === runId);
      if (matches.length === 0) return null;
      const latest = matches.reduce((best, current) => (current.packet.builtAt > best.packet.builtAt ? current : best));
      return evidencePacketSchema.parse(clone(latest.packet));
    },

    async saveAction(action: Action): Promise<void> {
      if (actions.has(action.id)) throw new StoreConflictError(`action with id "${action.id}" already exists`);
      actions.set(action.id, clone(action));
    },

    async getAction(id: string): Promise<Action | null> {
      const found = actions.get(id);
      if (found === undefined) return null;
      // createAction re-derives isStateChanging from kind — same defence as
      // the D1 adapter's getAction. See class doc comment.
      return createAction(clone(found));
    },

    async saveGate(gate: ApprovalGate, runId: string): Promise<boolean> {
      // Same one-way rule the D1 adapter enforces via its conditional
      // `ON CONFLICT ... WHERE` upsert (see `store/d1.ts#saveGate`): a gate
      // already decided (approved/rejected) can never be overwritten by a
      // conflicting decision or reverted by a stale locked value. Only a
      // write over a missing row or a still-`locked` row takes effect.
      //
      // `state === "locked"` alone is not enough: it only guards against
      // touching an already-decided row, but says nothing about *what* a
      // same-id write over a still-locked row may change. Without more, a
      // same-id gate with a different actionId/createdAt/expiresAt (or a
      // different run association) would pass this check and replace the
      // gate that was actually persisted — breaking the gate-to-action
      // binding — and then be free to be approved. So every immutable field
      // must equal the *stored* row's value before the write is allowed:
      // this may only ever advance a locked gate's decision, never rebind
      // it. Mirrors the D1 adapter's WHERE clause field-for-field.
      const existing = gates.get(gate.id);
      if (existing !== undefined) {
        if (existing.gate.state !== "locked") return false;
        if (existing.gate.actionId !== gate.actionId) return false;
        if (existing.gate.createdAt !== gate.createdAt) return false;
        if (existing.gate.expiresAt !== gate.expiresAt) return false;
        if (existing.runId !== runId) return false;
      }
      gates.set(gate.id, { gate: clone(gate), runId });
      return true;
    },

    async getGate(id: string): Promise<ApprovalGate | null> {
      const found = gates.get(id);
      if (found === undefined) return null;
      // Validated on read, not cast — same defence as the D1 adapter's
      // getGate. See class doc comment.
      return approvalGateSchema.parse(clone(found.gate));
    },

    async decideGate(gate: ApprovedGate | RejectedGate, runId: string, at: string): Promise<boolean> {
      // Check-then-mutate, entirely synchronous: every condition below is
      // evaluated before either map is touched, so — same as
      // createUserWithSession — a refused write can never apply one half of
      // the pair and not the other. See the doc comment on
      // Store#decideGate.
      const existingRun = runs.get(runId);
      if (existingRun === undefined || existingRun.state !== "awaiting_approval") return false;

      const existingGateRecord = gates.get(gate.id);
      if (existingGateRecord === undefined) return false;
      if (existingGateRecord.gate.state !== "locked") return false;
      if (existingGateRecord.gate.actionId !== gate.actionId) return false;
      if (existingGateRecord.gate.createdAt !== gate.createdAt) return false;
      if (existingGateRecord.gate.expiresAt !== gate.expiresAt) return false;
      if (existingGateRecord.runId !== runId) return false;

      runs.set(runId, { ...existingRun, state: gate.state, updatedAt: at });
      gates.set(gate.id, { gate: clone(gate), runId });
      return true;
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

    async listRecentAudit(limit: number): Promise<AuditEntry[]> {
      return [...auditLog.values()]
        .sort((a, b) => {
          if (a.at !== b.at) return a.at < b.at ? 1 : -1;
          if (a.id !== b.id) return a.id < b.id ? 1 : -1;
          return 0;
        })
        .slice(0, limit)
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
      if (incidents.has(row.id)) throw new StoreConflictError(`incident with id "${row.id}" already exists`);
      incidents.set(row.id, clone(row));
    },

    async createUser(row: UserRow): Promise<void> {
      // Both checks run before either map is touched: a duplicate id must
      // never partially apply and leave `userIdByEmail` pointing at a row
      // whose email doesn't match what was actually stored for that id.
      if (users.has(row.id)) throw new StoreConflictError(`user with id "${row.id}" already exists`);
      if (userIdByEmail.has(row.email)) {
        throw new StoreConflictError(`user with email "${row.email}" already exists`);
      }
      users.set(row.id, clone(row));
      userIdByEmail.set(row.email, row.id);
    },

    async createUserWithSession(user: UserRow, session: SessionRow): Promise<void> {
      // The whole point of this method is that a user and THEIR OWN first
      // session commit together. Nothing about the checks below enforces
      // that on their own — `sessions.has`/`users.has` only ask whether
      // *some* row exists, not that the session names the row being
      // created in this same call. Without this, a caller passing a
      // session whose userId names a different, already-existing user
      // would create the new user but hand back a session that
      // authenticates the OTHER account — an auth-bypass shape, not a
      // data-integrity nit. This must never be reachable from the register
      // route (buildSession always pairs userId to the freshly minted user
      // id), so this throws rather than degrading gracefully — it's a
      // programming error, not a user-facing condition. Checked before any
      // map is touched, like every other check here.
      if (session.userId !== user.id) {
        throw new Error(
          `createUserWithSession: session.userId ("${session.userId}") does not match user.id ("${user.id}")`
        );
      }

      // Mirrors the D1 adapter's db.batch() transaction: every conflict
      // check for BOTH rows runs before either map is touched, so a
      // rejected write can never leave a user with no session (or a
      // session pointing at a user that was never created). See the doc
      // comment on Store#createUserWithSession.
      if (users.has(user.id)) throw new StoreConflictError(`user with id "${user.id}" already exists`);
      if (userIdByEmail.has(user.email)) {
        throw new StoreConflictError(`user with email "${user.email}" already exists`);
      }
      if (sessions.has(session.id)) throw new StoreConflictError(`session with id "${session.id}" already exists`);

      users.set(user.id, clone(user));
      userIdByEmail.set(user.email, user.id);
      sessions.set(session.id, clone(session));
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
      if (sessions.has(row.id)) throw new StoreConflictError(`session with id "${row.id}" already exists`);
      // Mirrors `sessions.user_id REFERENCES users (id)`
      // (migrations/0002_auth_and_incidents.sql): D1 rejects an INSERT
      // naming a user that doesn't exist via this foreign key. A `Map` has
      // no constraint of its own to violate, so this is the explicit
      // equivalent — otherwise the memory adapter would silently accept an
      // unusable session for nobody, a conformance divergence D1 doesn't
      // have.
      if (!users.has(row.userId)) {
        throw new Error(`createSession: no user with id "${row.userId}" exists`);
      }
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
