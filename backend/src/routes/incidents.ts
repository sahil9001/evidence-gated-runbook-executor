import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../index";
import { parseJsonBody } from "./http";
import { createD1Store } from "../store/d1";
import type { AuthedEnv } from "../auth/middleware";

/**
 * Every incident starts "open" — there is no other path to create one yet
 * (no bulk import, no external trigger), so there is nothing else a fresh
 * incident could sensibly be.
 */
const INITIAL_INCIDENT_STATUS = "open";

const createIncidentBodySchema = z.object({
  title: z.string().min(1),
  service: z.string().min(1),
  signals: z.array(z.string().min(1))
});

export const incidentRoutes = new Hono<AuthedEnv>();

incidentRoutes.get("/incidents", async (c) => {
  const status = c.req.query("status");
  const store = createD1Store(c.env.DB);
  const incidents = await store.listIncidents(status === undefined ? undefined : { status });
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
    // From the session, never the request body — same discipline as `by` on
    // approvals (B4) and `createdBy` on runs (B5).
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

  const runs = await store.listRunsByIncident(id);
  return c.json({ ok: true, data: { incident, runs } });
});

export default incidentRoutes;
