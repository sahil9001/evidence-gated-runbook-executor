import type { LucideIcon } from "lucide-react";
import { Activity, FileText, GitPullRequest, Terminal } from "lucide-react";
import type { Tone } from "@/app/app/components/console/Indicators";
import type { Confidence, EvidenceSourceKind } from "@/lib/types";
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

/** Evidence sources always read in collection order, so a packet's shape is
 * comparable between two runs at a glance. */
export const SOURCE_ORDER: readonly EvidenceSourceKind[] = ["logs", "metrics", "deploys", "sandbox"];

export const SOURCE_LABELS: Readonly<Record<EvidenceSourceKind, string>> = {
  logs: "Logs",
  metrics: "Metrics",
  deploys: "Deploys",
  sandbox: "Sandbox"
};

export const SOURCE_ICONS: Readonly<Record<EvidenceSourceKind, LucideIcon>> = {
  logs: FileText,
  metrics: Activity,
  deploys: GitPullRequest,
  sandbox: Terminal
};

/**
 * Confidence is a three-level enum, not a number — these are presentation
 * lengths for the meter, chosen so "medium" reads as clearly short of full
 * rather than as a passing grade. Never treat them as a computed score.
 */
export const CONFIDENCE_PERCENT: Readonly<Record<Confidence, number>> = {
  high: 100,
  medium: 60,
  low: 28
};

export const CONFIDENCE_TONE: Readonly<Record<Confidence, Tone>> = {
  high: "good",
  medium: "warn",
  low: "bad"
};

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
