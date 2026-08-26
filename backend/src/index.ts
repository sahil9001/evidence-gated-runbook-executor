import { Hono } from "hono";
import { cors } from "hono/cors";
import runRoutes from "./routes/run";
import runListRoutes from "./routes/runs";
import packetRoutes from "./routes/packet";
import approvalRoutes from "./routes/approvals";
import authRoutes from "./routes/auth";
import incidentRoutes from "./routes/incidents";
import runbookRoutes from "./routes/runbooks";
import auditRoutes from "./routes/audit";
import overviewRoutes from "./routes/overview";
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
    allowHeaders: ["Content-Type"],
    // The frontend sends the `rp_session` cookie cross-origin
    // (`credentials: "include"` in frontend/src/lib/api.ts). Without this,
    // the browser neither stores nor sends that cookie, so every protected
    // request 401s even after a successful login. Hono's cors() only ever
    // echoes back one origin from `ALLOWED_ORIGINS` (never "*") when
    // `origin` is an array, which is required for `credentials: true` to be
    // valid in the first place — a wildcard plus credentials is rejected by
    // browsers, and would be a real hole even if it weren't.
    credentials: true
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
app.use("/runbooks/*", requireAuth);
app.use("/overview/*", requireAuth);

app.route("/", authRoutes);
app.route("/", incidentRoutes);
app.route("/", runRoutes);
app.route("/", runListRoutes);
app.route("/", packetRoutes);
app.route("/", approvalRoutes);
app.route("/", runbookRoutes);
app.route("/", auditRoutes);
app.route("/", overviewRoutes);

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
