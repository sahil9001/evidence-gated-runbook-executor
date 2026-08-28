"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleDashed, Clock, History as HistoryIcon, XCircle } from "lucide-react";
import { ApiClientError, getRun, listRuns } from "../../../lib/api";
import type { ApprovalGate, RunRow } from "../../../lib/types";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Bounds the list the way every other capped list in this console does
 * (see `IncidentsClient`, and the server's own `?limit=` caps in
 * `runs.ts`/`audit.ts`) — the backend clamps this to 50 regardless. */
const HISTORY_LIMIT = 50;

const RUN_STATES: readonly RunRow["state"][] = ["collecting", "awaiting_approval", "approved", "rejected", "executed"];

function isRunState(value: string): value is RunRow["state"] {
  return (RUN_STATES as readonly string[]).includes(value);
}

const STATE_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "", label: "All states" },
  { value: "collecting", label: "Collecting evidence" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "executed", label: "Executed" }
];

/** A run is "decided" once a human has ruled on its gate — only then does
 * `ApprovalGate` (with `decidedBy`/`decidedAt`) exist to fetch. */
function isDecided(run: RunRow): boolean {
  return run.state === "approved" || run.state === "rejected" || run.state === "executed";
}

interface HistoryRow {
  readonly run: RunRow;
  readonly gate: ApprovalGate | null;
}

/**
 * `GET /runs` returns `RunRow[]` only — no gate join, no `decidedBy`. The
 * decision itself (approver, decided-at) lives on `ApprovalGate`, reachable
 * only per-run via `GET /runs/:id`. There is no batch gate-list endpoint, so
 * this fetches the gate for each *decided* row only, in parallel, bounded by
 * the same `HISTORY_LIMIT` already capped server-side — not an unbounded
 * per-row fan-out. A gate fetch that fails (e.g. a dangling reference) falls
 * back to `null` rather than failing the whole screen; that row just shows
 * no decision detail.
 */
async function fetchHistory(stateFilter: string): Promise<HistoryRow[]> {
  const runs = await listRuns({
    state: stateFilter === "" ? undefined : (stateFilter as RunRow["state"]),
    limit: HISTORY_LIMIT
  });

  const decided = runs.filter(isDecided);
  const gates = await Promise.all(
    decided.map((run) =>
      getRun(run.id)
        .then((detail) => detail.gate)
        .catch(() => null)
    )
  );
  const gateByRunId = new Map(decided.map((run, index) => [run.id, gates[index] ?? null]));

  return runs.map((run) => ({ run, gate: gateByRunId.get(run.id) ?? null }));
}

type HistoryState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: readonly HistoryRow[] };

interface RunStateBadgeProps {
  readonly state: RunRow["state"];
}

/** The scan-at-a-glance signal the screen exists for: approved/executed vs
 * rejected vs still-waiting, distinguishable by icon and color alone. */
function RunStateBadge({ state }: RunStateBadgeProps) {
  const config: Readonly<Record<RunRow["state"], { label: string; icon: typeof Clock; className: string }>> = {
    collecting: { label: "Collecting evidence", icon: CircleDashed, className: "bg-neutral-100 text-neutral-600" },
    awaiting_approval: { label: "Awaiting approval", icon: Clock, className: "bg-amber-50 text-amber-700" },
    approved: { label: "Approved", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-700" },
    rejected: { label: "Rejected", icon: XCircle, className: "bg-rose-50 text-rose-700" },
    executed: { label: "Executed", icon: CheckCircle2, className: "bg-sky-50 text-sky-700" }
  };
  const { label, icon: Icon, className } = config[state];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
      {label}
    </span>
  );
}

interface DecisionSummaryProps {
  readonly gate: ApprovalGate;
}

function DecisionSummary({ gate }: DecisionSummaryProps) {
  const decisionWord = gate.state === "approved" ? "Approved" : gate.state === "rejected" ? "Rejected" : "Decided";
  return (
    <p className="mt-1 text-xs text-neutral-500">
      {decisionWord} by <span className="font-medium text-neutral-700">{gate.decidedBy ?? "unknown"}</span>
      {gate.decidedAt === undefined ? "" : ` · ${formatTimestamp(gate.decidedAt)}`}
    </p>
  );
}

interface HistoryRowItemProps {
  readonly row: HistoryRow;
}

function HistoryRowItem({ row }: HistoryRowItemProps) {
  const { run, gate } = row;
  return (
    <li>
      <Link
        href={`/app/runs/${encodeURIComponent(run.id)}`}
        className="group flex flex-col gap-2 rounded-2xl px-4 py-4 transition hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{run.service}</p>
          <p className="mt-0.5 text-xs font-medium text-neutral-500">
            {run.createdBy === null ? "System" : run.createdBy} · {formatTimestamp(run.createdAt)}
          </p>
          {gate !== null ? <DecisionSummary gate={gate} /> : null}
        </div>
        <div className="shrink-0">
          <RunStateBadge state={run.state} />
        </div>
      </Link>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-soft" role="status" aria-label="Loading run history">
      <div className="space-y-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-14 w-full rounded-xl bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}

interface HistoryErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function HistoryError({ error, onRetry }: HistoryErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load run history</p>
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

function EmptyHistory() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl bg-white px-6 py-16 text-center shadow-soft">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-signal">
        <HistoryIcon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink">No runs match this filter.</p>
      <p className="max-w-sm text-xs text-neutral-500">Nothing has run yet under this state — check back later.</p>
    </section>
  );
}

/**
 * Reads/writes the state filter through the URL (`?state=`) so a filtered
 * view is shareable and survives a reload — mirrors `IncidentsClient`'s
 * `?status=` pattern.
 */
export function HistoryClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawState = searchParams.get("state") ?? "";
  const stateFilter = isRunState(rawState) ? rawState : "";

  const [state, setState] = useState<HistoryState>({ status: "loading" });

  const fetchAndSetHistory = useCallback((): Promise<void> => {
    return fetchHistory(stateFilter)
      .then((data) => setState({ status: "loaded", data }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, [stateFilter]);

  useEffect(() => {
    void fetchAndSetHistory();
  }, [fetchAndSetHistory]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchAndSetHistory();
  }

  function handleStateChange(value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "") {
      params.delete("state");
    } else {
      params.set("state", value);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `/app/history?${query}` : "/app/history");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="history-state-filter" className="text-sm font-semibold text-ink">
          State
        </label>
        <select
          id="history-state-filter"
          value={stateFilter}
          onChange={(event) => handleStateChange(event.target.value)}
          className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/30"
        >
          {STATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {state.status === "loading" ? <HistorySkeleton /> : null}
      {state.status === "error" ? <HistoryError error={state.error} onRetry={handleRetry} /> : null}
      {state.status === "loaded" && state.data.length === 0 ? <EmptyHistory /> : null}
      {state.status === "loaded" && state.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-3xl bg-white p-2 shadow-soft">
          {state.data.map((row) => (
            <HistoryRowItem key={row.run.id} row={row} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
