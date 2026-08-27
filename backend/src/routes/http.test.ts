import { Hono } from "hono";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { Env } from "../index";
import { parseJsonBody } from "./http";

const bodySchema = z.object({ name: z.string().min(1) });

function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/echo", async (c) => {
    const parsed = await parseJsonBody(c, bodySchema);
    if (!parsed.success) return parsed.response;
    return c.json({ ok: true, data: parsed.data });
  });
  return app;
}

async function post(body: unknown): Promise<{ status: number; json: unknown }> {
  const app = buildApp();
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
  const request = new Request("http://localhost/echo", init);
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

describe("parseJsonBody", () => {
  it("returns the parsed data for a valid body", async () => {
    const { status, json } = await post({ name: "sahil" });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, data: { name: "sahil" } });
  });

  it("returns 400 validation_failed for a body that is not valid JSON", async () => {
    const { status, json } = await post("{not json");
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe("validation_failed");
  });

  it("returns 400 validation_failed for a body that fails schema validation", async () => {
    const { status, json } = await post({ name: "" });
    expect(status).toBe(400);
    expect((json as { error: { code: string } }).error.code).toBe("validation_failed");
  });
});
