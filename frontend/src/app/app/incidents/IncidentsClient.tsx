"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, PlusCircle, Siren } from "lucide-react";
import { listIncidents, type ApiClientError } from "../../../lib/api";
import type { IncidentRow } from "../../../lib/types";
import { useAbortableResource } from "../../../hooks/useAbortableResource";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

/** The console has no update-status endpoint yet, so "open" is effectively
 * the only status incidents carry today — "resolved" is offered anyway so
 * the filter (and the URL contract it drives) already matches what the
 * backend's `?status=` query accepts, ready for whenever a status change
 * lands. */
const STATUS_OPTIONS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" }
];

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

function StatusBadge({ status }: { readonly status: string }) {
  const isOpen = status === "open";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        isOpen ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {status}
    </span>
  );
}

interface IncidentRowItemProps {
  readonly incident: IncidentRow;
}

function IncidentRowItem({ incident }: IncidentRowItemProps) {
  return (
    <li>
      <Link
        href={`/app/incidents/${encodeURIComponent(incident.id)}`}
        className="group flex flex-col gap-2 rounded-2xl px-4 py-4 transition hover:bg-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{incident.title}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-neutral-500">{incident.service}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 sm:justify-end">
          <StatusBadge status={incident.status} />
          <span className="whitespace-nowrap">{incident.createdBy}</span>
          <time dateTime={incident.createdAt} className="whitespace-nowrap">
            {formatTimestamp(incident.createdAt)}
          </time>
          <ArrowRight
            className="h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-signal"
            strokeWidth={2}
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  );
}

function IncidentsSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-soft" role="status" aria-label="Loading incidents">
      <div className="space-y-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="h-12 w-full rounded-xl bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}

interface IncidentsErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function IncidentsError({ error, onRetry }: IncidentsErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load incidents</p>
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

function EmptyIncidents() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl bg-white px-6 py-16 text-center shadow-soft">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-signal">
        <Siren className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink">No incidents match this filter.</p>
      <p className="max-w-sm text-xs text-neutral-500">
        Nothing needs attention right now. Start a new incident when something needs the agent&apos;s eyes.
      </p>
    </section>
  );
}

/**
 * Reads/writes the status filter through the URL (`?status=`) so a filtered
 * view is shareable and survives a reload — mirrored 1:1 in the query the
 * list requests from the backend.
 */
export function IncidentsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const statusFilter = searchParams.get("status") ?? "";

  const fetchIncidents = useCallback(
    (signal: AbortSignal): Promise<IncidentRow[]> =>
      listIncidents(statusFilter === "" ? undefined : statusFilter, undefined, signal),
    [statusFilter]
  );
  const { state, retry } = useAbortableResource(fetchIncidents, statusFilter);

  function handleStatusChange(value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `/app/incidents?${query}` : "/app/incidents");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="incident-status-filter" className="text-sm font-semibold text-ink">
            Status
          </label>
          <select
            id="incident-status-filter"
            value={statusFilter}
            onChange={(event) => handleStatusChange(event.target.value)}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/30"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Link
          href="/app/incidents/new"
          className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:translate-y-[-1px] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <PlusCircle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          New incident
        </Link>
      </div>

      {state.status === "loading" ? <IncidentsSkeleton /> : null}
      {state.status === "error" ? <IncidentsError error={state.error} onRetry={retry} /> : null}
      {state.status === "loaded" && state.data.length === 0 ? <EmptyIncidents /> : null}
      {state.status === "loaded" && state.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-neutral-100 rounded-3xl bg-white p-2 shadow-soft">
          {state.data.map((incident) => (
            <IncidentRowItem key={incident.id} incident={incident} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
