import type { EvidencePacket } from "./evidence";
import type { Action } from "./action";
import type { ApprovalGate } from "./approval";

/**
 * Pure types and the `Store` port. No D1, no SQL, no bindings — this file
 * must be importable without a Worker runtime. Implementations live in
 * `src/store/*` (`createD1Store`, `createMemoryStore`); both are exercised
 * against the identical contract in `src/store/conformance.ts`.
 */

export type RunRow = {
  id: string;
  incidentId: string;
  runbookId: string;
  service: string;
  state: "collecting" | "awaiting_approval" | "approved" | "rejected" | "executed";
  createdAt: string;
  updatedAt: string;
  /** The operator whose session started this run, or null for runs created
   * before B5 (or via a path with no session, if one is ever added). Never
   * client-suppliable — see `routes/run.ts`, which sets it from
   * `c.var.user.email`, the same discipline `by` on approvals follows. */
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

  saveAction(action: Action, runId: string): Promise<void>;
  getAction(id: string): Promise<Action | null>;

  saveGate(gate: ApprovalGate, runId: string): Promise<void>;
  getGate(id: string): Promise<ApprovalGate | null>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(runId: string): Promise<AuditEntry[]>;
  /** The most recent audit entries across every run, newest first, capped at
   * `limit`. Backs `GET /audit` (no `runId`) and the Overview screen's
   * recent-activity feed — both need a cross-run view `listAudit` doesn't
   * provide. */
  listRecentAudit(limit: number): Promise<AuditEntry[]>;

  listIncidents(filter?: { status?: string }): Promise<IncidentRow[]>;
  getIncident(id: string): Promise<IncidentRow | null>;
  createIncident(row: IncidentRow): Promise<void>;

  createUser(row: UserRow): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;

  createSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(nowIso: string): Promise<void>;
}
