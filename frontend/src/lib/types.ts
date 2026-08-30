/**
 * Structural mirrors of backend domain types, duplicated deliberately rather
 * than imported: `frontend/` and `backend/` are separate Workers with
 * separate builds and separate tsconfigs. Each type below names the backend
 * module it shadows so drift is visible in review. Do not import from
 * `backend/` here.
 */

// mirrors backend/src/domain/evidence.ts EvidenceSourceKind
export type EvidenceSourceKind = "logs" | "metrics" | "deploys" | "sandbox";

// mirrors backend/src/domain/evidence.ts Confidence
export type Confidence = "high" | "medium" | "low";

// mirrors backend/src/domain/evidence.ts EvidenceCard
export interface EvidenceCard {
  readonly id: string;
  readonly source: EvidenceSourceKind;
  readonly claim: string;
  readonly raw: unknown;
  readonly collectedAt: string;
  readonly confidence: Confidence;
}

// mirrors backend/src/domain/evidence.ts EvidencePacket
export interface EvidencePacket {
  readonly id: string;
  readonly incidentId: string;
  readonly runbookId: string;
  readonly cards: readonly EvidenceCard[];
  readonly summary: string;
  readonly builtAt: string;
}

// mirrors backend/src/domain/action.ts ActionKind
export type ActionKind = "rollback" | "restart" | "scale" | "read_logs" | "read_metrics" | "run_diagnostic";

// mirrors backend/src/domain/action.ts STATE_CHANGING_KINDS — the runbooks
// screen needs this because RunbookAction (below) has no `isStateChanging`
// field of its own: that flag only exists on the concrete `Action` a run
// creates, derived server-side by `createAction`. Displaying a runbook's
// *proposed* action honestly before any run exists means re-deriving the
// same classification here.
export const STATE_CHANGING_ACTION_KINDS: readonly ActionKind[] = ["rollback", "restart", "scale"];

// mirrors backend/src/domain/action.ts Action (ReadOnlyAction | StateChangingAction,
// collapsed to one shape client-side since the frontend never constructs an
// Action — it only ever displays one received from the API).
export interface Action {
  readonly id: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly reversible: boolean;
  readonly description: string;
  readonly isStateChanging: boolean;
}

// mirrors backend/src/domain/approval.ts GateState
export type GateState = "locked" | "approved" | "rejected";

// mirrors backend/src/domain/approval.ts ApprovalGate (LockedGate | ApprovedGate | RejectedGate)
export interface ApprovalGate {
  readonly id: string;
  readonly actionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly state: GateState;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly reason?: string;
}

// mirrors backend/src/domain/store.ts RunRow
export interface RunRow {
  readonly id: string;
  readonly incidentId: string;
  readonly runbookId: string;
  readonly service: string;
  readonly state: "collecting" | "awaiting_approval" | "approved" | "rejected" | "executed";
  readonly createdAt: string;
  readonly updatedAt: string;
  // null when there is no attributable session for the run.
  readonly createdBy: string | null;
}

// mirrors backend/src/domain/executor.ts ExecutionResult
export interface ExecutionResult {
  readonly actionId: string;
  readonly executed: boolean;
  readonly dryRun: boolean;
  readonly output: string;
  readonly at: string;
}

// mirrors the `data` payload of POST /incidents/:id/run (backend/src/routes/run.ts)
export interface RunResponse {
  readonly run: RunRow;
  readonly packet: EvidencePacket;
  readonly action: Action;
  readonly gate: ApprovalGate;
  readonly failures: readonly RunFailure[];
}

// mirrors the `data` payload of GET /incidents/:id/packet (backend/src/routes/packet.ts)
export interface PacketResponse {
  readonly packet: EvidencePacket;
  readonly confidence: Confidence;
}

// mirrors the `data` payload of POST /approvals/:id/approve and .../reject
// (backend/src/routes/approvals.ts) — `execution` is present only on approve.
// `runState` is the run's real resulting state ("executed" for approve,
// "rejected" for reject) — distinct from `gate.state` ("approved" for
// approve), which callers must not infer the run state from.
export interface ApprovalResponse {
  readonly gate: ApprovalGate;
  readonly execution?: ExecutionResult;
  readonly runState: RunRow["state"];
}

// mirrors the shape backend/src/routes/runs.ts builds for each `failures`
// entry on GET /runs/:id and POST /incidents/:id/run — an evidence source
// the run's runbook allows but that contributed zero cards to the packet.
export interface RunFailure {
  readonly source: EvidenceSourceKind;
  readonly message: string;
}

// mirrors the `data` payload of GET /runs/:id (backend/src/routes/runs.ts).
// `incident` is NOT nullable: the route 404s (`not_found`) when a run
// references a missing incident rather than shipping a payload whose shape
// contradicts every reader's assumption that a run always has one. `packet`,
// `action`, and `gate` stay nullable — each is looked up independently by
// id/fk after the run loads, and a dangling reference there must surface as
// "missing", not crash the console.
export interface RunDetailResponse {
  readonly run: RunRow;
  readonly incident: IncidentRow;
  readonly packet: EvidencePacket | null;
  readonly action: Action | null;
  readonly gate: ApprovalGate | null;
  readonly failures: readonly RunFailure[];
  readonly confidence: Confidence | null;
}

// mirrors backend/src/auth/middleware.ts PublicUser (UserRow minus passwordHash/salt —
// the frontend never receives credential material)
export interface User {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

// mirrors backend/src/domain/store.ts AuditEntry
export interface AuditEntry {
  readonly id: string;
  readonly runId: string;
  readonly at: string;
  readonly kind: string;
  readonly detail: string;
}

// mirrors the `data` payload of GET /overview (backend/src/routes/overview.ts)
export interface OverviewResponse {
  readonly awaitingApproval: number;
  readonly activeIncidents: number;
  readonly runsToday: number;
  readonly recentActivity: readonly AuditEntry[];
  // Every run state with a count, including states holding zero runs, so the
  // readiness score can read `runsByState.approved` without a null check.
  readonly runsByState: Readonly<Record<RunRow["state"], number>>;
  // Runs whose evidence packet is missing at least one source its runbook
  // allows. Counted per run, not per missing source.
  readonly partialEvidenceRuns: number;
}

// mirrors backend/src/domain/store.ts IncidentRow
export interface IncidentRow {
  readonly id: string;
  readonly title: string;
  readonly service: string;
  readonly signals: readonly string[];
  readonly status: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

// mirrors the `data` payload of GET /incidents/:id (backend/src/routes/incidents.ts)
export interface IncidentDetailResponse {
  readonly incident: IncidentRow;
  readonly runs: readonly RunRow[];
}

// mirrors backend/src/domain/runbook.ts RunbookStep
export interface RunbookStep {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly source?: EvidenceSourceKind;
}

// mirrors backend/src/domain/runbook.ts RunbookAction — the proposed action a
// runbook recommends. Distinct from `Action` above, which is the concrete,
// already-created instance a run's gate is locked around.
export interface RunbookAction {
  readonly kind: ActionKind;
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly reversible: boolean;
  readonly description: string;
}

// mirrors backend/src/domain/runbook.ts Runbook — served by GET /runbooks.
// `allowedSources` is the scope contract shown to operators before a run
// starts: the only evidence sources the agent will be permitted to read.
export interface Runbook {
  readonly id: string;
  readonly title: string;
  readonly trigger: {
    readonly service: string;
    readonly signals: readonly string[];
  };
  readonly allowedSources: readonly EvidenceSourceKind[];
  readonly steps: readonly RunbookStep[];
  readonly proposedAction: RunbookAction;
}

// mirrors backend/src/index.ts ApiError
export interface ApiErrorBody {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}
