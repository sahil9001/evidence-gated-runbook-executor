import type {
  ApiErrorBody,
  ApprovalResponse,
  AuditEntry,
  IncidentDetailResponse,
  IncidentRow,
  OverviewResponse,
  PacketResponse,
  Runbook,
  RunDetailResponse,
  RunResponse,
  RunRow
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8787";

/**
 * Thrown for every failure mode this client can produce: a non-2xx backend
 * response (carries the backend's `error.code` and the HTTP status), a
 * network failure (`code: "network_error"`, `status: 0`), or a 2xx response
 * whose body isn't valid JSON (`code: "invalid_response"`, the real status).
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_BASE_URL;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== false) return false;
  if (typeof record.error !== "object" || record.error === null) return false;
  const error = record.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError(
      `Response from ${response.url} was not valid JSON`,
      "invalid_response",
      response.status
    );
  }
}

/**
 * A session can expire (or be revoked) mid-session on any authenticated
 * screen — the console must not sit there rendering stale data behind an
 * expired cookie. Rather than have every caller of `request` duplicate
 * "on 401, bounce to /login", it happens once here for the one 401 that
 * actually means "your session is gone": `unauthenticated`, the code
 * `requireAuth` emits (backend/src/auth/middleware.ts). A 401
 * `invalid_credentials` (a failed login attempt) is a different case
 * entirely and must NOT trigger this — that's an expected, in-page form
 * error, not a session expiry. Keying on `error.code` rather than the bare
 * 401 status is load-bearing: both cases share the same HTTP status.
 */
function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/login")) return;
  const next = encodeURIComponent(`${pathname}${search}`);
  // A hard navigation (not `useRouter().push()`) is intentional: this runs
  // inside a plain lib module, not a Client Component, so there is no
  // router instance available — and a full reload is what we want anyway,
  // since it guarantees any in-memory state built on the now-invalid
  // session is discarded rather than reused by whatever renders next.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see comment above: no router is reachable from this module, and the reload is deliberate.
  window.location.href = `/login?next=${next}`;
}

/**
 * Exported so `lib/auth.ts` can issue `/auth/*` requests through the same
 * envelope-unwrapping, error-mapping, credentialed-fetch logic as every
 * other client function here, instead of re-implementing it.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      // The session is a cookie, and this frontend is served from a
      // different origin than the backend Worker — without this, no cookie
      // ever travels and every authenticated request 401s.
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiClientError(message, "network_error", 0);
  }

  const body = await parseJson(response);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      if (response.status === 401 && body.error.code === "unauthenticated") {
        redirectToLogin();
      }
      throw new ApiClientError(body.error.message, body.error.code, response.status);
    }
    throw new ApiClientError(
      `Request to ${response.url} failed with status ${response.status}`,
      "unknown_error",
      response.status
    );
  }

  const envelope = body as { ok: true; data: T };
  return envelope.data;
}

// No body: backend/src/routes/run.ts takes no `service`/`signals` in the
// request — the incident row is the sole authority for what the run is
// about (`runBodySchema = z.object({})`). A caller cannot redirect a run
// against a different service by claiming one in the body.
export async function startRun(incidentId: string): Promise<RunResponse> {
  return request<RunResponse>(`/incidents/${encodeURIComponent(incidentId)}/run`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function getPacket(incidentId: string): Promise<PacketResponse> {
  return request<PacketResponse>(`/incidents/${encodeURIComponent(incidentId)}/packet`, {
    method: "GET"
  });
}

// `by` is deliberately absent from both request bodies — the backend takes
// the approver from the session (`c.var.user.email`), never from anything a
// client sends (see backend/src/routes/approvals.ts). Sending one here would
// be dead weight at best; the schema on the other end doesn't accept it.
export async function approve(gateId: string, reason?: string): Promise<ApprovalResponse> {
  return request<ApprovalResponse>(`/approvals/${encodeURIComponent(gateId)}/approve`, {
    method: "POST",
    body: JSON.stringify(reason === undefined ? {} : { reason })
  });
}

export async function reject(gateId: string, reason: string): Promise<ApprovalResponse> {
  return request<ApprovalResponse>(`/approvals/${encodeURIComponent(gateId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

/** Backs the top bar's awaiting-approval badge and the Overview screen. */
export async function getOverview(): Promise<OverviewResponse> {
  return request<OverviewResponse>("/overview", { method: "GET" });
}

/**
 * Backs the incidents list. `status` filters server-side (undefined = every
 * status). `limit` mirrors the backend's own `?limit=` cap
 * (backend/src/routes/incidents.ts) — omitted, the server applies its own
 * default.
 */
export async function listIncidents(status?: string, limit?: number): Promise<IncidentRow[]> {
  const params = new URLSearchParams();
  if (status !== undefined) params.set("status", status);
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return request<IncidentRow[]>(`/incidents${query.length > 0 ? `?${query}` : ""}`, { method: "GET" });
}

// `createdBy` is deliberately absent — the backend takes it from the
// session, never the request body (see backend/src/routes/incidents.ts).
export async function createIncident(body: {
  title: string;
  service: string;
  signals: string[];
}): Promise<IncidentRow> {
  return request<IncidentRow>("/incidents", { method: "POST", body: JSON.stringify(body) });
}

export async function getIncident(id: string): Promise<IncidentDetailResponse> {
  return request<IncidentDetailResponse>(`/incidents/${encodeURIComponent(id)}`, { method: "GET" });
}

/** Backs the create-incident screen's runbook-match preview and the Runbooks screen. */
export async function listRunbooks(): Promise<Runbook[]> {
  return request<Runbook[]>("/runbooks", { method: "GET" });
}

/** Backs the run detail screen — the one call that feeds all four tabs. */
export async function getRun(id: string): Promise<RunDetailResponse> {
  return request<RunDetailResponse>(`/runs/${encodeURIComponent(id)}`, { method: "GET" });
}

/** Backs the run detail screen's Audit tab — this run's entries, in order. */
export async function listAudit(runId: string): Promise<AuditEntry[]> {
  return request<AuditEntry[]>(`/audit?runId=${encodeURIComponent(runId)}`, { method: "GET" });
}

/** Backs the History screen. `state` filters server-side (undefined = every state);
 * `limit` mirrors the backend's own `?limit=` cap (backend/src/routes/runs.ts). */
export async function listRuns(filter?: { state?: RunRow["state"]; limit?: number }): Promise<RunRow[]> {
  const params = new URLSearchParams();
  if (filter?.state !== undefined) params.set("state", filter.state);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.toString();
  return request<RunRow[]>(`/runs${query.length > 0 ? `?${query}` : ""}`, { method: "GET" });
}

/**
 * Backs the standalone Audit screen — distinct from `listAudit` above (which
 * always scopes to one run for the run-detail Audit tab): here `runId` is
 * optional, matching `GET /audit`'s own contract of "recent entries across
 * every run" when omitted. `limit` mirrors the backend's own `?limit=` cap
 * (backend/src/routes/audit.ts).
 */
export async function listAuditLog(filter?: { runId?: string; limit?: number }): Promise<AuditEntry[]> {
  const params = new URLSearchParams();
  if (filter?.runId !== undefined) params.set("runId", filter.runId);
  if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
  const query = params.toString();
  return request<AuditEntry[]>(`/audit${query.length > 0 ? `?${query}` : ""}`, { method: "GET" });
}
