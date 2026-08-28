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

/** Where the console frontend is actually deployed — see README.md's "Live
 * deployment" section and `frontend/wrangler.jsonc`. */
const DEPLOYED_CONSOLE_ORIGIN = "https://runproof-frontend.sahilsilare.workers.dev";

describe("CORS", () => {
  it("answers a preflight from the allowed dev frontend origin with that exact origin and credentials", async () => {
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

  it("answers a preflight from the deployed console origin, which the checked-in config must name", async () => {
    // Guards the regression where ALLOWED_FRONTEND_ORIGINS is blank (or names
    // some other host) in wrangler.jsonc: the backend would still pass every
    // test that only exercises localhost, while a deployed console got no CORS
    // access at all and failed at login. `env` here is the real wrangler.jsonc
    // `vars` block, so this fails the moment that value stops covering the
    // frontend documented in README.md's "Live deployment" section.
    const request = new Request("http://localhost/incidents", {
      method: "OPTIONS",
      headers: {
        Origin: DEPLOYED_CONSOLE_ORIGIN,
        "Access-Control-Request-Method": "GET"
      }
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(DEPLOYED_CONSOLE_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("does not echo back a disallowed origin", async () => {
    const request = new Request("http://localhost/incidents", {
      method: "OPTIONS",
      headers: {
        Origin: "http://evil.example",
        "Access-Control-Request-Method": "GET"
      }
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not affect /mcp, which sends no CORS headers and keeps its own Origin validation", async () => {
    // TrueForge's server-side fetch to /mcp sends no Origin header at all —
    // the scenario this asserts is unaffected by the console's CORS
    // middleware, which is never mounted on /mcp.
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
