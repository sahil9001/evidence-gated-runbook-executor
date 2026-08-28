import { ApiClientError } from "../../../../lib/api";

/**
 * Small pieces shared by the run detail screen's tabs. Each top-level screen
 * elsewhere in this console (Overview, Incidents, ...) duplicates its own
 * copy of these helpers; here they're centralised once because five files
 * under this one feature folder would otherwise need the identical copy.
 */

export const TAB_IDS = ["evidence", "diagnostics", "approval", "audit"] as const;
export type TabId = (typeof TAB_IDS)[number];

export function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again.",
  insufficient_evidence: "This run has no evidence yet — approval is blocked until at least one card is collected.",
  gate_already_decided: "This gate was already decided — someone else beat you to it.",
  gate_expired: "This approval gate expired before a decision was made.",
  validation_failed: "That request wasn't valid — check the reason and try again."
};

export function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** A human on-call engineer should never have to know what `gate_approved`
 * means — mirrors OverviewClient's ACTIVITY_LABELS mapping. */
const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  run_created: "Run started",
  evidence_partial: "Evidence collection had failures",
  gate_approved: "Approval granted",
  action_executed: "Action executed",
  gate_rejected: "Approval rejected"
};

export function activityLabel(kind: string): string {
  return ACTIVITY_LABELS[kind] ?? kind.replace(/_/g, " ");
}
