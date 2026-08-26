import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import app from "../index";

async function registerAndGetCookie(email: string): Promise<string> {
  const request = new Request("http://localhost/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "a-very-secure-password-123" }),
    headers: { "content-type": "application/json" }
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error(`registerAndGetCookie: no Set-Cookie header registering ${email}`);
  const cookiePair = setCookie.split(";")[0];
  if (cookiePair === undefined) throw new Error("registerAndGetCookie: malformed Set-Cookie header");
  return cookiePair;
}

let authCookie = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  authCookie = await registerAndGetCookie("runbooks-test-operator@example.com");
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

async function get(path: string, cookie: string | null = authCookie): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`, { headers: cookie === null ? {} : { cookie } });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

type RunbookJson = {
  id: string;
  title: string;
  trigger: { service: string; signals: string[] };
  allowedSources: string[];
  steps: unknown[];
  proposedAction: { kind: string; target: string };
};

describe("GET /runbooks", () => {
  it("lists every bundled runbook with allowedSources and steps", async () => {
    const { status, json } = await get("/runbooks");
    expect(status).toBe(200);
    const body = json as ApiOk<RunbookJson[]>;
    expect(body.data.length).toBeGreaterThan(0);
    const checkout = body.data.find((r) => r.id === "checkout-failure");
    expect(checkout).toBeDefined();
    expect(checkout?.allowedSources).toEqual(["logs", "metrics", "deploys"]);
    expect(checkout?.steps.length).toBeGreaterThan(0);
    expect(checkout?.proposedAction.kind).toBe("rollback");
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/runbooks", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /runbooks/:id", () => {
  it("returns the runbook including allowedSources so operators see scope before starting a run", async () => {
    const { status, json } = await get("/runbooks/checkout-failure");
    expect(status).toBe(200);
    const body = json as ApiOk<RunbookJson>;
    expect(body.data.id).toBe("checkout-failure");
    expect(body.data.allowedSources).toContain("logs");
  });

  it("returns 404 not_found for an unknown runbook id", async () => {
    const { status, json } = await get("/runbooks/no-such-runbook");
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/runbooks/checkout-failure", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});
