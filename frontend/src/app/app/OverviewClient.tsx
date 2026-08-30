"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  FileSearch,
  ListChecks,
  LockKeyhole,
  Play,
  RotateCcw,
  Siren
} from "lucide-react";
import { ApiClientError, getOverview } from "../../lib/api";
import { computeReadiness } from "../../lib/readiness";
import type { AuditEntry, OverviewResponse } from "../../lib/types";
import { activityPresentation, shortenIds } from "../../lib/audit-format";
import { Band, ConsoleContainer, EmptyState, SectionTitle } from "./components/console/Surface";
import { Figure } from "./components/console/Indicators";
import { PipelineFlow } from "./components/console/PipelineFlow";
import { ReadinessPanel } from "./components/console/ReadinessPanel";

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

function ActivityRow({ entry }: { entry: AuditEntry }) {
  const presentation = activityPresentation(entry.kind);
  const Icon = presentation.icon;

  return (
    <li>
      <Link
        href={`/app/runs/${encodeURIComponent(entry.runId)}`}
        className="group flex items-start gap-3 py-3.5 transition hover:bg-sky-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${presentation.className}`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{presentation.label}</span>
          <span className="mt-0.5 block truncate text-xs text-neutral-500">
            {shortenIds(entry.detail)}
          </span>
        </span>
        <time
          dateTime={entry.at}
          className="shrink-0 whitespace-nowrap pt-0.5 text-xs font-medium tabular-nums text-neutral-400 group-hover:text-neutral-600"
        >
          {formatTimestamp(entry.at)}
        </time>
      </Link>
    </li>
  );
}

function OverviewSkeleton() {
  return (
    <ConsoleContainer>
      <div className="animate-pulse py-10" role="status" aria-label="Loading overview">
        <div className="flex gap-8">
          <div className="h-[136px] w-[136px] shrink-0 rounded-full bg-sky-50" />
          <div className="flex-1 space-y-5 pt-4">
            <div className="h-2 w-full rounded-full bg-sky-50" />
            <div className="h-2 w-4/5 rounded-full bg-sky-50" />
          </div>
        </div>
        <div className="mt-10 grid gap-px border-y border-sky-100 bg-sky-100 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="h-36 bg-white p-5">
              <div className="h-8 w-8 rounded-lg bg-sky-50" />
              <div className="mt-4 h-2 w-24 rounded-full bg-sky-50" />
            </div>
          ))}
        </div>
      </div>
    </ConsoleContainer>
  );
}

function OverviewError({ error, onRetry }: { error: ApiClientError; onRetry: () => void }) {
  return (
    <ConsoleContainer>
      <div className="border-y border-rose-100 bg-rose-50/40 px-6 py-10">
        <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
          <CircleAlert className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Could not load the overview
        </p>
        <p className="mt-1.5 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
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

export function OverviewClient() {
  const [state, setState] = useState<OverviewState>({ status: "loading" });

  // Note: no synchronous `setState` at the top of this function — only
  // inside the `.then`/`.catch` callbacks below. `useEffect` flags a
  // synchronous `setState` in its body as a cascading-render risk; deferring
  // the state change to the promise callback keeps the effect free of it.
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

  if (state.status === "loading") return <OverviewSkeleton />;
  if (state.status === "error") return <OverviewError error={state.error} onRetry={handleRetry} />;

  const { data } = state;
  const readiness = computeReadiness(data);
  const hasNothingYet = data.activeIncidents === 0 && readiness.totalRuns === 0;

  return (
    <>
      <Band divided={false} className="pt-2">
        <ConsoleContainer>
          <ReadinessPanel readiness={readiness} />
        </ConsoleContainer>
      </Band>

      <Band>
        <ConsoleContainer>
          <SectionTitle
            title="How an incident moves"
            hint="Every incident walks these four stages. The counts are live."
          />
        </ConsoleContainer>
        <PipelineFlow overview={data} />
      </Band>

      <Band>
        <ConsoleContainer>
          <div className="grid gap-8 sm:grid-cols-3">
            <Figure
              icon={LockKeyhole}
              label="Awaiting approval"
              value={data.awaitingApproval}
              tone={data.awaitingApproval > 0 ? "warn" : "good"}
              caption={
                data.awaitingApproval > 0
                  ? "Locked on a human decision."
                  : "Nothing is blocked on you."
              }
            />
            <Figure icon={Siren} label="Active incidents" value={data.activeIncidents} caption="Not yet resolved." />
            <Figure icon={ListChecks} label="Runs today" value={data.runsToday} caption="Started since midnight UTC." />
          </div>
        </ConsoleContainer>
      </Band>

      <Band>
        <ConsoleContainer>
          <SectionTitle
            title="Recent activity"
            hint="Newest first, across every run."
            action={
              <Link
                href="/app/audit"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-signal transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
              >
                Full audit log
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </Link>
            }
          />

          {data.recentActivity.length === 0 ? (
            <EmptyState
              icon={hasNothingYet ? Play : FileSearch}
              title={hasNothingYet ? "Nothing has run yet" : "No activity yet"}
              body={
                hasNothingYet
                  ? "Open an incident and start a run. The agent gathers evidence, replays it in a sandbox, and stops at the approval gate."
                  : "Runs and decisions will show up here as they happen."
              }
              action={
                <Link
                  href="/app/incidents/new"
                  className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                >
                  New incident
                  <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-sky-100 border-y border-sky-100">
              {data.recentActivity.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </ConsoleContainer>
      </Band>
    </>
  );
}
