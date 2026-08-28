import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import { MAX_RUN_LIMIT } from "./runs";
import type { AuthedEnv } from "../auth/middleware";

/**
 * Every incident starts "open" — there is no other path to create one yet
 * (no bulk import, no external trigger), so there is nothing else a fresh
 * incident could sensibly be.
 */
const INITIAL_INCIDENT_STATUS = "open";

/**
 * `?limit=` is user-controlled input on a route with no other bound, so an
 * uncapped value is a denial-of-service knob (a client asking for every
 * incident ever created in one response). Same reasoning as `runs.ts`'s and
 * `audit.ts`'s caps.
 */
export const DEFAULT_INCIDENT_LIMIT = 25;
export const MAX_INCIDENT_LIMIT = 50;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INCIDENT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INCIDENT_LIMIT;
  return Math.min(parsed, MAX_INCIDENT_LIMIT);
}

// `createdBy` is deliberately absent from this schema — the route handler
// below takes it from `c.var.user.email` (the session `requireAuth`
// resolved), never from the request body. Same discipline as `by` on
// approvals and `createdBy` on runs: if the attribution isn't in the
// payload, it cannot be forged by whoever sends the request. Extra keys
// (including a body-supplied `createdBy`) are silently stripped by zod's
// default object parsing.
const createIncidentBodySchema = z.object({
  title: z.string().min(1),
  service: z.string().min(1),
  signals: z.array(z.string().min(1))
});

export const incidentRoutes = new Hono<AuthedEnv>();

incidentRoutes.get("/incidents", async (c) => {
  const status = c.req.query("status");
  const limit = parseLimit(c.req.query("limit"));
  const store = createD1Store(c.env.DB);
  const incidents = await store.listIncidents(status === undefined ? { limit } : { status, limit });
  return c.json({ ok: true, data: incidents });
});

incidentRoutes.post("/incidents", async (c) => {
  const parsed = await parseJsonBody(c, createIncidentBodySchema);
  if (!parsed.success) return parsed.response;
  const { title, service, signals } = parsed.data;

  const store = createD1Store(c.env.DB);
  const incident = {
    id: crypto.randomUUID(),
    title,
    service,
    signals,
    status: INITIAL_INCIDENT_STATUS,
    // From the session requireAuth resolved, never the request body — see
    // the schema comment above.
    createdBy: c.var.user.email,
    createdAt: new Date().toISOString()
  };

  await store.createIncident(incident);
  return c.json({ ok: true, data: incident });
});

incidentRoutes.get("/incidents/:id", async (c) => {
  const id = c.req.param("id");
  const store = createD1Store(c.env.DB);

  const incident = await store.getIncident(id);
  if (incident === null) {
    return c.json(apiError("not_found", `No incident found for id "${id}"`), 404);
  }

  // Bounded the same way the dedicated run listing is (MAX_RUN_LIMIT,
  // newest first) — an incident with a long-running history must not make
  // this response grow without bound. See Store#listRunsByIncident.
  const runs = await store.listRunsByIncident(id, MAX_RUN_LIMIT);
  return c.json({ ok: true, data: { incident, runs } });
});

export default incidentRoutes;
