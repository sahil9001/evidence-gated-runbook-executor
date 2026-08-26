import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "./index";

describe("health", () => {
  it("returns ok with a service name", async () => {
    const request = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "runproof-api" });
  });

  it("returns a structured 404 for unknown routes", async () => {
    const request = new Request("http://localhost/nope");
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("CORS", () => {
  // The frontend at :3000 sends cookies cross-origin (`credentials: "include"`
  // in lib/api.ts). Without `Access-Control-Allow-Credentials: true` on the
  // preflight response, the browser refuses to store or send the `rp_session`
  // cookie at all — login appears to succeed and every subsequent protected
  // request 401s. This is the regression test for that bug.
  it("echoes an allowed origin and allows credentials on preflight", async () => {
    const request = new Request("http://localhost/incidents", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET"
      }
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not echo back a disallowed origin", async () => {
    const request = new Request("http://localhost/incidents", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example.com",
        "Access-Control-Request-Method": "GET"
      }
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("https://evil.example.com");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });
});
