"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError, approve, reject, startRun } from "../../lib/api";
import type {
  Action,
  ApprovalGate,
  Confidence,
  EvidenceCard,
  EvidencePacket,
  ExecutionResult,
  RunRow
} from "../../lib/types";
import {
  RunbookPreview,
  type RunbookPreviewData,
  type TimelineEntry
} from "../components/RunbookPreview";

/**
 * The seeded incident this vertical slice ships with: `payment-service`
 * with `timeout` + `error_rate` signals matches
 * `testing/runbooks/checkout-failure.json`'s trigger exactly.
 */
const SEEDED_INCIDENT_ID = "payment-service-dashboard";
const SEEDED_SERVICE = "payment-service";
const SEEDED_SIGNALS = ["timeout", "error_rate"];

/** Identifies the human deciding gates from this dashboard. */
const OPERATOR_ID = "dashboard-operator";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  validation_failed: "The request to start this run was invalid.",
  no_matching_runbook: "No runbook matches this incident's service and signals.",
  not_found: "That incident or approval could not be found.",
  scope_violation: "Evidence collection tried to read outside its allowed sources and was blocked.",
  gate_already_decided: "This approval has already been decided.",
  gate_expired: "This approval gate has expired and can no longer be decided.",
  internal_error: "Something went wrong on the server.",
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

/**
 * The backend has no numeric "risk score" — only a per-card `Confidence`.
 * This maps the weakest evidence confidence in the packet to a display
 * score/label, deliberately mirroring the demo preview's High/82 baseline.
 */
const CONFIDENCE_RISK: Readonly<Record<Confidence, { score: number; label: RunbookPreviewData["riskLabel"] }>> = {
  high: { score: 82, label: "High" },
  medium: { score: 55, label: "Medium" },
  low: { score: 25, label: "Low" }
};

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

function weakestConfidence(cards: readonly EvidenceCard[]): Confidence {
  if (cards.length === 0) return "low";
  return cards.reduce<Confidence>(
    (weakest, card) => (CONFIDENCE_RANK[card.confidence] < CONFIDENCE_RANK[weakest] ? card.confidence : weakest),
    "high"
  );
}

const SOURCE_LABELS: Readonly<Record<EvidenceCard["source"], string>> = {
  logs: "Logs",
  metrics: "Metrics",
  deploys: "Deploy history",
  sandbox: "Sandbox"
};

function buildTimeline(packet: EvidencePacket, gate: ApprovalGate): TimelineEntry[] {
  const cardEntries: TimelineEntry[] = packet.cards.map((card) => ({
    label: `${SOURCE_LABELS[card.source]} evidence`,
    detail: card.claim,
    state: "done"
  }));

  const approvalDetail =
    gate.state === "locked"
      ? "This action stays locked until an engineer approves it."
      : gate.state === "approved"
        ? "Approved — action executed."
        : "Rejected — action was not executed.";

  return [
    ...cardEntries,
    { label: "Approval required", detail: approvalDetail, state: gate.state === "locked" ? "pending" : "done" }
  ];
}

function buildLockedSandboxOutput(packet: EvidencePacket): string {
  if (packet.cards.length === 0) return packet.summary;
  const lines = packet.cards.map((card) => `${card.source}: ${card.claim}`);
  return [packet.summary, "", ...lines].join("\n");
}

type LoadedState = {
  status: "loaded";
  run: RunRow;
  packet: EvidencePacket;
  action: Action;
  gate: ApprovalGate;
  execution?: ExecutionResult;
  decisionReason?: string;
  isDeciding: boolean;
  actionError: string | null;
};

type DashboardState = { status: "loading" } | { status: "error"; error: ApiClientError } | LoadedState;

function buildSandboxOutput(loaded: LoadedState): string {
  if (loaded.gate.state === "approved") {
    return loaded.execution?.output ?? "Approved, awaiting execution output.";
  }
  if (loaded.gate.state === "rejected") {
    return loaded.decisionReason ?? loaded.gate.reason ?? "No reason recorded.";
  }
  return buildLockedSandboxOutput(loaded.packet);
}

function toPreviewData(
  loaded: LoadedState,
  handlers: { onApprove: () => void; onReject: () => void }
): RunbookPreviewData {
  const hasEvidence = loaded.packet.cards.length > 0;
  const canDecide = hasEvidence && loaded.gate.state === "locked" && !loaded.isDeciding;
  const risk = CONFIDENCE_RISK[weakestConfidence(loaded.packet.cards)];

  return {
    riskScore: risk.score,
    riskLabel: risk.label,
    incidentTitle: `${loaded.run.service} incident`,
    runbookId: loaded.run.runbookId,
    timeline: buildTimeline(loaded.packet, loaded.gate),
    sandboxOutput: buildSandboxOutput(loaded),
    actionDescription: loaded.action.description,
    gateState: loaded.gate.state,
    onApprove: canDecide ? handlers.onApprove : undefined,
    onReject: canDecide ? handlers.onReject : undefined,
    isDeciding: loaded.isDeciding
  };
}

function LoadingSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[1180px] animate-pulse rounded-3xl bg-panel p-4 shadow-soft sm:p-6 lg:p-7"
      role="status"
      aria-label="Collecting evidence"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5">
        {[0, 1, 2].map((panel) => (
          <div key={panel} className="rounded-2xl bg-white p-5">
            <div className="h-3 w-24 rounded-full bg-neutral-200" />
            <div className="mt-3 h-6 w-16 rounded-full bg-neutral-200" />
            <div className="mt-4 h-20 w-full rounded-xl bg-neutral-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorPanel({ error, onRetry }: { error: ApiClientError; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1180px] rounded-3xl bg-white p-6 shadow-soft">
      <p className="text-sm font-semibold text-rose-700">Could not start this run</p>
      <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0"
      >
        Retry
      </button>
    </div>
  );
}

export function DashboardClient() {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await startRun(SEEDED_INCIDENT_ID, {
        service: SEEDED_SERVICE,
        signals: SEEDED_SIGNALS
      });
      setState({
        status: "loaded",
        run: response.run,
        packet: response.packet,
        action: response.action,
        gate: response.gate,
        isDeciding: false,
        actionError: null
      });
    } catch (error: unknown) {
      setState({ status: "error", error: toApiClientError(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(): Promise<void> {
    if (state.status !== "loaded" || state.gate.state !== "locked") return;
    const gateId = state.gate.id;

    setState((current) => (current.status === "loaded" ? { ...current, isDeciding: true, actionError: null } : current));

    try {
      const result = await approve(gateId, OPERATOR_ID);
      setState((current) =>
        current.status === "loaded"
          ? { ...current, gate: result.gate, execution: result.execution, isDeciding: false, actionError: null }
          : current
      );
    } catch (error: unknown) {
      setState((current) =>
        current.status === "loaded"
          ? { ...current, isDeciding: false, actionError: humanizeErrorCode(toApiClientError(error).code) }
          : current
      );
    }
  }

  async function handleReject(): Promise<void> {
    if (state.status !== "loaded" || state.gate.state !== "locked") return;
    const reason = typeof window === "undefined" ? null : window.prompt("Reason for rejecting this action:");
    const trimmedReason = reason?.trim();
    if (!trimmedReason) return;
    const gateId = state.gate.id;

    setState((current) => (current.status === "loaded" ? { ...current, isDeciding: true, actionError: null } : current));

    try {
      const result = await reject(gateId, OPERATOR_ID, trimmedReason);
      setState((current) =>
        current.status === "loaded"
          ? { ...current, gate: result.gate, decisionReason: trimmedReason, isDeciding: false, actionError: null }
          : current
      );
    } catch (error: unknown) {
      setState((current) =>
        current.status === "loaded"
          ? { ...current, isDeciding: false, actionError: humanizeErrorCode(toApiClientError(error).code) }
          : current
      );
    }
  }

  function handleApproveClick(): void {
    void handleApprove();
  }

  function handleRejectClick(): void {
    void handleReject();
  }

  if (state.status === "loading") {
    return <LoadingSkeleton />;
  }

  if (state.status === "error") {
    return <ErrorPanel error={state.error} onRetry={() => void load()} />;
  }

  const hasEvidence = state.packet.cards.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      {!hasEvidence ? (
        <p className="mb-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-rose-700 shadow-soft">
          No evidence collected. This gate cannot be approved without evidence.
        </p>
      ) : null}
      {state.actionError ? (
        <p className="mb-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-rose-700 shadow-soft">
          {state.actionError}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-3xl pb-6 shadow-soft">
        <RunbookPreview data={toPreviewData(state, { onApprove: handleApproveClick, onReject: handleRejectClick })} />
      </div>
    </div>
  );
}
