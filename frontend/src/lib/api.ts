import type { ApiErrorBody, ApprovalResponse, OverviewResponse, PacketResponse, RunResponse } from "./types";

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
 * `requireAuth` emits. A 401 `invalid_credentials` (a failed login attempt)
 * is a different case entirely and must NOT trigger this — that's an
 * expected, in-page form error, not a session expiry.
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

export async function startRun(
  incidentId: string,
  body: { service: string; signals: string[] }
): Promise<RunResponse> {
  return request<RunResponse>(`/incidents/${encodeURIComponent(incidentId)}/run`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function getPacket(incidentId: string): Promise<PacketResponse> {
  return request<PacketResponse>(`/incidents/${encodeURIComponent(incidentId)}/packet`, {
    method: "GET"
  });
}

export async function approve(gateId: string, by: string, reason?: string): Promise<ApprovalResponse> {
  return request<ApprovalResponse>(`/approvals/${encodeURIComponent(gateId)}/approve`, {
    method: "POST",
    body: JSON.stringify(reason === undefined ? { by } : { by, reason })
  });
}

export async function reject(gateId: string, by: string, reason: string): Promise<ApprovalResponse> {
  return request<ApprovalResponse>(`/approvals/${encodeURIComponent(gateId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ by, reason })
  });
}

/** Backs the top bar's awaiting-approval badge and (eventually) the Overview screen. */
export async function getOverview(): Promise<OverviewResponse> {
  return request<OverviewResponse>("/overview", { method: "GET" });
}
