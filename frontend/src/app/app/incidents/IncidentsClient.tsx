"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Clock,
  Plus,
  Radio,
  Server,
  Siren,
  TriangleAlert,
  UserRound
} from "lucide-react";
import { listIncidents, type ApiClientError } from "@/lib/api";
import type { IncidentRow } from "@/lib/types";
import { useAbortableResource } from "@/hooks/useAbortableResource";
import { Band, EmptyState, Rows } from "@/app/app/components/console/Surface";
import { DeleteIncidentButton } from "@/app/app/components/console/DeleteIncidentButton";
import { Figure, Pill, type Tone } from "@/app/app/components/console/Indicators";

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
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" }
];

function statusTone(status: string): Tone {
  if (status === "open") return "info";
  if (status === "resolved") return "good";
  return "neutral";
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

/**
 * A segmented control rather than a `<select>`: three mutually exclusive
 * options that all fit on screen are worth one click, not two, and the
 * chosen one stays readable while the operator scans the list underneath.
 * Native radios inside a `<fieldset>` keep arrow-key navigation and the
 * group's accessible name without re-implementing either.
 */
interface StatusFilterProps {
  readonly onChange: (value: string) => void;
  readonly value: string;
}

function StatusFilter({ onChange, value }: StatusFilterProps) {
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <legend className="sr-only">Filter incidents by status</legend>
      <span
        aria-hidden="true"
        className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400"
      >
        Status
      </span>
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-sky-100 p-0.5">
        {STATUS_OPTIONS.map((option) => (
          <label key={option.value || "all"} className="cursor-pointer">
            <input
              type="radio"
              name="incident-status"
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

/** Counts describe what is on screen, not the whole table: the list is
 * already server-filtered by `?status=`, so a "total incidents" figure here
 * would contradict the rows underneath it. */
interface SummaryStripProps {
  readonly incidents: readonly IncidentRow[];
  readonly statusFilter: string;
}

function SummaryStrip({ incidents, statusFilter }: SummaryStripProps) {
  const open = incidents.filter((incident) => incident.status === "open").length;
  const services = new Set(incidents.map((incident) => incident.service)).size;
  const filterLabel = STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label;

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 sm:gap-x-10">
      <Figure
        icon={Siren}
        label="In view"
        value={incidents.length}
        caption={statusFilter === "" ? "Across every status" : `Filtered to ${filterLabel}`}
      />
      <Figure icon={Radio} label="Open" tone="info" value={open} caption="Still unresolved" />
      <Figure icon={Server} label="Services" value={services} caption="Distinct services affected" />
    </div>
  );
}

interface IncidentRowItemProps {
  readonly incident: IncidentRow;
  readonly onDeleted: () => void;
}

/**
 * The delete control is a SIBLING of the row's link, not a child of it: a
 * `<button>` inside an `<a>` is invalid HTML, and the click would navigate
 * to the incident as well as arming the delete. That is why the row is a
 * flex container with the link taking the remaining width rather than the
 * link being the whole row.
 */
function IncidentRowItem({ incident, onDeleted }: IncidentRowItemProps) {
  return (
    <li className="flex items-center gap-1 pr-2">
      <Link
        href={`/app/incidents/${encodeURIComponent(incident.id)}`}
        className="group flex min-w-0 flex-1 flex-col gap-3 px-2 py-5 transition-colors hover:bg-sky-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal sm:flex-row sm:items-center sm:gap-8"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-6 text-ink">{incident.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-500">
            <Server className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden="true" />
            <span className="truncate">{incident.service}</span>
          </p>
          {incident.signals.length > 0 ? (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {incident.signals.map((signal) => (
                <span
                  key={signal}
                  className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700"
                >
                  {signal}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col gap-1 text-xs text-neutral-500 sm:w-52 sm:text-right">
          <span className="inline-flex items-center gap-1.5 truncate sm:justify-end">
            <UserRound className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
            {incident.createdBy}
          </span>
          <time
            dateTime={incident.createdAt}
            className="inline-flex items-center gap-1.5 tabular-nums sm:justify-end"
          >
            <Clock className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} aria-hidden="true" />
            {formatTimestamp(incident.createdAt)}
          </time>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Pill tone={statusTone(incident.status)}>{incident.status}</Pill>
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-neutral-400 transition-colors group-hover:text-signal">
            Open
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </span>
        </div>
      </Link>

      <DeleteIncidentButton
        incidentId={incident.id}
        incidentTitle={incident.title}
        onDeleted={onDeleted}
      />
    </li>
  );
}

/** Flat by construction: the skeleton has to promise the same page the data
 * arrives into, and that page has no cards to stand in for. */
function IncidentsSkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading incidents">
      <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 sm:gap-x-10">
        {[0, 1, 2].map((figure) => (
          <div key={figure}>
            <div className="h-2.5 w-20 rounded-full bg-sky-100" />
            <div className="mt-3 h-7 w-12 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
      <div className="mt-8 divide-y divide-sky-100 border-y border-sky-100">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-8 px-2 py-5">
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-2/5 rounded bg-neutral-100" />
              <div className="mt-2.5 h-2.5 w-24 rounded-full bg-sky-50" />
            </div>
            <div className="h-2.5 w-28 rounded-full bg-neutral-100" />
            <div className="h-5 w-16 rounded bg-sky-50" />
          </div>
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
    <div className="flex items-start gap-3 border-y border-sky-100 px-2 py-12">
      <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" strokeWidth={2} aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-ink">Could not load incidents</p>
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
    <>
      <Band className="flex flex-wrap items-center justify-between gap-4 py-5 sm:py-6">
        <StatusFilter value={statusFilter} onChange={handleStatusChange} />
        <Link
          href="/app/incidents/new"
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
          New incident
        </Link>
      </Band>

      <Band divided={false} className="pt-2">
        {state.status === "loading" ? <IncidentsSkeleton /> : null}
        {state.status === "error" ? <IncidentsError error={state.error} onRetry={retry} /> : null}
        {state.status === "loaded" && state.data.length === 0 ? (
          <EmptyState
            icon={Siren}
            title="No incidents match this filter."
            body="Nothing needs attention right now. Start a new incident when something needs the agent's eyes."
          />
        ) : null}
        {state.status === "loaded" && state.data.length > 0 ? (
          <>
            <SummaryStrip incidents={state.data} statusFilter={statusFilter} />
            <Rows className="mt-8">
              {state.data.map((incident) => (
                // `retry` refetches the list, which is what makes a deleted
                // row disappear. Refetching rather than dropping the row
                // locally keeps the summary figures above (in view, open,
                // services) consistent with the rows underneath, and picks
                // up anything else that changed meanwhile.
                <IncidentRowItem key={incident.id} incident={incident} onDeleted={retry} />
              ))}
            </Rows>
          </>
        ) : null}
      </Band>
    </>
  );
}
