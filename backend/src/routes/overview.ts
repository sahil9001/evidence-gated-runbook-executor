import { Hono } from "hono";
import { createD1Store } from "../store/d1";
import type { AuthedEnv } from "../auth/middleware";

/** How many audit entries the Overview screen's recent-activity feed shows. */
const RECENT_ACTIVITY_LIMIT = 10;

export const overviewRoutes = new Hono<AuthedEnv>();

overviewRoutes.get("/overview", async (c) => {
  const store = createD1Store(c.env.DB);

  const [runs, incidents, recentActivity] = await Promise.all([
    store.listRuns(),
    store.listIncidents(),
    store.listRecentAudit(RECENT_ACTIVITY_LIMIT)
  ]);

  // The number that matters most on this screen: how many runs are stuck
  // waiting on a human right now.
  const awaitingApproval = runs.filter((run) => run.state === "awaiting_approval").length;

  // "Active" means not yet resolved — every incident's status starts "open"
  // (see routes/incidents.ts) and there is no other status this slice ever
  // assigns, but the check is written against "resolved" rather than
  // "open" so a future status (e.g. "investigating") still counts as active
  // by default.
  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved").length;

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const runsToday = runs.filter((run) => run.createdAt.startsWith(todayPrefix)).length;

  return c.json({
    ok: true,
    data: { awaitingApproval, activeIncidents, runsToday, recentActivity }
  });
});

export default overviewRoutes;
