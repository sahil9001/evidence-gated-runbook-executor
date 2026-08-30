"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, PlayCircle, Radio } from "lucide-react";
import { SectionTitle } from "../../components/console/Surface";
import { DeleteIncidentButton } from "../../components/console/DeleteIncidentButton";
import { Pill } from "../../components/console/Indicators";
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
    <div className="animate-pulse py-2" role="status" aria-label="Loading incident">
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
    <div className="border-y border-rose-100 bg-rose-50/40 px-6 py-10">
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
        className="group flex items-center justify-between gap-3 py-3.5 transition hover:bg-sky-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
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
    <div className="border-l-2 border-signal bg-sky-50/70 p-5">
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
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
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
    <div className="flex flex-col">
      <section className="pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              {incident.service}
            </p>
            <h2
              className="mt-2 text-balance font-semibold tracking-[-0.02em] text-ink"
              style={{ fontSize: "clamp(1.4rem, 1.1rem + 1vw, 2rem)", lineHeight: 1.1 }}
            >
              {incident.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-start gap-3">
            <Pill tone={incident.status === "resolved" ? "good" : "info"}>{incident.status}</Pill>
            {/* Deleting from here leaves the operator on a page for an
                incident that no longer exists, so this navigates back to
                the list rather than refetching into a guaranteed 404. */}
            <DeleteIncidentButton
              incidentId={incident.id}
              incidentTitle={incident.title}
              onDeleted={() => router.push("/app/incidents")}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {incident.signals.map((signal) => (
            <span
              key={signal}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700"
            >
              <Radio className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" />
              {signal}
            </span>
          ))}
        </div>

        <p className="mt-5 text-xs text-neutral-500">
          Opened by {incident.createdBy} on {formatTimestamp(incident.createdAt)}
        </p>
      </section>

      <section className="border-t border-sky-100 pt-8">
        <SectionTitle
          title="Runs"
          hint={
            runs.length === 0
              ? "No evidence has been gathered for this incident yet."
              : `${runs.length} run${runs.length === 1 ? "" : "s"} against this incident.`
          }
        />

        {runs.length === 0 ? (
          <OrphanedIncident startState={startState} onStart={handleStartRun} />
        ) : (
          <ul className="divide-y divide-sky-100 border-y border-sky-100">
            {runs.map((run) => (
              <RunListItem key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
