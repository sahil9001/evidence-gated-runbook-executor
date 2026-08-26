"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError, listAudit } from "../../../../../lib/api";
import type { AuditEntry } from "../../../../../lib/types";
import { activityLabel, formatTimestamp, humanizeErrorCode, toApiClientError } from "../shared";

type AuditState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: readonly AuditEntry[] };

interface AuditTabProps {
  readonly runId: string;
}

/**
 * Owns its own fetch rather than receiving entries as a prop from
 * `RunDetailClient`: only rendered while the Audit tab is active, so
 * mounting it is what triggers the fetch — which also means switching back
 * to this tab after a decision picks up the new `gate_approved` /
 * `gate_rejected` / `action_executed` entries for free.
 */
export function AuditTab({ runId }: AuditTabProps) {
  const [state, setState] = useState<AuditState>({ status: "loading" });

  const fetchAudit = useCallback((): Promise<void> => {
    return listAudit(runId)
      .then((data) => setState({ status: "loaded", data }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, [runId]);

  useEffect(() => {
    void fetchAudit();
  }, [fetchAudit]);

  if (state.status === "loading") {
    return (
      <p role="status" aria-label="Loading audit trail" className="text-sm font-medium text-neutral-500">
        Loading the audit trail…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl bg-white p-5">
        <p className="text-sm font-semibold text-rose-700">Could not load the audit trail</p>
        <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(state.error.code)}</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            void fetchAudit();
          }}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state.data.length === 0) {
    return (
      <p className="rounded-2xl bg-panel px-4 py-6 text-center text-sm font-medium text-neutral-500">
        No audit entries yet for this run.
      </p>
    );
  }

  return (
    <ol className="flex flex-col divide-y divide-neutral-100 rounded-2xl bg-white">
      {state.data.map((entry) => (
        <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{activityLabel(entry.kind)}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{entry.detail}</p>
          </div>
          <time dateTime={entry.at} className="shrink-0 whitespace-nowrap text-xs font-medium text-neutral-400">
            {formatTimestamp(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
