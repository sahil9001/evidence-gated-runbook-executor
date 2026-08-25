import type { ApiErrorBody, ApprovalResponse, PacketResponse, RunResponse } from "./types";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiClientError(message, "network_error", 0);
  }

  const body = await parseJson(response);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
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
