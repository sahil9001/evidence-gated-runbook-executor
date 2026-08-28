import { Hono } from "hono";
import { createD1Store } from "../store/d1";
import type { AuthedEnv } from "../auth/middleware";

/**
 * `?limit=` is user-controlled input on a route with no other bound, so an
 * uncapped value is a denial-of-service knob (a client asking for every
 * audit entry ever written). Same reasoning as `runs.ts`'s run-list cap.
 */
export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_AUDIT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AUDIT_LIMIT;
  return Math.min(parsed, MAX_AUDIT_LIMIT);
}

export const auditRoutes = new Hono<AuthedEnv>();

auditRoutes.get("/audit", async (c) => {
  const store = createD1Store(c.env.DB);
  const runId = c.req.query("runId");
  const limit = parseLimit(c.req.query("limit"));

  // `?limit=` is honoured on BOTH paths — a client asking for
  // `?runId=...&limit=1` must not fall through to the unbounded
  // `listAudit(runId)` call this route advertises a cap for.
  const entries = runId === undefined ? await store.listRecentAudit(limit) : await store.listAudit(runId, limit);

  return c.json({ ok: true, data: entries });
});

export default auditRoutes;
