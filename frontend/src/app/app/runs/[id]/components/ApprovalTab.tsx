"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LockKeyhole,
  ShieldAlert,
  Undo2,
  XCircle
} from "lucide-react";
import { Eyebrow, SectionTitle } from "@/app/app/components/console/Surface";
import { Meter, Pill } from "@/app/app/components/console/Indicators";
import { cn } from "@/lib/utils";
import { approve, reject } from "../../../../../lib/api";
import type {
  Action,
  ApprovalGate,
  Confidence,
  EvidencePacket,
  ExecutionResult,
  RunRow
} from "../../../../../lib/types";
import { CONFIDENCE_PERCENT, CONFIDENCE_TONE, formatTimestamp, humanizeErrorCode, toApiClientError } from "../shared";

type DecisionState = { status: "idle" } | { status: "deciding" } | { status: "error"; message: string };

/** The recorded outcome, in the same shape the executor reported it — never a
 * prose paraphrase of what the system claims to have done. */
function outcomeText(params: {
  execution: ExecutionResult | undefined;
  gate: ApprovalGate;
}): string {
  if (params.gate.state === "rejected") return params.gate.reason ?? "No reason was recorded.";
  if (params.execution !== undefined) {
    return [
      `executed=${params.execution.executed}`,
      `dry_run=${params.execution.dryRun}`,
      `output=${params.execution.output}`
    ].join("\n");
  }
  return "Approved and executed — see the Audit tab for the recorded output.";
}

function gateSummary(gate: ApprovalGate): string {
  const by = gate.decidedBy === undefined ? "" : ` by ${gate.decidedBy}`;
  if (gate.state === "approved") return `Gate approved${by}`;
  if (gate.state === "rejected") return `Gate rejected${by}`;
  return "Locked — this action cannot run until a human decides.";
}

interface ConsequenceProps {
  readonly body: string;
  readonly detail?: string;
  readonly title: string;
  readonly tone: "go" | "stop";
}

/** Both halves of the decision, stated as outcomes rather than button labels:
 * an operator should never have to infer what pressing a button will do. */
function Consequence({ body, detail, title, tone }: ConsequenceProps) {
  const Icon = tone === "go" ? CheckCircle2 : XCircle;
  return (
    <div className={cn("border-l-2 pl-4", tone === "go" ? "border-emerald-400" : "border-rose-400")}>
      <div className="flex items-center gap-2">
        <Icon
          className={cn("h-4 w-4 shrink-0", tone === "go" ? "text-emerald-600" : "text-rose-600")}
          strokeWidth={2.2}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-700">{body}</p>
      {detail === undefined ? null : <p className="mt-1.5 text-xs leading-5 text-neutral-500">{detail}</p>}
    </div>
  );
}

interface ApprovalTabProps {
  readonly action: Action | null;
  readonly confidence: Confidence | null;
  readonly gate: ApprovalGate | null;
  readonly lastExecution: ExecutionResult | undefined;
  readonly packet: EvidencePacket | null;
  // `runState` is the run's real resulting state (backend/src/routes/approvals.ts) —
  // distinct from `gate.state`, which alone would give the wrong answer for
  // approve (gate ends "approved" but the run ends "executed").
  readonly onDecided: (gate: ApprovalGate, runState: RunRow["state"], execution?: ExecutionResult) => void;
}

export function ApprovalTab({
  action,
  confidence,
  gate,
  lastExecution,
  packet,
  onDecided
}: ApprovalTabProps) {
  const [decisionState, setDecisionState] = useState<DecisionState>({ status: "idle" });
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  if (action === null || gate === null) {
    return (
      <div className="border-l-2 border-sky-200 pl-4">
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
  const hasEvidence = cardCount > 0;

  async function handleApprove(): Promise<void> {
    setDecisionState({ status: "deciding" });
    try {
      const result = await approve(currentGate.id);
      setDecisionState({ status: "idle" });
      onDecided(result.gate, result.runState, result.execution);
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
      onDecided(result.gate, result.runState, undefined);
    } catch (error) {
      setDecisionState({ status: "error", message: humanizeErrorCode(toApiClientError(error).code) });
    }
  }

  const StateIcon = isLocked ? LockKeyhole : currentGate.state === "approved" ? CheckCircle2 : XCircle;
  const stateIconClass = isLocked
    ? "text-neutral-500"
    : currentGate.state === "approved"
      ? "text-emerald-600"
      : "text-rose-600";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <SectionTitle
          title="Approval gate"
          hint={
            isLocked
              ? "One decision, recorded against your name, with the evidence attached."
              : "This gate has been decided — the record below is final."
          }
        />
        <div className="flex items-start gap-3 border-y border-sky-100 py-4">
          <StateIcon className={cn("mt-0.5 h-5 w-5 shrink-0", stateIconClass)} strokeWidth={1.9} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-6 text-ink">{gateSummary(currentGate)}</p>
            <p className="mt-1 text-xs text-neutral-500">
              {isLocked
                ? `Expires ${formatTimestamp(currentGate.expiresAt)}`
                : currentGate.decidedAt === undefined
                  ? "Decision recorded."
                  : `Decided ${formatTimestamp(currentGate.decidedAt)}`}
            </p>
          </div>
          <div className="hidden shrink-0 flex-wrap justify-end gap-2 sm:flex">
            <Pill tone={currentAction.isStateChanging ? "warn" : "info"} icon={ShieldAlert}>
              {currentAction.isStateChanging ? "Changes production" : "Read only"}
            </Pill>
            <Pill tone="neutral" icon={Undo2}>
              {currentAction.reversible ? "Reversible" : "Irreversible"}
            </Pill>
          </div>
        </div>
      </div>

      {isLocked ? (
        <div className="grid gap-6 sm:grid-cols-2 sm:gap-10">
          <Consequence
            tone="go"
            title="If you approve"
            body={`RunProof runs it immediately: ${currentAction.description}.`}
            detail={
              currentAction.reversible
                ? "This action is reversible, and the execution output is written to the audit trail."
                : "This action cannot be undone once it runs."
            }
          />
          <Consequence
            tone="stop"
            title="If you reject"
            body="Nothing runs. The gate closes with your reason attached and the run is filed as a rejection."
            detail="The incident stays open, so a different runbook or a manual fix can still follow."
          />
        </div>
      ) : (
        <div>
          <Eyebrow>{currentGate.state === "approved" ? "Execution output" : "Rejection reason"}</Eyebrow>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-sky-50/70 p-3 text-[11px] leading-relaxed text-neutral-700">
            {outcomeText({ execution: lastExecution, gate: currentGate })}
          </pre>
        </div>
      )}

      <div className="grid gap-6 border-t border-sky-100 pt-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-10">
        <div>
          <Eyebrow>What this decision rests on</Eyebrow>
          <p className="mt-2 text-sm leading-6 text-neutral-700">
            {hasEvidence
              ? `${cardCount} evidence ${cardCount === 1 ? "card" : "cards"} were collected for this run.`
              : "No evidence cards were collected for this run."}
          </p>
        </div>
        <div className="sm:pt-1">
          <Meter
            label={<Eyebrow>Evidence confidence</Eyebrow>}
            trailing={<span className="text-sm font-semibold text-ink">{confidence ?? "not available"}</span>}
            percent={confidence === null ? null : CONFIDENCE_PERCENT[confidence]}
            tone={confidence === null ? "neutral" : CONFIDENCE_TONE[confidence]}
          />
        </div>
      </div>

      {decisionState.status === "error" ? (
        <p className="flex items-center gap-2 border-l-2 border-rose-500 bg-rose-50/70 py-3 pl-4 text-sm font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
          {decisionState.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={!isLocked || isDeciding || !hasEvidence}
            className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {isDeciding ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            disabled={!isLocked || isDeciding}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
          >
            <XCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Reject
          </button>
        </div>

        {isLocked && !hasEvidence ? (
          <p className="flex items-center gap-2 text-xs font-medium text-neutral-600">
            <Info className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2.2} aria-hidden="true" />
            Approve is disabled: this run has no evidence cards yet.
          </p>
        ) : null}
      </div>

      {rejectOpen ? (
        <form onSubmit={(event) => void handleRejectSubmit(event)} className="border-t border-sky-100 pt-6">
          <label htmlFor="reject-reason" className="text-sm font-semibold text-ink">
            Reason for rejecting
          </label>
          <p className="mt-1 text-xs text-neutral-500">
            Recorded in the audit trail alongside your name — write what the next responder needs to know.
          </p>
          <textarea
            id="reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={3}
            className="mt-3 w-full rounded-lg border border-sky-100 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-neutral-400 focus:border-signal focus:ring-2 focus:ring-signal/25"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={rejectReason.trim().length === 0 || isDeciding}
              className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
            >
              Confirm reject
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              className="text-sm font-semibold text-neutral-600 transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
