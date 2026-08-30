import type { OverviewResponse } from "./types";

/**
 * The console's operational readiness score.
 *
 * Deliberately built only from figures the API can produce as counts, and
 * only from figures that mean something. Two rules govern what is allowed in
 * here:
 *
 * 1. No component may be structurally always-100%. "Every state-changing
 *    action passed an approval gate" is true by construction in this system,
 *    so it is reported as a verified invariant elsewhere -- folding it into
 *    an average would inflate every score by a constant and measure nothing.
 * 2. A component with no data yet is excluded from the average rather than
 *    counted as 0 or 100. A brand-new install has not earned a bad score,
 *    and has not earned a perfect one either.
 */

export type ReadinessBandId = "strong" | "fair" | "at-risk";

export interface ReadinessComponent {
  readonly id: "decision-coverage" | "evidence-completeness";
  readonly label: string;
  /** What this measures, in the operator's terms. */
  readonly description: string;
  /** 0-100, or null when nothing has happened yet to measure. */
  readonly percent: number | null;
  /** Relative weight in the overall score. */
  readonly weight: number;
  /** The raw counts behind `percent`, so the UI can show its working. */
  readonly detail: { readonly met: number; readonly total: number };
}

export interface ReadinessScore {
  /** 0-100, or null when no component has data yet. */
  readonly score: number | null;
  readonly band: ReadinessBandId;
  readonly components: readonly ReadinessComponent[];
  /** Runs that have reached a terminal decision. */
  readonly decided: number;
  /** Runs still holding a locked gate. */
  readonly awaiting: number;
  readonly totalRuns: number;
}

const BAND_THRESHOLDS = [
  { id: "strong" as const, min: 80 },
  { id: "fair" as const, min: 50 },
  { id: "at-risk" as const, min: 0 }
];

export function bandFor(score: number | null): ReadinessBandId {
  // No data reads as "fair": neither an achievement nor a problem.
  if (score === null) return "fair";
  return BAND_THRESHOLDS.find((band) => score >= band.min)?.id ?? "at-risk";
}

function percentOf(met: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((met / total) * 100);
}

export function computeReadiness(overview: OverviewResponse): ReadinessScore {
  const { runsByState, partialEvidenceRuns } = overview;

  const decided = runsByState.approved + runsByState.rejected + runsByState.executed;
  const awaiting = runsByState.awaiting_approval;
  const collecting = runsByState.collecting;
  const totalRuns = decided + awaiting + collecting;

  // Runs still collecting are excluded: they have not yet reached the point
  // where a decision is even possible, so counting them as undecided would
  // penalise the operator for the agent's in-flight work.
  const decidable = decided + awaiting;

  // `partialEvidenceRuns` counts runs missing at least one allowed source,
  // measured the same way the run detail screen measures it.
  const completeEvidence = Math.max(0, totalRuns - partialEvidenceRuns);

  const components: readonly ReadinessComponent[] = [
    {
      id: "decision-coverage",
      label: "Decision coverage",
      description: "Runs that reached a human decision instead of sitting on a locked gate.",
      percent: percentOf(decided, decidable),
      weight: 0.55,
      detail: { met: decided, total: decidable }
    },
    {
      id: "evidence-completeness",
      label: "Evidence completeness",
      description: "Runs whose packet collected every source their runbook allows.",
      percent: percentOf(completeEvidence, totalRuns),
      weight: 0.45,
      detail: { met: completeEvidence, total: totalRuns }
    }
  ];

  const scored = components.filter(
    (component): component is ReadinessComponent & { percent: number } => component.percent !== null
  );

  // Re-normalise across whichever components actually have data, so an
  // install with runs but no decisions yet is not silently marked down for
  // the missing half of the formula.
  const weightSum = scored.reduce((sum, component) => sum + component.weight, 0);
  const score =
    weightSum === 0
      ? null
      : Math.round(
          scored.reduce((sum, component) => sum + component.percent * component.weight, 0) / weightSum
        );

  return { score, band: bandFor(score), components, decided, awaiting, totalRuns };
}
