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
