import { Hono, type MiddlewareHandler } from "hono";
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
  // DELETE is here for `DELETE /incidents/:id`. It stays behind the
  // content-type guard below like any other state-changing method — being
  // listed here only means the browser is allowed to send it, not that it
  // skips the CSRF barrier.
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type"]
});

/**
 * Methods that can change server state, and so must clear the guard below.
 * GET and HEAD are excluded because they carry no body to type; OPTIONS is
 * excluded because `consoleCors` answers preflights before this ever runs.
 */
const STATE_CHANGING_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Requires `Content-Type: application/json` on every state-changing request
 * to the console's API surface. This is the CSRF barrier the session cookie
 * leans on, and it only works if it is applied uniformly — hence a mounted
 * middleware rather than a per-route check that a new route can forget.
 *
 * The mechanism: a cross-site HTML form can only send `application/x-www-
 * form-urlencoded`, `multipart/form-data`, or `text/plain`, and a cross-site
 * `fetch` can only avoid a CORS preflight with those same three. Any of them
 * is rejected here, and anything else is preflighted — which `consoleCors`'s
 * allow-list then refuses. So a page on another site cannot reach a state
 * change at all, even though the browser would happily attach the session
 * cookie to a simple request.
 *
 * Checking the content type is NOT the same as parsing a JSON body, which is
 * why this cannot live in `parseJsonBody`:
 *   - `c.req.json()` parses on the body's contents alone and ignores the
 *     header entirely, so a `text/plain` body of valid JSON — which a plain
 *     HTML form can be coaxed into producing — sails straight through it.
 *   - `POST /auth/logout` revokes a session while reading no body at all, so
 *     it never calls `parseJsonBody` in the first place.
 * Both were reachable cross-site before this existed.
 *
 * Today `SameSite=Lax` on the session cookie (see `routes/auth.ts`) already
 * stops the cookie from riding along on a cross-site POST, so this is a
 * second, independent barrier rather than the only one. It is what would
 * have to carry the weight if that cookie were ever loosened to
 * `SameSite=None` to allow a cross-site console deployment.
 */
const requireJsonContentType: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthedVariables;
}> = async (c, next) => {
  if (!STATE_CHANGING_METHODS.includes(c.req.method)) return next();

  // Compare the media type only: `application/json; charset=utf-8` is a
  // perfectly ordinary thing for a client to send.
  const mediaType = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return c.json(
      apiError("unsupported_media_type", "Content-Type must be application/json"),
      415
    );
  }

  return next();
};

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

// /auth/* is how a caller establishes a session in the first place, so it
// stays public. /mcp is how TrueForge reaches this server and validates its
// own Origin (see routes/mcp.ts) — session auth does not apply there.
app.route("/mcp", mcpRoute);

// Both mounted before every route below, /auth/* included, so a preflight is
// answered — and the origin allow-list and the content-type guard both
// enforced — before any session/auth check runs. `consoleCors` comes first on
// each prefix so a rejected origin never reaches anything else; nothing is
// mounted on /mcp or /health. See each middleware's doc comment above.
app.use("/auth/*", consoleCors, requireJsonContentType);
app.use("/incidents/*", consoleCors, requireJsonContentType);
app.use("/runs/*", consoleCors, requireJsonContentType);
app.use("/approvals/*", consoleCors, requireJsonContentType);
app.use("/audit/*", consoleCors, requireJsonContentType);
app.use("/runbooks/*", consoleCors, requireJsonContentType);
app.use("/overview/*", consoleCors, requireJsonContentType);

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
