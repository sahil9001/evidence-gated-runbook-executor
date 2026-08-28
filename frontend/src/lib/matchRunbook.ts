import type { Runbook } from "./types";

/**
 * Mirrors backend/src/domain/runbook.ts `matchRunbook` exactly. The console
 * must show an operator the same answer the backend will compute the moment
 * they submit — showing a different runbook (or a match where the backend
 * would refuse) would mean the "scope" preview lies about what the agent
 * will actually be allowed to touch.
 *
 * Only runbooks whose `trigger.service` equals the incident's service are
 * candidates. Among those, the one sharing the most signals with the
 * incident wins. Returns `null` when there are no candidates, when the best
 * candidate shares zero signals, or when two or more candidates tie for the
 * highest overlap — an ambiguous match is never resolved by guessing.
 */
function countOverlap(runbookSignals: readonly string[], incidentSignals: readonly string[]): number {
  const incidentSet = new Set(incidentSignals);
  return runbookSignals.filter((signal) => incidentSet.has(signal)).length;
}

export function matchRunbook(
  runbooks: readonly Runbook[],
  incident: { service: string; signals: readonly string[] }
): Runbook | null {
  const candidates = runbooks.filter((runbook) => runbook.trigger.service === incident.service);
  if (candidates.length === 0) return null;

  const scored = candidates.map((runbook) => ({
    runbook,
    overlap: countOverlap(runbook.trigger.signals, incident.signals)
  }));

  const bestOverlap = scored.reduce((max, entry) => Math.max(max, entry.overlap), 0);
  if (bestOverlap === 0) return null;

  const winners = scored.filter((entry) => entry.overlap === bestOverlap);
  if (winners.length !== 1) return null;

  const winner = winners[0];
  return winner ? winner.runbook : null;
}
