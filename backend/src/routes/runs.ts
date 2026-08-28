import { Hono } from "hono";
import { apiError } from "../index";
import { createD1Store } from "../store/d1";
import { packetConfidence, missingSources } from "../domain/evidence";
import { RUNBOOKS } from "./run";
import type { RunRow } from "../domain/store";
import type { AuthedEnv } from "../auth/middleware";

/**
 * `?limit=` is user-controlled input with no other bound, so an uncapped
 * value is a denial-of-service knob (a client asking the API to materialize
 * every run ever created in one response).
 */
export const DEFAULT_RUN_LIMIT = 25;
export const MAX_RUN_LIMIT = 50;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RUN_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RUN_LIMIT;
  return Math.min(parsed, MAX_RUN_LIMIT);
}

const RUN_STATES: readonly RunRow["state"][] = ["collecting", "awaiting_approval", "approved", "rejected", "executed"];

function isRunState(value: string): value is RunRow["state"] {
  return (RUN_STATES as readonly string[]).includes(value);
}

export const runListRoutes = new Hono<AuthedEnv>();

runListRoutes.get("/runs", async (c) => {
  const stateParam = c.req.query("state");
  const filter: { limit: number; state?: RunRow["state"] } = { limit: parseLimit(c.req.query("limit")) };

  if (stateParam !== undefined) {
    if (!isRunState(stateParam)) {
      return c.json(apiError("validation_failed", `Unknown run state "${stateParam}"`), 400);
    }
    filter.state = stateParam;
  }

  const store = createD1Store(c.env.DB);
  const runs = await store.listRuns(filter);
  return c.json({ ok: true, data: runs });
});

runListRoutes.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const store = createD1Store(c.env.DB);

  const run = await store.getRun(id);
  if (run === null) {
    return c.json(apiError("not_found", `No run found for id "${id}"`), 404);
  }

  // Action and gate share the run's id (see run.ts). The packet is looked
  // up scoped to THIS run — never getPacketByIncident, which could return a
  // different run's (or a later, unrelated run's) evidence. See the doc
  // comment on Store#getPacketByRun.
  const [incident, packet, action, gate] = await Promise.all([
    store.getIncident(run.incidentId),
    store.getPacketByRun(run.id),
    store.getAction(id),
    store.getGate(id)
  ]);

  // A run is unusable without its incident — the response contract below
  // (and every existing caller of this route) treats `incident` as a
  // present object, never null, because the route needs the incident's
  // persisted service/signals to make sense of the run at all. There is no
  // delete-incident path in this codebase, so a missing incident here means
  // the run's data is corrupt, not a legitimate "resolved but gone" case —
  // 404 rather than silently shipping a payload whose shape contradicts the
  // contract every other reader of this endpoint assumes.
  if (incident === null) {
    return c.json(apiError("not_found", `Run "${id}" references a missing incident ("${run.incidentId}")`), 404);
  }

  const runbook = RUNBOOKS.find((rb) => rb.id === run.runbookId);
  const failures =
    packet !== null && runbook !== undefined
      ? missingSources(packet, runbook.allowedSources).map((source) => ({
          source,
          message: `No evidence collected from source "${source}"`
        }))
      : [];
  const confidence = packet === null ? null : packetConfidence(packet);

  return c.json({ ok: true, data: { run, incident, packet, action, gate, failures, confidence } });
});

export default runListRoutes;
