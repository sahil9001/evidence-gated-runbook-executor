"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Lock, RotateCcw, ScrollText, X } from "lucide-react";
import { EmptyState } from "../components/console/Surface";
import { activityLabel, activityPresentation, shortenIds, shortId } from "../../../lib/audit-format";
import { listAuditLog, type ApiClientError } from "../../../lib/api";
import type { AuditEntry } from "../../../lib/types";
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


interface AuditEntryRowProps {
  readonly entry: AuditEntry;
  readonly isLast: boolean;
}

/** A vertical timeline, not a table — this is the one screen where order
 * and lineage matter more than columns: each entry is one link in an
 * append-only chain, so the connecting line is the point. */
function AuditEntryRow({ entry, isLast }: AuditEntryRowProps) {
  const mark = activityPresentation(entry.kind);
  const Icon = mark.icon;

  return (
    <li className="relative flex gap-4 pb-7">
      {/* The connecting line is the point of this screen: each entry is one
          link in an append-only chain, so lineage reads vertically. */}
      {isLast ? null : (
        <span aria-hidden="true" className="absolute left-[15px] top-8 h-full w-px bg-sky-100" />
      )}
      <span
        aria-hidden="true"
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${mark.className}`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">{activityLabel(entry.kind)}</p>
          <time
            dateTime={entry.at}
            className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-neutral-400"
          >
            {formatTimestamp(entry.at)}
          </time>
        </div>
        <p className="mt-1 text-sm leading-6 text-neutral-600">{shortenIds(entry.detail)}</p>
        <Link
          href={`/app/runs/${encodeURIComponent(entry.runId)}`}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-signal transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
        >
          run <span className="font-mono">{shortId(entry.runId)}</span>
        </Link>
      </div>
    </li>
  );
}

function AuditSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading audit trail">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex animate-pulse gap-4">
          <span className="h-8 w-8 shrink-0 rounded-full bg-sky-50" />
          <div className="flex-1 space-y-2 pt-2">
            <div className="h-2.5 w-40 rounded-full bg-sky-50" />
            <div className="h-2.5 w-full rounded-full bg-sky-50" />
          </div>
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
    <div className="border-y border-rose-100 bg-rose-50/40 px-6 py-10">
      <p className="text-sm font-semibold text-rose-700">Could not load the audit trail</p>
      <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
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
    <EmptyState
      icon={ScrollText}
      title="No audit entries yet."
      body={
        isFiltered
          ? "Nothing has been recorded for this run yet."
          : "Nothing has happened yet — every gate decision will be recorded here as it occurs."
      }
    />
  );
}

/** Persistent regardless of loading/error/empty state — append-only is a
 * property of the log itself, not something conditional on what's on
 * screen right now. */
function AppendOnlyNotice() {
  return (
    <div className="flex items-start gap-2.5 border-y border-sky-100 bg-sky-50/60 px-4 py-3 text-xs font-medium text-neutral-600">
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

  const fetchAudit = useCallback(
    (signal: AbortSignal): Promise<readonly AuditEntry[]> =>
      listAuditLog({ runId: runIdFilter === "" ? undefined : runIdFilter, limit: AUDIT_LIMIT }, signal).then(
        sortNewestFirst
      ),
    [runIdFilter]
  );
  const { state, retry } = useAbortableResource(fetchAudit, runIdFilter);

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
    <div className="flex flex-col gap-7">
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
            className="w-56 rounded-lg border border-sky-100 bg-white px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-signal/25"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
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
      {state.status === "error" ? <AuditError error={state.error} onRetry={retry} /> : null}
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
