"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, ListChecks, Siren } from "lucide-react";
import { ApiClientError, getOverview } from "../../lib/api";
import type { AuditEntry, OverviewResponse } from "../../lib/types";

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

type OverviewState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: OverviewResponse };

/**
 * A human on-call engineer should never have to know what `gate_approved`
 * means. Each audit `kind` gets a plain-language label; the backend's own
 * `detail` string (already a full sentence, see routes/{run,approvals}.ts)
 * carries the specifics underneath.
 */
const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  run_created: "Run started",
  evidence_partial: "Evidence collection had failures",
  gate_approved: "Approval granted",
  action_executed: "Action executed",
  gate_rejected: "Approval rejected"
};

function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? kind.replace(/_/g, " ");
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

interface AwaitingApprovalHeroProps {
  readonly count: number;
}

/**
 * The number this whole screen exists for. Largest element on the page by
 * a wide margin, calm and quiet at zero, dark and pulsing at non-zero — an
 * on-call engineer scanning this page half-awake should not have to read
 * anything to know whether they need to act.
 */
function AwaitingApprovalHero({ count }: AwaitingApprovalHeroProps) {
  const isCalm = count === 0;

  return (
    <Link
      href="/app/incidents"
      aria-label={
        isCalm
          ? "Nothing awaiting approval"
          : `${count} gate${count === 1 ? "" : "s"} awaiting approval — review now`
      }
      className={`group relative flex min-h-[260px] flex-col justify-between overflow-hidden rounded-3xl p-6 shadow-soft transition duration-200 hover:translate-y-[-2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal sm:p-8 ${
        isCalm ? "bg-white" : "bg-ink"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-sm font-semibold ${isCalm ? "text-signal" : "text-sky-300"}`}>Awaiting approval</p>
          <p className={`mt-1 text-xs font-medium ${isCalm ? "text-neutral-500" : "text-white/60"}`}>
            {isCalm ? "Nothing needs you right now." : "Gates locked on a human decision."}
          </p>
        </div>
        {isCalm ? (
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-500" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <span
            className="mt-1 flex h-3 w-3 shrink-0 rounded-full bg-rose-500 rp-pulse"
            aria-hidden="true"
          />
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-3">
          <span
            className={`text-7xl font-bold leading-none tracking-tight tabular-nums sm:text-8xl ${
              isCalm ? "text-ink" : "text-white"
            }`}
          >
            {count}
          </span>
          <span className={`text-sm font-medium ${isCalm ? "text-neutral-500" : "text-white/70"}`}>
            {count === 1 ? "gate" : "gates"}
          </span>
        </div>

        <p
          className={`mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition ${
            isCalm ? "text-neutral-400" : "text-sky-300 group-hover:text-white"
          }`}
        >
          {isCalm ? "All clear." : "Review now"}
          {isCalm ? null : (
            <ArrowRight
              className="h-4 w-4 transition group-hover:translate-x-0.5"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          )}
        </p>
      </div>
    </Link>
  );
}

interface SecondaryStatProps {
  readonly label: string;
  readonly value: number;
  readonly icon: typeof Siren;
}

/** Supporting context for the hero — deliberately smaller, quieter, no motion. */
function SecondaryStat({ label, value, icon: Icon }: SecondaryStatProps) {
  return (
    <div className="flex flex-1 items-center gap-4 rounded-2xl bg-white p-5 shadow-soft">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel text-signal">
        <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div>
        <p className="text-2xl font-semibold leading-none tabular-nums text-ink">{value}</p>
        <p className="mt-1 text-xs font-medium text-neutral-500">{label}</p>
      </div>
    </div>
  );
}

interface ActivityRowProps {
  readonly entry: AuditEntry;
}

function ActivityRow({ entry }: ActivityRowProps) {
  return (
    <li>
      <Link
        href={`/app/runs/${encodeURIComponent(entry.runId)}`}
        className="group flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{activityLabel(entry.kind)}</p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">{entry.detail}</p>
        </div>
        <time
          dateTime={entry.at}
          className="shrink-0 whitespace-nowrap text-xs font-medium text-neutral-400 group-hover:text-neutral-600"
        >
          {formatTimestamp(entry.at)}
        </time>
      </Link>
    </li>
  );
}

interface RecentActivityProps {
  readonly entries: readonly AuditEntry[];
}

function RecentActivity({ entries }: RecentActivityProps) {
  return (
    <section className="rounded-3xl bg-white p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-signal">Recent activity</h2>
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-panel px-4 py-6 text-center text-sm font-medium text-neutral-500">
          No activity yet. Runs and decisions will show up here as they happen.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-neutral-100">
          {entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading overview">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-h-[260px] rounded-3xl bg-white p-8 shadow-soft">
          <div className="h-3 w-32 rounded-full bg-neutral-200" />
          <div className="mt-8 h-20 w-40 rounded-2xl bg-neutral-200" />
        </div>
        <div className="flex flex-col gap-4">
          {[0, 1].map((row) => (
            <div key={row} className="flex-1 rounded-2xl bg-white p-5 shadow-soft">
              <div className="h-8 w-16 rounded-full bg-neutral-200" />
              <div className="mt-3 h-3 w-20 rounded-full bg-neutral-100" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-3xl bg-white p-6 shadow-soft">
        <div className="h-3 w-28 rounded-full bg-neutral-200" />
        <div className="mt-5 space-y-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-4 w-full rounded-full bg-neutral-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface OverviewErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function OverviewError({ error, onRetry }: OverviewErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load the overview</p>
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

export function OverviewClient() {
  const [state, setState] = useState<OverviewState>({ status: "loading" });

  // Note: no synchronous `setState` at the top of this function — only
  // inside the `.then`/`.catch` callbacks below. `useEffect` flags a
  // synchronous `setState` in its body as a cascading-render risk; deferring
  // the state change to the promise callback (mirroring TopBar's fetch
  // above) keeps the effect itself free of it. The initial "loading" state
  // is already the `useState` default, so no separate kickoff is needed.
  const fetchOverview = useCallback((): Promise<void> => {
    return getOverview()
      .then((data) => setState({ status: "loaded", data }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchOverview();
  }

  if (state.status === "loading") {
    return <OverviewSkeleton />;
  }

  if (state.status === "error") {
    return <OverviewError error={state.error} onRetry={handleRetry} />;
  }

  const { data } = state;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <AwaitingApprovalHero count={data.awaitingApproval} />
        <div className="flex flex-col gap-4">
          <SecondaryStat label="Active incidents" value={data.activeIncidents} icon={Siren} />
          <SecondaryStat label="Runs today" value={data.runsToday} icon={ListChecks} />
        </div>
      </div>

      <RecentActivity entries={data.recentActivity} />

      {data.activeIncidents === 0 && data.recentActivity.length === 0 ? (
        <p className="flex items-center gap-2 px-2 text-xs font-medium text-neutral-400">
          <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Quiet so far — nothing has happened yet.
        </p>
      ) : null}
    </div>
  );
}
