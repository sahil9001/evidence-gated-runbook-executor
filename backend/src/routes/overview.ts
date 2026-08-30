import { Hono } from "hono";
import { createD1Store } from "../store/d1";
import type { AuthedEnv } from "../auth/middleware";

/** How many audit entries the Overview screen's recent-activity feed shows. */
const RECENT_ACTIVITY_LIMIT = 10;

export const overviewRoutes = new Hono<AuthedEnv>();

overviewRoutes.get("/overview", async (c) => {
  const store = createD1Store(c.env.DB);

  // Every count below runs as `SELECT COUNT(*) ... WHERE` in the store —
  // never `(await store.listRuns()).filter(...).length` — so this route's
  // cost stays flat as total run/incident history grows, instead of
  // shipping every row ever created into the Worker on every request an
  // authenticated user can trigger. See the doc comments on
  // Store#countRunsByState / #countRunsSince / #countIncidentsExcludingStatus.
  const startOfTodayIso = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").toISOString();

  const [awaitingApproval, activeIncidents, runsToday, recentActivity, runsByState, evidenceMeasurement] =
    await Promise.all([
    // The number that matters most on this screen: how many runs are stuck
    // waiting on a human right now.
    store.countRunsByState("awaiting_approval"),
    // "Active" means not yet resolved — every incident's status starts
    // "open" (see routes/incidents.ts) and there is no other status this
    // slice ever assigns, but the check is written against "resolved"
    // rather than "open" so a future status (e.g. "investigating") still
    // counts as active by default.
    store.countIncidentsExcludingStatus("resolved"),
    store.countRunsSince(startOfTodayIso),
    store.listRecentAudit(RECENT_ACTIVITY_LIMIT),
    // Backs the Overview readiness score. One GROUP BY rather than five
    // separate counts, for the same reason the counts above are counts.
    store.countRunsGroupedByState(),
    // Read off `runs.evidence_gap_count`, not the audit log. The log records
    // events; it is not a projection to aggregate, and runs created before
    // that entry covered clean zero-card collection have a real gap with no
    // row to find. Counting those as complete inflated the score, so runs
    // predating the measurement are reported as unmeasured instead.
    store.countRunsByEvidenceMeasurement()
  ]);

  return c.json({
    ok: true,
    data: {
      awaitingApproval,
      activeIncidents,
      runsToday,
      recentActivity,
      runsByState,
      // Runs whose gap was actually measured, and how many of those have one.
      // The client's score uses `evidenceMeasuredRuns` as its denominator so
      // unmeasured history is excluded rather than assumed complete.
      evidenceMeasuredRuns: evidenceMeasurement.measured,
      partialEvidenceRuns: evidenceMeasurement.withGaps
    }
  });
});

export default overviewRoutes;
