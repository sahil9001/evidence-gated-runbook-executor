"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { ApiClientError, deleteIncident } from "../../../../lib/api";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Could not delete this incident (${code}).`;
}

type DeleteState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "deleting" }
  | { status: "error"; message: string };

interface DeleteIncidentButtonProps {
  readonly incidentId: string;
  /** Used for the accessible name, so one row's control is distinguishable
   * from the next when the list renders many of them. */
  readonly incidentTitle: string;
  /** Called once the incident is gone — including when it was already gone.
   * The caller decides what that means: refresh a list, or navigate away. */
  readonly onDeleted: () => void;
}

/**
 * A two-step delete: the resting button arms the control, and a separate
 * Confirm commits it. Deliberately not a modal — `components/ui` has no
 * dialog primitive, and adding one would pull in a Radix dependency for a
 * single confirmation. Two clicks on adjacent controls is the same barrier
 * without it.
 *
 * The armed state is local rather than lifted, so several rows can each hold
 * their own without the list needing to track which one is open. Arming one
 * does not disarm another, which is fine here: nothing is destroyed until
 * Confirm, and each control names its own incident.
 */
export function DeleteIncidentButton({ incidentId, incidentTitle, onDeleted }: DeleteIncidentButtonProps) {
  const [state, setState] = useState<DeleteState>({ status: "idle" });

  async function handleConfirm(): Promise<void> {
    setState({ status: "deleting" });
    try {
      await deleteIncident(incidentId);
      onDeleted();
    } catch (error: unknown) {
      // `not_found` means someone else removed it first, or this list is
      // stale. Either way the incident is gone, which is what the click
      // asked for — reporting an error would be describing a failure that
      // did not happen.
      if (error instanceof ApiClientError && error.code === "not_found") {
        onDeleted();
        return;
      }
      const code = error instanceof ApiClientError ? error.code : "unknown_error";
      setState({ status: "error", message: humanizeErrorCode(code) });
    }
  }

  if (state.status === "idle") {
    return (
      <button
        type="button"
        onClick={() => setState({ status: "confirming" })}
        aria-label={`Delete ${incidentTitle}`}
        // neutral-500 rather than the neutral-400 used for decorative icons
        // nearby: this is real text on white, and 400 lands around 2.6:1,
        // under the 4.5:1 AA floor. Rose only appears on hover/focus, so the
        // destructive colour is spent on the armed state rather than on a
        // control that has not been touched yet.
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-rose-50 hover:text-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
      >
        <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        <span className="sr-only sm:not-sr-only">Delete</span>
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={state.status === "deleting"}
          className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {state.status === "deleting" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} aria-hidden="true" />
              Deleting
            </>
          ) : (
            "Confirm delete"
          )}
        </button>
        {state.status === "deleting" ? null : (
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            Cancel
          </button>
        )}
      </div>
      {state.status === "error" ? (
        <p role="alert" className="max-w-[16rem] text-right text-xs leading-5 text-rose-700">
          {state.message}
        </p>
      ) : (
        <p className="text-[11px] font-medium text-neutral-500">Removes its runs and evidence too</p>
      )}
    </div>
  );
}
