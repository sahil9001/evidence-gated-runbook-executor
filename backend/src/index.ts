import { Hono } from "hono";
import { mcpRoute } from "./routes/mcp";

export type Env = {
  DB: D1Database;
  /**
   * Comma-separated list of extra origins allowed to call /mcp, on top of
   * the built-in localhost/127.0.0.1 dev-origin allowance. See
   * `src/routes/mcp.ts`.
   */
  ALLOWED_MCP_ORIGINS?: string;
};

export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

app.route("/mcp", mcpRoute);

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
