"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Lock, ScrollText, X } from "lucide-react";
import { ApiClientError, listAuditLog } from "../../../lib/api";
import type { AuditEntry } from "../../../lib/types";

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
    minute: "2-digit",
    second: "2-digit"
  });
}

/** A human on-call engineer should never have to know what `gate_approved`
 * means — mirrors OverviewClient's / the run-detail Audit tab's mapping. */
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

const AUDIT_LIMIT = 100;

/**
 * `GET /audit` orders differently depending on which path serves it:
 * `?runId=` scopes to `listAudit`, which returns oldest-first (right for
 * reading one run's story top to bottom, as the run-detail Audit tab does);
 * with no `runId`, `listRecentAudit` already returns newest-first. This
 * screen's contract is "newest first" unconditionally regardless of which
 * of those two the request happened to hit, so it re-sorts client-side
 * instead of trusting either backend ordering.
 */
function sortNewestFirst(entries: readonly AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });
}

type AuditState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: readonly AuditEntry[] };

const KIND_DOT_COLORS: Readonly<Record<string, string>> = {
  run_created: "bg-sky-500",
  evidence_partial: "bg-amber-500",
  gate_approved: "bg-emerald-500",
  gate_rejected: "bg-rose-500",
  action_executed: "bg-ink"
};

function dotColorForKind(kind: string): string {
  return KIND_DOT_COLORS[kind] ?? "bg-neutral-400";
}

interface AuditEntryRowProps {
  readonly entry: AuditEntry;
  readonly isLast: boolean;
}

/** A vertical timeline, not a table — this is the one screen where order
 * and lineage matter more than columns: each entry is one link in an
 * append-only chain, so the connecting line is the point. */
function AuditEntryRow({ entry, isLast }: AuditEntryRowProps) {
  return (
    <li className="relative flex gap-4 pb-6">
      {isLast ? null : <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-neutral-200" />}
      <span className={`relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full ${dotColorForKind(entry.kind)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 rounded-2xl bg-white p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{activityLabel(entry.kind)}</p>
          <time dateTime={entry.at} className="shrink-0 whitespace-nowrap text-xs font-medium text-neutral-400">
            {formatTimestamp(entry.at)}
          </time>
        </div>
        <p className="mt-1 text-sm text-neutral-600">{entry.detail}</p>
        <Link
          href={`/app/runs/${encodeURIComponent(entry.runId)}`}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-signal transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          run {entry.runId}
        </Link>
      </div>
    </li>
  );
}

function AuditSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading audit trail">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-4">
          <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full bg-neutral-200" />
          <div className="h-20 flex-1 rounded-2xl bg-white shadow-soft" />
        </div>
      ))}
    </div>
  );
}

interface AuditErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function AuditError({ error, onRetry }: AuditErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load the audit trail</p>
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

interface EmptyAuditProps {
  readonly isFiltered: boolean;
}

function EmptyAudit({ isFiltered }: EmptyAuditProps) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl bg-white px-6 py-16 text-center shadow-soft">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-signal">
        <ScrollText className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink">No audit entries yet.</p>
      <p className="max-w-sm text-xs text-neutral-500">
        {isFiltered
          ? "Nothing has been recorded for this run yet."
          : "Nothing has happened yet — every gate decision will be recorded here as it occurs."}
      </p>
    </section>
  );
}

/** Persistent regardless of loading/error/empty state — append-only is a
 * property of the log itself, not something conditional on what's on
 * screen right now. */
function AppendOnlyNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-panel px-4 py-3 text-xs font-medium text-neutral-600">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" strokeWidth={2.2} aria-hidden="true" />
      <p>
        <span className="font-semibold text-ink">Append-only.</span> This is a product guarantee, not a UI
        convenience — nothing here can be edited or deleted. Every gate decision is permanent history.
      </p>
    </div>
  );
}

/**
 * Reads/writes the `?runId=` filter through the URL so a filtered view is
 * shareable — free text, not a dropdown, since run ids aren't a small enum
 * (unlike History's `?state=`).
 */
export function AuditClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runIdFilter = searchParams.get("runId") ?? "";
  const [runIdInput, setRunIdInput] = useState(runIdFilter);
  // Tracks the last URL-derived value the input was synced to, so the
  // render-time check below can tell "the URL filter changed underneath us"
  // (browser back/forward, or a link into this screen with `?runId=` set)
  // apart from "the operator is still typing" — without an effect. Adjusting
  // state during render like this is React's documented alternative to a
  // `useEffect` that would otherwise just mirror a prop into state.
  const [syncedRunIdFilter, setSyncedRunIdFilter] = useState(runIdFilter);
  if (runIdFilter !== syncedRunIdFilter) {
    setSyncedRunIdFilter(runIdFilter);
    setRunIdInput(runIdFilter);
  }

  const [state, setState] = useState<AuditState>({ status: "loading" });

  const fetchAudit = useCallback((): Promise<void> => {
    return listAuditLog({ runId: runIdFilter === "" ? undefined : runIdFilter, limit: AUDIT_LIMIT })
      .then((data) => setState({ status: "loaded", data: sortNewestFirst(data) }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, [runIdFilter]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchAudit();
  }

  function applyFilter(value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = value.trim();
    if (trimmed === "") {
      params.delete("runId");
    } else {
      params.set("runId", trimmed);
    }
    const query = params.toString();
    router.push(query.length > 0 ? `/app/audit?${query}` : "/app/audit");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    applyFilter(runIdInput);
  }

  function handleClear(): void {
    setRunIdInput("");
    applyFilter("");
  }

  return (
    <div className="flex flex-col gap-4">
      <AppendOnlyNotice />

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="audit-run-filter" className="text-sm font-semibold text-ink">
            Run id
          </label>
          <input
            id="audit-run-filter"
            type="text"
            value={runIdInput}
            onChange={(event) => setRunIdInput(event.target.value)}
            placeholder="Filter by run id"
            className="w-56 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/30"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          <Filter className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
          Filter
        </button>
        {runIdFilter !== "" ? (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-neutral-500 transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            Clear
          </button>
        ) : null}
      </form>

      {state.status === "loading" ? <AuditSkeleton /> : null}
      {state.status === "error" ? <AuditError error={state.error} onRetry={handleRetry} /> : null}
      {state.status === "loaded" && state.data.length === 0 ? <EmptyAudit isFiltered={runIdFilter !== ""} /> : null}
      {state.status === "loaded" && state.data.length > 0 ? (
        <ol className="flex flex-col">
          {state.data.map((entry, index) => (
            <AuditEntryRow key={entry.id} entry={entry} isLast={index === state.data.length - 1} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
