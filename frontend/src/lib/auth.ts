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

/**
 * Who is signed in, or `null` for nobody — for callers that are ASKING rather
 * than assuming, like the public landing page's nav.
 *
 * `me()` is the wrong tool there twice over: it throws on an absent session,
 * and it redirects to /login on the way out, which would eject every
 * anonymous visitor from a public page. Here an absent session is the answer,
 * not a failure.
 *
 * Every other error still propagates. A backend that is unreachable or broken
 * must not be silently reported as "signed out", which would show a signed-in
 * operator the anonymous nav and hide the console from them.
 */
export async function currentUser(): Promise<User | null> {
  try {
    const data = await request<{ user: User }>(
      "/auth/me",
      { method: "GET" },
      { redirectOnExpiredSession: false }
    );
    return data.user;
  } catch (error: unknown) {
    if (error instanceof ApiClientError && error.code === "unauthenticated") return null;
    throw error;
  }
}
