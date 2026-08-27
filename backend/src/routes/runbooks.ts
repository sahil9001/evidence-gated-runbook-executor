import { Hono } from "hono";
import { apiError } from "../index";
import { RUNBOOKS } from "./run";
import type { AuthedEnv } from "../auth/middleware";

export const runbookRoutes = new Hono<AuthedEnv>();

runbookRoutes.get("/runbooks", (c) => {
  return c.json({ ok: true, data: RUNBOOKS });
});

runbookRoutes.get("/runbooks/:id", (c) => {
  const id = c.req.param("id");
  const runbook = RUNBOOKS.find((rb) => rb.id === id);
  if (runbook === undefined) {
    return c.json(apiError("not_found", `No runbook found for id "${id}"`), 404);
  }
  return c.json({ ok: true, data: runbook });
});

export default runbookRoutes;
