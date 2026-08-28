"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiClientError, getRun } from "../../../../lib/api";
import type { ApprovalGate, ExecutionResult, RunDetailResponse, RunRow } from "../../../../lib/types";
import { ApprovalTab } from "./components/ApprovalTab";
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
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-soft" role="status" aria-label="Loading run">
      <div className="h-4 w-48 rounded-full bg-neutral-200" />
      <div className="mt-4 h-3 w-32 rounded-full bg-neutral-100" />
      <div className="mt-8 h-64 w-full rounded-2xl bg-neutral-100" />
    </div>
  );
}

interface RunDetailErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function RunDetailError({ error, onRetry }: RunDetailErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load this run</p>
      <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Retry
      </button>
    </div>
  );
}

/** Distinct from `RunDetailError`: a missing run is permanent, not
 * transient — there is nothing a retry would fix, so no retry button, only
 * a way back. */
function RunNotFound() {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Run not found</p>
      <p className="mt-1 text-sm text-neutral-600">
        No run exists with this id. It may have been removed, or the link is wrong.
      </p>
      <Link
        href="/app/incidents"
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Back to incidents
      </Link>
    </div>
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
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-white p-6 shadow-soft sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{incidentTitle}</h2>
            <p className="mt-1 text-sm font-medium text-neutral-500">
              {data.run.service} · run {data.run.id}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-panel px-3 py-1 text-xs font-semibold text-signal">
            {data.run.state.replace(/_/g, " ")}
          </span>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Started {formatTimestamp(data.run.createdAt)}
          {data.run.createdBy === null ? "" : ` by ${data.run.createdBy}`}
        </p>
      </section>

      <TabNav activeTab={activeTab} onChange={handleTabChange} />

      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        tabIndex={0}
        className="rounded-3xl bg-panel p-4 sm:p-6"
      >
        {activeTab === "evidence" ? (
          <EvidenceTab packet={data.packet} failures={data.failures} confidence={data.confidence} />
        ) : null}
        {activeTab === "diagnostics" ? <DiagnosticsTab packet={data.packet} /> : null}
        {activeTab === "approval" ? (
          <ApprovalTab
            incidentTitle={incidentTitle}
            runbookId={data.run.runbookId}
            serviceName={data.run.service}
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
    </div>
  );
}
