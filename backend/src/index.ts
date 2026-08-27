import { Hono } from "hono";
import { mcpRoute } from "./routes/mcp";
import { authRoutes } from "./routes/auth";
import { runRoutes } from "./routes/run";
import { packetRoutes } from "./routes/packet";
import { approvalRoutes } from "./routes/approvals";
import { incidentRoutes } from "./routes/incidents";
import { runListRoutes } from "./routes/runs";
import { runbookRoutes } from "./routes/runbooks";
import { auditRoutes } from "./routes/audit";
import { overviewRoutes } from "./routes/overview";
import { requireAuth, type AuthedVariables } from "./auth/middleware";

export type Env = {
  DB: D1Database;
  /**
   * Comma-separated list of extra origins allowed to call /mcp, on top of
   * the built-in localhost/127.0.0.1 dev-origin allowance. See
   * `src/routes/mcp.ts`.
   */
  ALLOWED_MCP_ORIGINS?: string;
  /** Idle-timeout for an MCP session, in milliseconds. See `src/routes/mcp.ts`. */
  MCP_SESSION_IDLE_TTL_MS?: string;
  /** Hard cap on concurrently held MCP sessions. See `src/routes/mcp.ts`. */
  MCP_MAX_SESSIONS?: string;
};

export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

// /auth/* is how a caller establishes a session in the first place, so it
// stays public. /mcp is how TrueForge reaches this server and validates its
// own Origin (see routes/mcp.ts) — session auth does not apply there.
app.route("/mcp", mcpRoute);
app.route("/", authRoutes);

// Every other API surface requires a resolved session. Mounted as path-
// prefixed middleware (not a route) so it applies uniformly as each of
// these surfaces grows its own handlers, without this file needing to
// change again per-route.
app.use("/incidents/*", requireAuth);
app.use("/runs/*", requireAuth);
app.use("/approvals/*", requireAuth);
app.use("/audit/*", requireAuth);
app.use("/runbooks/*", requireAuth);
app.use("/overview/*", requireAuth);

app.route("/", runRoutes);
app.route("/", packetRoutes);
app.route("/", approvalRoutes);
app.route("/", incidentRoutes);
app.route("/", runListRoutes);
app.route("/", runbookRoutes);
app.route("/", auditRoutes);
app.route("/", overviewRoutes);

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
