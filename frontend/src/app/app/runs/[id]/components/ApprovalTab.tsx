"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { approve, reject } from "../../../../../lib/api";
import type {
  Action,
  ApprovalGate,
  Confidence,
  EvidencePacket,
  ExecutionResult
} from "../../../../../lib/types";
import { RunbookPreview, type RunbookPreviewData, type TimelineEntry } from "../../../../components/RunbookPreview";
import { humanizeErrorCode, toApiClientError } from "../shared";

type DecisionState = { status: "idle" } | { status: "deciding" } | { status: "error"; message: string };

/**
 * RunProof computes no server-side risk model — GET /runs/:id has no such
 * field, and none of the domain modules produce one. RunbookPreview still
 * expects a riskScore/riskLabel pair (it's a reused panel, not something
 * this screen owns), so this maps the one real signal available —
 * evidence confidence — onto that shape with a fixed, disclosed formula:
 * less confidence in the evidence is treated as more reason to look twice
 * before approving. It is a display heuristic, not a computed risk score.
 */
function confidenceToRisk(confidence: Confidence | null): { score: number; label: RunbookPreviewData["riskLabel"] } {
  if (confidence === "high") return { score: 20, label: "Low" };
  if (confidence === "medium") return { score: 50, label: "Medium" };
  if (confidence === "low") return { score: 75, label: "High" };
  return { score: 90, label: "High" };
}

function buildTimeline(params: {
  serviceName: string;
  packet: EvidencePacket | null;
  gate: ApprovalGate;
}): TimelineEntry[] {
  const cardCount = params.packet?.cards.length ?? 0;
  const isLocked = params.gate.state === "locked";

  return [
    {
      label: "Run started",
      detail: `Evidence collection began for ${params.serviceName}.`,
      state: "done"
    },
    {
      label: "Evidence gathered",
      detail: cardCount > 0 ? (params.packet?.summary ?? "") : "No evidence cards were collected.",
      state: cardCount > 0 ? "done" : "pending"
    },
    {
      label: "Diagnostics reviewed",
      detail: "Fixture sandbox output reviewed — no live sandbox runs in this build.",
      state: "done"
    },
    {
      label: "Approval required",
      detail: isLocked
        ? "The proposed action stays locked until an engineer approves it."
        : `Decision recorded: ${params.gate.state}.`,
      state: isLocked ? "pending" : "done"
    }
  ];
}

function buildSandboxOutput(params: {
  gate: ApprovalGate;
  execution: ExecutionResult | undefined;
  packet: EvidencePacket | null;
}): string {
  if (params.gate.state === "approved") {
    if (params.execution !== undefined) {
      return [
        `executed=${params.execution.executed}`,
        `dry_run=${params.execution.dryRun}`,
        `output=${params.execution.output}`
      ].join("\n");
    }
    return "Approved and executed — see the Audit tab for the recorded output.";
  }
  if (params.gate.state === "rejected") {
    return params.gate.reason ?? "No reason was recorded.";
  }
  const sandboxCard = params.packet?.cards.find((card) => card.source === "sandbox");
  return sandboxCard === undefined
    ? "No diagnostic fixture recorded for this run."
    : `[fixture] ${sandboxCard.claim}`;
}

interface ApprovalTabProps {
  readonly incidentTitle: string;
  readonly runbookId: string;
  readonly serviceName: string;
  readonly packet: EvidencePacket | null;
  readonly action: Action | null;
  readonly gate: ApprovalGate | null;
  readonly confidence: Confidence | null;
  readonly lastExecution: ExecutionResult | undefined;
  readonly onDecided: (gate: ApprovalGate, execution?: ExecutionResult) => void;
}

export function ApprovalTab({
  incidentTitle,
  runbookId,
  serviceName,
  packet,
  action,
  gate,
  confidence,
  lastExecution,
  onDecided
}: ApprovalTabProps) {
  const [decisionState, setDecisionState] = useState<DecisionState>({ status: "idle" });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (action === null || gate === null) {
    return (
      <div className="rounded-2xl bg-white p-6">
        <p className="text-sm font-semibold text-ink">No action or approval gate recorded for this run.</p>
        <p className="mt-1 text-sm text-neutral-500">Evidence collection may still be in progress.</p>
      </div>
    );
  }

  // Narrowed to non-null above — captured by value here so the handlers
  // below close over the concrete `ApprovalGate`/`Action`, not the nullable
  // props.
  const currentAction = action;
  const currentGate = gate;

  const isLocked = currentGate.state === "locked";
  const cardCount = packet?.cards.length ?? 0;
  const isDeciding = decisionState.status === "deciding";

  async function handleApprove(): Promise<void> {
    setDecisionState({ status: "deciding" });
    try {
      const result = await approve(currentGate.id);
      setDecisionState({ status: "idle" });
      onDecided(result.gate, result.execution);
    } catch (error) {
      setDecisionState({ status: "error", message: humanizeErrorCode(toApiClientError(error).code) });
    }
  }

  async function handleRejectSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const reason = rejectReason.trim();
    // Client-side guard mirrors the server's 400 on an empty reason — a
    // convenience, not the actual gate; the disabled submit button below is
    // the other half of the same guard.
    if (reason.length === 0) return;
    setDecisionState({ status: "deciding" });
    try {
      const result = await reject(currentGate.id, reason);
      setDecisionState({ status: "idle" });
      setRejectOpen(false);
      setRejectReason("");
      onDecided(result.gate, undefined);
    } catch (error) {
      setDecisionState({ status: "error", message: humanizeErrorCode(toApiClientError(error).code) });
    }
  }

  const { score, label } = confidenceToRisk(confidence);

  const previewData: RunbookPreviewData = {
    riskScore: score,
    riskLabel: label,
    incidentTitle,
    runbookId,
    timeline: buildTimeline({ serviceName, packet, gate: currentGate }),
    sandboxOutput: buildSandboxOutput({ gate: currentGate, execution: lastExecution, packet }),
    actionDescription: currentAction.description,
    gateState: currentGate.state,
    // RunbookPreview disables Approve whenever `onApprove` is absent — so a
    // zero-card packet is enforced here by simply not wiring the callback,
    // without needing to touch RunbookPreview itself.
    onApprove: isLocked && cardCount > 0 && !isDeciding ? () => void handleApprove() : undefined,
    // RunbookPreview's "Review" button takes no arguments — it can't collect
    // a rejection reason on its own, so it opens the reason form below
    // instead of calling the API directly.
    onReject: isLocked && !isDeciding ? () => setRejectOpen(true) : undefined,
    isDeciding
  };

  return (
    <div className="flex flex-col gap-4">
      <RunbookPreview data={previewData} />

      {decisionState.status === "error" ? (
        <p className="flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {decisionState.message}
        </p>
      ) : null}

      {isLocked && cardCount === 0 ? (
        <p className="rounded-2xl bg-panel px-4 py-3 text-xs font-medium text-neutral-600">
          Approve is disabled: this run has no evidence cards yet.
        </p>
      ) : null}

      {rejectOpen ? (
        <form
          onSubmit={(event) => void handleRejectSubmit(event)}
          className="flex flex-col gap-3 rounded-2xl bg-white p-5"
        >
          <label htmlFor="reject-reason" className="text-sm font-semibold text-ink">
            Reason for rejecting
          </label>
          <textarea
            id="reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
            className="rounded-xl border border-neutral-200 px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/30"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={rejectReason.trim().length === 0 || isDeciding}
              className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              Confirm reject
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
