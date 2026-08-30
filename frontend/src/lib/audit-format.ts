import type { LucideIcon } from "lucide-react";
import { CheckCircle2, CircleAlert, ListChecks, Play, ScrollText, XCircle } from "lucide-react";

/**
 * How audit entries read on screen, in one place.
 *
 * The Overview feed, the Audit screen, and the run-detail Audit tab all
 * render the same entries. This mapping used to be copied into each of them,
 * with a comment in every copy noting that it mirrored the other two -- so a
 * new audit kind meant three edits, and the copies had already drifted (the
 * Overview said "Evidence incomplete" where the Audit screen said "Evidence
 * collection had failures" for the same row).
 */

export interface ActivityPresentation {
  readonly label: string;
  readonly icon: LucideIcon;
  /** Tint for the icon chip. */
  readonly className: string;
}

const PRESENTATION: Readonly<Record<string, ActivityPresentation>> = {
  run_created: { label: "Run started", icon: Play, className: "border-sky-200 bg-sky-50 text-signal" },
  evidence_partial: {
    label: "Evidence incomplete",
    icon: CircleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-700"
  },
  gate_approved: {
    label: "Approval granted",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700"
  },
  gate_rejected: { label: "Approval rejected", icon: XCircle, className: "border-rose-200 bg-rose-50 text-rose-700" },
  action_executed: {
    label: "Action executed",
    icon: ListChecks,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
};

const FALLBACK: ActivityPresentation = {
  label: "",
  icon: ScrollText,
  className: "border-neutral-200 bg-neutral-50 text-neutral-500"
};

/** An on-call engineer should never have to know what `gate_approved` means. */
export function activityPresentation(kind: string): ActivityPresentation {
  const known = PRESENTATION[kind];
  if (known !== undefined) return known;
  // An unrecognised kind still reads as words rather than a raw enum.
  return { ...FALLBACK, label: kind.replace(/_/g, " ") };
}

export function activityLabel(kind: string): string {
  return activityPresentation(kind).label;
}

const UUID_PATTERN = /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Audit details embed full run/gate/incident UUIDs. Rendered verbatim they
 * push the readable half of every sentence off the row, so ids are shortened
 * to their first segment -- enough to correlate against the run page, which
 * is one click away, without turning the feed into a wall of hex.
 */
export function shortenIds(detail: string): string {
  return detail.replace(UUID_PATTERN, (_match, head: string) => `${head}…`);
}

/** The same truncation for an id that is already alone in its own element. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
