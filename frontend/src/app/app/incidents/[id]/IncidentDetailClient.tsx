"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { ApiClientError, getIncident, startRun } from "../../../../lib/api";
import type { IncidentDetailResponse, RunRow } from "../../../../lib/types";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again.",
  no_matching_runbook: "No runbook currently matches this incident's service and signals.",
  scope_violation: "A source outside the matched runbook's scope was requested."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: IncidentDetailResponse };

type StartRunState = { status: "idle" } | { status: "starting" } | { status: "error"; message: string };

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

function DetailSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-soft" role="status" aria-label="Loading incident">
      <div className="h-4 w-48 rounded-full bg-neutral-200" />
      <div className="mt-4 h-3 w-32 rounded-full bg-neutral-100" />
      <div className="mt-8 h-24 w-full rounded-2xl bg-neutral-100" />
    </div>
  );
}

interface DetailErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function DetailError({ error, onRetry }: DetailErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load this incident</p>
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

interface RunListItemProps {
  readonly run: RunRow;
}

function RunListItem({ run }: RunListItemProps) {
  return (
    <li>
      <Link
        href={`/app/runs/${encodeURIComponent(run.id)}`}
        className="group flex items-center justify-between gap-3 rounded-xl px-3 py-3 transition hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{run.id}</p>
          <p className="mt-0.5 text-xs font-medium text-neutral-500">{run.state.replace(/_/g, " ")}</p>
        </div>
        <time dateTime={run.createdAt} className="shrink-0 text-xs font-medium text-neutral-400">
          {formatTimestamp(run.createdAt)}
        </time>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-signal"
          strokeWidth={2}
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

interface OrphanedIncidentProps {
  readonly startState: StartRunState;
  readonly onStart: () => void;
}

/** The recovery path for "create succeeded, run failed" (see NewIncidentClient):
 * an incident can exist with zero runs, and this is where an operator lands
 * to try again rather than being stuck on a dead screen. */
function OrphanedIncident({ startState, onStart }: OrphanedIncidentProps) {
  const isStarting = startState.status === "starting";

  return (
    <div className="rounded-2xl bg-panel p-5">
      <p className="text-sm font-semibold text-ink">No run has started for this incident yet.</p>
      <p className="mt-1 text-xs text-neutral-600">
        Evidence collection hasn&apos;t begun. Start a run using this incident&apos;s service and signals.
      </p>

      {startState.status === "error" ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Something went wrong starting the run: {startState.message}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onStart}
        disabled={isStarting}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isStarting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
        ) : (
          <PlayCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        )}
        {isStarting ? "Starting…" : "Start a run"}
      </button>
    </div>
  );
}

interface IncidentDetailClientProps {
  readonly incidentId: string;
}

export function IncidentDetailClient({ incidentId }: IncidentDetailClientProps) {
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [startState, setStartState] = useState<StartRunState>({ status: "idle" });

  const fetchDetail = useCallback((): Promise<void> => {
    return getIncident(incidentId)
      .then((data) => setState({ status: "loaded", data }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, [incidentId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchDetail();
  }

  function handleStartRun(): void {
    if (state.status !== "loaded") return;
    const { incident } = state.data;
    setStartState({ status: "starting" });
    startRun(incident.id)
      .then((result) => {
        router.push(`/app/runs/${result.run.id}`);
      })
      .catch((error: unknown) => {
        setStartState({ status: "error", message: toApiClientError(error).message });
      });
  }

  if (state.status === "loading") {
    return <DetailSkeleton />;
  }

  if (state.status === "error") {
    return <DetailError error={state.error} onRetry={handleRetry} />;
  }

  const { incident, runs } = state.data;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{incident.title}</h2>
            <p className="mt-1 text-sm font-medium text-neutral-500">{incident.service}</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-panel px-3 py-1 text-xs font-semibold text-signal">
            {incident.status}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {incident.signals.map((signal) => (
            <span key={signal} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
              {signal}
            </span>
          ))}
        </div>

        <p className="mt-4 text-xs text-neutral-500">
          Opened by {incident.createdBy} on {formatTimestamp(incident.createdAt)}
        </p>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-soft sm:p-6">
        <h3 className="text-sm font-semibold text-signal">Runs</h3>

        {runs.length === 0 ? (
          <div className="mt-4">
            <OrphanedIncident startState={startState} onStart={handleStartRun} />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-neutral-100">
            {runs.map((run) => (
              <RunListItem key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
