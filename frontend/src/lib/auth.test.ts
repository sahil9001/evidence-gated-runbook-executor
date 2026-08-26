import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, login, logout, me, register } from "./auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("auth client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-exports ApiClientError from the shared api client instead of a duplicate", async () => {
    const { ApiClientError: fromApi } = await import("./api");
    expect(ApiClientError).toBe(fromApi);
  });

  it("posts to /auth/register with credentials included and returns the user", async () => {
    const user = { id: "u1", email: "a@b.com", createdAt: "t" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { user } }));

    const result = await register("a@b.com", "password12345");

    expect(result).toEqual(user);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/auth/register");
    expect(init?.credentials).toBe("include");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.com", password: "password12345" });
  });

  it("throws ApiClientError with code email_taken on 409", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "email_taken", message: "already exists" } }, 409)
    );

    await expect(register("a@b.com", "password12345")).rejects.toMatchObject({ code: "email_taken", status: 409 });
  });

  it("posts to /auth/login with credentials included and returns the user", async () => {
    const user = { id: "u1", email: "a@b.com", createdAt: "t" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { user } }));

    const result = await login("a@b.com", "password12345");

    expect(result).toEqual(user);
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init?.credentials).toBe("include");
  });

  it("throws ApiClientError with code invalid_credentials on 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password" } }, 401)
    );

    await expect(login("a@b.com", "wrong")).rejects.toMatchObject({
      code: "invalid_credentials",
      status: 401,
      message: "Invalid email or password"
    });
  });

  it("posts to /auth/logout with credentials included", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: {} }));

    await logout();

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/auth/logout");
    expect(init?.credentials).toBe("include");
  });

  it("gets /auth/me and returns the user", async () => {
    const user = { id: "u1", email: "a@b.com", createdAt: "t" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: { user } }));

    const result = await me();

    expect(result).toEqual(user);
  });

  it("throws ApiClientError with code unauthenticated on 401 for me", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "unauthenticated", message: "Authentication required" } }, 401)
    );

    await expect(me()).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
  });
});
