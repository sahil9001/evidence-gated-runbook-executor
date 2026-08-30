import { describe, expect, it } from "vitest";
import { bandFor, computeReadiness } from "./readiness";
import type { OverviewResponse, RunRow } from "./types";

const EMPTY_STATES: Record<RunRow["state"], number> = {
  collecting: 0,
  awaiting_approval: 0,
  approved: 0,
  rejected: 0,
  executed: 0
};

function overview(
  states: Partial<Record<RunRow["state"], number>>,
  partialEvidenceRuns = 0,
  /** Defaults to "every run was measured", which most cases want. */
  evidenceMeasuredRuns?: number
): OverviewResponse {
  const runsByState = { ...EMPTY_STATES, ...states };
  const totalRuns = Object.values(runsByState).reduce((sum, n) => sum + n, 0);

  return {
    awaitingApproval: states.awaiting_approval ?? 0,
    activeIncidents: 0,
    runsToday: 0,
    recentActivity: [],
    runsByState,
    evidenceMeasuredRuns: evidenceMeasuredRuns ?? totalRuns,
    partialEvidenceRuns
  };
}

describe("computeReadiness", () => {
  it("returns a null score on an install where nothing has run yet", () => {
    const result = computeReadiness(overview({}));

    // Not 0 and not 100: a brand-new install has earned neither.
    expect(result.score).toBeNull();
    expect(result.totalRuns).toBe(0);
    expect(result.components.every((component) => component.percent === null)).toBe(true);
  });

  it("scores a fully decided, fully evidenced history at 100", () => {
    const result = computeReadiness(overview({ executed: 3, rejected: 1 }, 0));

    expect(result.score).toBe(100);
    expect(result.band).toBe("strong");
    expect(result.decided).toBe(4);
    expect(result.awaiting).toBe(0);
  });

  it("counts approved, rejected, and executed runs alike as decided", () => {
    const result = computeReadiness(overview({ approved: 1, rejected: 1, executed: 1 }, 0));

    expect(result.decided).toBe(3);
    expect(result.components[0].detail).toEqual({ met: 3, total: 3 });
  });

  it("marks down a backlog of runs sitting on locked gates", () => {
    // 5 decided of 10 decidable -> 50% coverage; evidence is perfect.
    const result = computeReadiness(overview({ executed: 5, awaiting_approval: 5 }, 0));

    expect(result.components[0].percent).toBe(50);
    expect(result.components[1].percent).toBe(100);
    // 0.55 * 50 + 0.45 * 100 = 72.5 -> 73
    expect(result.score).toBe(73);
  });

  it("marks down runs whose packet is missing a source the runbook allows", () => {
    const result = computeReadiness(overview({ executed: 4 }, 4));

    expect(result.components[1].percent).toBe(0);
    expect(result.components[1].detail).toEqual({ met: 0, total: 4 });
    // Decision coverage is perfect, evidence is absent: 0.55 * 100 = 55.
    expect(result.score).toBe(55);
  });

  it("excludes runs still collecting from decision coverage", () => {
    // The agent is mid-flight on 3 runs. Penalising the operator for work
    // that has not yet reached a gate would be measuring the wrong thing.
    const withCollecting = computeReadiness(overview({ executed: 2, collecting: 3 }, 0));
    const withoutCollecting = computeReadiness(overview({ executed: 2 }, 0));

    expect(withCollecting.components[0].percent).toBe(100);
    expect(withCollecting.components[0].percent).toBe(withoutCollecting.components[0].percent);
  });

  it("still counts collecting runs toward evidence completeness totals", () => {
    // A collecting run has a packet being built; it is part of the corpus.
    const result = computeReadiness(overview({ collecting: 2, executed: 2 }, 2));

    expect(result.components[1].detail).toEqual({ met: 2, total: 4 });
    expect(result.components[1].percent).toBe(50);
  });

  it("re-normalises when only one component has data", () => {
    // Runs exist (so evidence is measurable) but none are decidable yet.
    const result = computeReadiness(overview({ collecting: 4 }, 0));

    expect(result.components[0].percent).toBeNull();
    expect(result.components[1].percent).toBe(100);
    // The single component with data carries the whole score rather than
    // being averaged against a missing half.
    expect(result.score).toBe(100);
  });

  it("excludes runs that predate the evidence measurement from that term", () => {
    // Four runs, but only two were measured and one of those has a gap.
    // Scoring the two unmeasured runs as complete would report 75% for an
    // install whose measurable evidence is actually 50%.
    const result = computeReadiness(overview({ executed: 4 }, 1, 2));

    expect(result.components[1].detail).toEqual({ met: 1, total: 2 });
    expect(result.components[1].percent).toBe(50);
  });

  it("reports evidence as unmeasurable when no run carries a measurement", () => {
    // A pre-existing install on the first deploy after the column lands.
    const result = computeReadiness(overview({ executed: 5 }, 0, 0));

    expect(result.components[1].percent).toBeNull();
    // Decision coverage still has data, so it carries the whole score rather
    // than being averaged against a term that cannot be computed.
    expect(result.score).toBe(100);
  });

  it("never reports negative completeness when the partial count exceeds known runs", () => {
    // Defensive: the two figures come from separate queries and could race.
    const result = computeReadiness(overview({ executed: 1 }, 99));

    expect(result.components[1].percent).toBe(0);
    expect(result.components[1].detail.met).toBe(0);
  });
});

describe("bandFor", () => {
  it("bands scores by operational meaning", () => {
    expect(bandFor(100)).toBe("strong");
    expect(bandFor(80)).toBe("strong");
    expect(bandFor(79)).toBe("fair");
    expect(bandFor(50)).toBe("fair");
    expect(bandFor(49)).toBe("at-risk");
    expect(bandFor(0)).toBe("at-risk");
  });

  it("treats an unmeasurable score as neither good nor bad", () => {
    expect(bandFor(null)).toBe("fair");
  });
});
