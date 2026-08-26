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
}

// mirrors the `data` payload of GET /incidents/:id/packet (backend/src/routes/packet.ts)
export interface PacketResponse {
  readonly packet: EvidencePacket;
  readonly confidence: Confidence;
}

// mirrors the `data` payload of POST /approvals/:id/approve and .../reject
// (backend/src/routes/approvals.ts) — `execution` is present only on approve.
export interface ApprovalResponse {
  readonly gate: ApprovalGate;
  readonly execution?: ExecutionResult;
}

// mirrors backend/src/auth/middleware.ts PublicUser (UserRow minus passwordHash/salt —
// the frontend never receives credential material)
export interface User {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
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
