import { Hono } from "hono";
import { cors } from "hono/cors";
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
  /**
   * Comma-separated list of extra origins allowed to make credentialed CORS
   * requests against the console's API surface, on top of the built-in
   * `http://localhost:3000` dev-origin allowance. See `consoleCors` below.
   */
  ALLOWED_FRONTEND_ORIGINS?: string;
};

export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

/** Origins always allowed to make credentialed CORS requests against the
 * console's API, regardless of `ALLOWED_FRONTEND_ORIGINS` — the frontend's
 * own documented local-dev address. Deliberately narrower than
 * `routes/mcp.ts`'s `DEV_ORIGIN_PATTERNS` (which allows any port): the
 * console frontend has one fixed dev port, so there is no reason to allow
 * more. */
const DEV_FRONTEND_ORIGINS: readonly string[] = ["http://localhost:3000"];

function parseConfiguredOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isFrontendOriginAllowed(origin: string, env: Env): boolean {
  if (DEV_FRONTEND_ORIGINS.includes(origin)) return true;
  return parseConfiguredOrigins(env.ALLOWED_FRONTEND_ORIGINS).includes(origin);
}

/**
 * CORS for the operator console's own browser-facing API surface —
 * deliberately mounted only on that surface below, never on `/mcp` (whose
 * only caller, TrueForge, is a server-side `fetch` that sends no Origin
 * header and validates Origin itself, see `routes/mcp.ts`) or `/health`.
 *
 * `credentials: true` is required because the session is an `HttpOnly`
 * cookie (`auth/middleware.ts`) — without it the browser neither stores nor
 * sends it, and login would appear to succeed while every following request
 * 401s. That in turn requires an explicit origin allow-list rather than
 * `*`: browsers reject a wildcard origin combined with credentials, and an
 * allow-list is what makes echoing the origin back safe to do at all.
 */
const consoleCors = cors({
  origin: (origin, c) => (isFrontendOriginAllowed(origin, c.env as Env) ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type"]
});

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

// /auth/* is how a caller establishes a session in the first place, so it
// stays public. /mcp is how TrueForge reaches this server and validates its
// own Origin (see routes/mcp.ts) — session auth does not apply there.
app.route("/mcp", mcpRoute);

// Mounted before every route below (including /auth/*) so a preflight is
// answered — and the real origin allow-list is enforced — before any
// session/auth check runs. Never mounted on /mcp or /health; see
// `consoleCors`'s doc comment above.
app.use("/auth/*", consoleCors);
app.use("/incidents/*", consoleCors);
app.use("/runs/*", consoleCors);
app.use("/approvals/*", consoleCors);
app.use("/audit/*", consoleCors);
app.use("/runbooks/*", consoleCors);
app.use("/overview/*", consoleCors);

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
