import { Hono } from "hono";

export type Env = {
  DB: D1Database;
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

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
