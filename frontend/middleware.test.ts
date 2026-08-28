import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function requestFor(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, "https://console.runproof.test"), { headers });
}

describe("middleware", () => {
  it("redirects to /login with next set to the original path when no session cookie is present", () => {
    const response = middleware(requestFor("/app/incidents"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/app/incidents");
  });

  it("preserves the query string of the original path in next", () => {
    const response = middleware(requestFor("/app/runs/run-1?tab=evidence"));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/app/runs/run-1?tab=evidence");
  });

  it("passes through when the rp_session cookie is present, even without validating it", () => {
    const response = middleware(requestFor("/app/incidents", "rp_session=abc123"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("passes through /app root the same as any other protected path when unauthenticated", () => {
    const response = middleware(requestFor("/app"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/app");
  });
});
