"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Clock, History as HistoryIcon, Link2, Timer, TriangleAlert, UserRound } from "lucide-react";
import { getRun, listRuns, type ApiClientError } from "@/lib/api";
import type { ApprovalGate, RunRow } from "@/lib/types";
import { useAbortableResource } from "@/hooks/useAbortableResource";
import { Band, EmptyState, Rows } from "@/app/app/components/console/Surface";
import { RUN_STATE_PRESENTATION, RunStatePill } from "@/app/app/components/console/Indicators";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
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

/** Rows carry the time only: the day they belong to is already the heading
 * above them, and repeating it on every row is noise. */
function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * How long the run took: creation to its last state change. For a run still
 * in flight that is time-to-latest-transition, not time-to-now — deliberately,
 * since `updatedAt` is the last fact the API actually reports.
 */
function formatElapsed(startIso: string, endIso: string): string | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Bounds the list the way every other capped list in this console does
 * (see `IncidentsClient`, and the server's own `?limit=` caps in
 * `runs.ts`/`audit.ts`) — the backend clamps this to 50 regardless. */
const HISTORY_LIMIT = 50;

const RUN_STATES: readonly RunRow["state"][] = ["collecting", "awaiting_approval", "approved", "rejected", "executed"];

function isRunState(value: string): value is RunRow["state"] {
  return (RUN_STATES as readonly string[]).includes(value);
}

/** Filter labels come from the same table the pills read, so a state can
 * never be called one thing in the filter and another in the row. */
const STATE_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "", label: "All" },
  ...RUN_STATES.map((state) => ({ value: state, label: RUN_STATE_PRESENTATION[state].label }))
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
async function fetchHistory(stateFilter: string, signal: AbortSignal): Promise<HistoryRow[]> {
  const runs = await listRuns(
    {
      state: stateFilter === "" ? undefined : (stateFilter as RunRow["state"]),
      limit: HISTORY_LIMIT
    },
    signal
  );

  const decided = runs.filter(isDecided);
  const gates = await Promise.all(
    decided.map((run) =>
      getRun(run.id, signal)
        .then((detail) => detail.gate)
        .catch(() => null)
    )
  );
  const gateByRunId = new Map(decided.map((run, index) => [run.id, gates[index] ?? null]));

  return runs.map((run) => ({ run, gate: gateByRunId.get(run.id) ?? null }));
}

interface DayGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly HistoryRow[];
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return "Today";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Runs arrive newest-first, so consecutive runs from the same day are already
 * adjacent: grouping is a fold over that order, never a re-sort. A flat list
 * of fifty timestamps reads as one undifferentiated column; the day breaks
 * are what let an operator find "the afternoon everything went wrong".
 */
function groupByDay(rows: readonly HistoryRow[]): readonly DayGroup[] {
  return rows.reduce<readonly DayGroup[]>((groups, row) => {
    const key = dayKey(row.run.createdAt);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) {
      return [...groups.slice(0, -1), { ...last, rows: [...last.rows, row] }];
    }
    return [...groups, { key, label: dayLabel(row.run.createdAt), rows: [row] }];
  }, []);
}

interface StateFilterProps {
  readonly onChange: (value: string) => void;
  readonly value: string;
}

/** Segmented, not a `<select>`: the six run states ARE the vocabulary of
 * this screen, so they stay legible instead of hiding behind a closed menu.
 * Native radios in a `<fieldset>` keep arrow-key navigation and the group's
 * accessible name for free. */
function StateFilter({ onChange, value }: StateFilterProps) {
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <legend className="sr-only">Filter runs by state</legend>
      <span
        aria-hidden="true"
        className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400"
      >
        State
      </span>
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-sky-100 p-0.5">
        {STATE_OPTIONS.map((option) => (
          <label key={option.value || "all"} className="cursor-pointer">
            <input
              type="radio"
              name="run-state"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="inline-flex items-center rounded-md px-3 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:text-ink peer-checked:bg-sky-50 peer-checked:text-signal peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface DecisionSummaryProps {
  readonly gate: ApprovalGate;
}

function DecisionSummary({ gate }: DecisionSummaryProps) {
  const decisionWord = gate.state === "approved" ? "Approved" : gate.state === "rejected" ? "Rejected" : "Decided";
  return (
    <p className="mt-1.5 text-xs text-neutral-500">
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
  const elapsed = formatElapsed(run.createdAt, run.updatedAt);

  return (
    <li>
      <Link
        href={`/app/runs/${encodeURIComponent(run.id)}`}
        className="group flex flex-col gap-3 px-2 py-5 transition-colors hover:bg-sky-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal sm:flex-row sm:items-center sm:gap-8"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-6 text-ink">{run.service}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
              incident <ShortId value={run.incidentId} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
              {run.createdBy === null ? "System" : run.createdBy}
            </span>
            <time dateTime={run.createdAt} className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
              {formatClock(run.createdAt)}
            </time>
          </p>
          {gate !== null ? <DecisionSummary gate={gate} /> : null}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {elapsed === null ? null : (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-neutral-500"
              title="From run start to its last state change"
            >
              <Timer className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Elapsed </span>
              {elapsed}
            </span>
          )}
          <RunStatePill state={run.state} />
          <ArrowRight
            className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-signal"
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  );
}

/** Ids are references, not reading material: shown short and monospaced so a
 * row stays scannable, with the full value on the element for anyone who
 * needs to copy or verify it. */
function ShortId({ value }: { readonly value: string }) {
  const short = value.length > 12 ? `${value.slice(0, 8)}…` : value;
  return (
    <abbr title={value} className="font-mono text-[11px] font-medium text-neutral-600 no-underline">
      {short}
    </abbr>
  );
}

function HistorySkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading run history">
      <div className="h-2.5 w-24 rounded-full bg-sky-100" />
      <div className="mt-4 divide-y divide-sky-100 border-y border-sky-100">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-8 px-2 py-5">
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-1/3 rounded bg-neutral-100" />
              <div className="mt-2.5 h-2.5 w-48 rounded-full bg-sky-50" />
            </div>
            <div className="h-2.5 w-10 rounded-full bg-neutral-100" />
            <div className="h-5 w-24 rounded bg-sky-50" />
          </div>
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
    <div className="flex items-start gap-3 border-y border-sky-100 px-2 py-12">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" strokeWidth={2} aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-ink">Could not load run history</p>
        <p className="mt-1 text-sm leading-6 text-neutral-600">{humanizeErrorCode(error.code)}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center rounded-md bg-signal px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          Retry
        </button>
      </div>
    </div>
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

  const fetchAndSetHistory = useCallback(
    (signal: AbortSignal): Promise<HistoryRow[]> => fetchHistory(stateFilter, signal),
    [stateFilter]
  );
  const { state, retry } = useAbortableResource(fetchAndSetHistory, stateFilter);

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
    <>
      <Band className="py-5 sm:py-6">
        <StateFilter value={stateFilter} onChange={handleStateChange} />
      </Band>

      <Band divided={false} className="pt-2">
        {state.status === "loading" ? <HistorySkeleton /> : null}
        {state.status === "error" ? <HistoryError error={state.error} onRetry={retry} /> : null}
        {state.status === "loaded" && state.data.length === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No runs match this filter."
            body="Nothing has run yet under this state — check back later."
          />
        ) : null}
        {state.status === "loaded" && state.data.length > 0
          ? groupByDay(state.data).map((group) => (
              <section key={group.key} className="pt-9 first:pt-0">
                <div className="flex items-baseline justify-between gap-4 pb-3">
                  {/* An eyebrow-weight <h2>: a date is a landmark for
                      navigation, not a headline competing with the rows. */}
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                    {group.label}
                  </h2>
                  <span className="text-[11px] font-medium tabular-nums text-neutral-400">
                    {group.rows.length} {group.rows.length === 1 ? "run" : "runs"}
                  </span>
                </div>
                <Rows>
                  {group.rows.map((row) => (
                    <HistoryRowItem key={row.run.id} row={row} />
                  ))}
                </Rows>
              </section>
            ))
          : null}
      </Band>
    </>
  );
}
