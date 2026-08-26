import { Hono } from "hono";
import { cors } from "hono/cors";
import runRoutes from "./routes/run";
import packetRoutes from "./routes/packet";
import approvalRoutes from "./routes/approvals";
import authRoutes from "./routes/auth";
import { requireAuth } from "./auth/middleware";

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

// The dashboard is served from a separate Worker (runproof-frontend), so it
// needs an explicit CORS allowance rather than relying on same-origin.
const ALLOWED_ORIGINS = ["https://runproof-frontend.sahilsilare.workers.dev", "http://localhost:3000"];

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: ALLOWED_ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"]
  })
);

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

// /auth/* and /health are the only public routes. Everything that touches
// incident, run, approval, or audit data requires a valid session cookie —
// requireAuth is mounted here, once, ahead of every protected router, so no
// individual route file can forget it.
app.use("/incidents/*", requireAuth);
app.use("/runs/*", requireAuth);
app.use("/approvals/*", requireAuth);
app.use("/audit/*", requireAuth);

app.route("/", authRoutes);
app.route("/", runRoutes);
app.route("/", packetRoutes);
app.route("/", approvalRoutes);

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
