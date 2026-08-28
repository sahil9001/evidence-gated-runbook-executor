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

  const [awaitingApproval, activeIncidents, runsToday, recentActivity] = await Promise.all([
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
    store.listRecentAudit(RECENT_ACTIVITY_LIMIT)
  ]);

  return c.json({
    ok: true,
    data: { awaitingApproval, activeIncidents, runsToday, recentActivity }
  });
});

export default overviewRoutes;
