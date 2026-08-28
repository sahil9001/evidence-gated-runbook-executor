import { ApiClientError, request } from "./api";
import type { User } from "./types";

// Re-exported so callers (the login/register forms) only need to import
// from this module, not reach into `api.ts` separately for the error type.
export { ApiClientError };

export async function register(email: string, password: string): Promise<User> {
  const data = await request<{ user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return data.user;
}

export async function login(email: string, password: string): Promise<User> {
  const data = await request<{ user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return data.user;
}

/** Idempotent and never errors, matching the backend's `/auth/logout` contract. */
export async function logout(): Promise<void> {
  await request<Record<string, never>>("/auth/logout", { method: "POST" });
}

export async function me(): Promise<User> {
  const data = await request<{ user: User }>("/auth/me", { method: "GET" });
  return data.user;
}
