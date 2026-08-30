"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiClientError, getRun } from "../../../../lib/api";
import type { ApprovalGate, ExecutionResult, RunDetailResponse, RunRow } from "../../../../lib/types";
import { RotateCcw, ShieldOff } from "lucide-react";
import { Band, ConsoleContainer } from "../../components/console/Surface";
import { RunStatePill } from "../../components/console/Indicators";
import { ApprovalTab } from "./components/ApprovalTab";
import { RunStages } from "./components/RunStages";
import { AuditTab } from "./components/AuditTab";
import { DiagnosticsTab } from "./components/DiagnosticsTab";
import { EvidenceTab } from "./components/EvidenceTab";
import { TabNav } from "./components/TabNav";
import { formatTimestamp, humanizeErrorCode, isTabId, toApiClientError, type TabId } from "./shared";

type RunDetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: RunDetailResponse };

/** The gate is what needs a human — default there when it's still locked,
 * otherwise land on the evidence that was actually collected. */
function defaultTab(gate: ApprovalGate | null): TabId {
  return gate !== null && gate.state === "locked" ? "approval" : "evidence";
}

function RunDetailSkeleton() {
  return (
    <ConsoleContainer>
      <div className="animate-pulse py-8" role="status" aria-label="Loading run">
        <div className="h-5 w-64 rounded-full bg-sky-50" />
        <div className="mt-4 h-3 w-40 rounded-full bg-sky-50" />
        <div className="mt-8 h-px w-full bg-sky-100" />
        <div className="mt-8 h-64 w-full bg-sky-50/50" />
      </div>
    </ConsoleContainer>
  );
}

interface RunDetailErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function RunDetailError({ error, onRetry }: RunDetailErrorProps) {
  return (
    <ConsoleContainer>
      <div className="my-8 border-y border-rose-100 bg-rose-50/40 px-6 py-10">
        <p className="text-sm font-semibold text-rose-700">Could not load this run</p>
        <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Retry
        </button>
      </div>
    </ConsoleContainer>
  );
}

/** Distinct from `RunDetailError`: a missing run is permanent, not
 * transient — there is nothing a retry would fix, so no retry button, only
 * a way back. */
function RunNotFound() {
  return (
    <ConsoleContainer>
      <div className="my-8 flex flex-col items-center border-y border-sky-100 px-6 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <ShieldOff className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <p className="mt-4 text-sm font-semibold text-ink">Run not found</p>
        <p className="mt-1.5 max-w-sm text-sm leading-6 text-neutral-500">
          No run exists with this id. It may have been removed, or the link is wrong.
        </p>
        <Link
          href="/app/incidents"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Back to incidents
        </Link>
      </div>
    </ConsoleContainer>
  );
}

interface RunDetailClientProps {
  readonly runId: string;
}

export function RunDetailClient({ runId }: RunDetailClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<RunDetailState>({ status: "loading" });
  const [lastExecution, setLastExecution] = useState<ExecutionResult | undefined>(undefined);

  // Frozen the moment a `getRun` call resolves, from the gate state as it
  // was then — deciding the gate (approving/rejecting from this tab) must
  // not yank the operator onto a different tab just because `defaultTab`
  // would now compute something else from the post-decision gate.
  // `handleDecided` below deliberately never touches this: it updates
  // `state.data.gate` directly without going through `fetchDetail`, so a
  // decision can never re-trigger this recompute. `fetchDetail` itself only
  // runs on mount, on a `runId` change, or an explicit retry — every one of
  // those is a fresh view where recomputing the default is exactly right.
  const [initialTab, setInitialTab] = useState<TabId | null>(null);

  const fetchDetail = useCallback((): Promise<void> => {
    return getRun(runId)
      .then((data) => {
        setState({ status: "loaded", data });
        setInitialTab(defaultTab(data.gate));
      })
      .catch((error: unknown) => {
        const apiError = toApiClientError(error);
        setState(apiError.code === "not_found" ? { status: "not-found" } : { status: "error", error: apiError });
      });
  }, [runId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchDetail();
  }

  // Lifted to this level (rather than kept local to ApprovalTab) because
  // only the active tab's content is mounted — a decision made on the
  // Approval tab must still be reflected if the operator switches away and
  // back, which only works if the updated gate lives above the tab that
  // unmounts.
  // Qodo finding: updating only `data.gate` left `data.run.state` at its
  // pre-decision value, so the header kept showing "awaiting approval"
  // after the backend had already moved the run to executed/rejected.
  // `runState` is read straight off the decision response — never inferred
  // from `updatedGate.state`, which for approve is "approved" while the
  // run's real resulting state is "executed" (backend/src/routes/approvals.ts).
  function handleDecided(updatedGate: ApprovalGate, runState: RunRow["state"], execution?: ExecutionResult): void {
    setState((prev) =>
      prev.status === "loaded"
        ? { status: "loaded", data: { ...prev.data, gate: updatedGate, run: { ...prev.data.run, state: runState } } }
        : prev
    );
    setLastExecution(execution);
  }

  function handleTabChange(tab: TabId): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`/app/runs/${encodeURIComponent(runId)}?${params.toString()}`);
  }

  if (state.status === "loading") return <RunDetailSkeleton />;
  if (state.status === "not-found") return <RunNotFound />;
  if (state.status === "error") return <RunDetailError error={state.error} onRetry={handleRetry} />;

  const { data } = state;
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = isTabId(tabParam) ? tabParam : (initialTab ?? defaultTab(data.gate));
  // `incident` is guaranteed present here — GET /runs/:id 404s rather than
  // returning a null incident (backend/src/routes/runs.ts) — so no fallback
  // to `data.run.service` is needed.
  const incidentTitle = data.incident.title;

  return (
    <>
      <ConsoleContainer>
        <div className="flex flex-wrap items-start justify-between gap-4 pb-6 pt-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              {data.run.service} · runbook {data.run.runbookId}
            </p>
            <h2
              className="mt-2 text-balance font-semibold tracking-[-0.02em] text-ink"
              style={{ fontSize: "clamp(1.4rem, 1.1rem + 1vw, 2rem)", lineHeight: 1.1 }}
            >
              {incidentTitle}
            </h2>
            <p className="mt-2 text-xs text-neutral-500">
              Started {formatTimestamp(data.run.createdAt)}
              {data.run.createdBy === null ? "" : ` by ${data.run.createdBy}`} · run{" "}
              <span className="font-mono text-[11px]">{data.run.id.slice(0, 8)}…</span>
            </p>
          </div>
          <RunStatePill state={data.run.state} />
        </div>

        {/* The stage strip answers "where is this run stuck" before the
            operator has to read a single tab. */}
        <RunStages
          failures={data.failures}
          gate={data.gate}
          packet={data.packet}
          runState={data.run.state}
        />
      </ConsoleContainer>

      <Band className="pt-6">
        <ConsoleContainer>
          <TabNav activeTab={activeTab} onChange={handleTabChange} />

          <div
            role="tabpanel"
            id={`panel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
            tabIndex={0}
            className="pt-7 focus-visible:outline-none"
          >
            {activeTab === "evidence" ? (
              <EvidenceTab packet={data.packet} failures={data.failures} confidence={data.confidence} />
            ) : null}
            {activeTab === "diagnostics" ? <DiagnosticsTab packet={data.packet} /> : null}
            {activeTab === "approval" ? (
              <ApprovalTab
                packet={data.packet}
                action={data.action}
                gate={data.gate}
                confidence={data.confidence}
                lastExecution={lastExecution}
                onDecided={handleDecided}
              />
            ) : null}
            {activeTab === "audit" ? <AuditTab runId={runId} /> : null}
          </div>
        </ConsoleContainer>
      </Band>
    </>
  );
}
