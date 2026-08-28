// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPacket } from "./api";
import { currentUser } from "./auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

// A session can expire mid-session on any authenticated screen. Rather than
// have every screen in the console duplicate "on 401, bounce to /login",
// the shared request layer does it once so no page is left rendering stale
// data behind an expired cookie.
describe("api client session-expiry redirect", () => {
  const setHref = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    const fakeLocation: Record<string, unknown> = { pathname: "/app/incidents", search: "?foo=bar" };
    Object.defineProperty(fakeLocation, "href", {
      configurable: true,
      get: () => "",
      set: setHref
    });
    vi.stubGlobal("location", fakeLocation);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setHref.mockClear();
  });

  it("does not redirect when a caller is only asking whether a session exists", async () => {
    // The landing page's nav asks this on a PUBLIC page. Redirecting on the
    // answer "nobody is signed in" would eject every anonymous visitor.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "unauthenticated", message: "Authentication required" } }, 401)
    );

    await expect(currentUser()).resolves.toBeNull();
    expect(setHref).not.toHaveBeenCalled();
  });

  it("still surfaces a real failure rather than reporting it as signed out", async () => {
    // "The API is down" must not be flattened into "you are signed out", which
    // would hide the console from someone who is in fact signed in.
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "internal_error", message: "boom" } }, 500)
    );

    await expect(currentUser()).rejects.toMatchObject({ code: "internal_error" });
    expect(setHref).not.toHaveBeenCalled();
  });

  it("redirects to /login with the current path preserved when the backend returns 401 unauthenticated", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "unauthenticated", message: "Authentication required" } }, 401)
    );

    await expect(getPacket("inc-1")).rejects.toMatchObject({ code: "unauthenticated" });

    expect(setHref).toHaveBeenCalledWith("/login?next=%2Fapp%2Fincidents%3Ffoo%3Dbar");
  });

  it("does not redirect for a 401 that is not the unauthenticated code (e.g. login failures)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password" } }, 401)
    );

    await expect(getPacket("inc-1")).rejects.toMatchObject({ code: "invalid_credentials" });

    expect(setHref).not.toHaveBeenCalled();
  });
});
