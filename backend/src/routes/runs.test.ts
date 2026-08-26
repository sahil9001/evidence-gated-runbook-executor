import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import app from "../index";
import { createD1Store } from "../store/d1";
import type { RunRow } from "../domain/store";

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
  authCookie = await registerAndGetCookie("runs-test-operator@example.com");
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

async function post(path: string, body: unknown, cookie: string | null = authCookie): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: cookie === null ? { "content-type": "application/json" } : { "content-type": "application/json", cookie }
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

const makeSeedRun = (id: string, overrides: Partial<RunRow> = {}): RunRow => ({
  id,
  incidentId: "runs-list-incident",
  runbookId: "checkout-failure",
  service: "payment-service",
  state: "collecting",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  createdBy: "runs-test-operator@example.com",
  ...overrides
});

describe("GET /runs", () => {
  it("lists recent runs newest-first and respects ?state=", async () => {
    const store = createD1Store(env.DB);
    await store.createRun(makeSeedRun("runs-list-a", { state: "collecting", createdAt: "2026-08-26T01:00:00.000Z", updatedAt: "2026-08-26T01:00:00.000Z" }));
    await store.createRun(makeSeedRun("runs-list-b", { state: "executed", createdAt: "2026-08-26T01:05:00.000Z", updatedAt: "2026-08-26T01:05:00.000Z" }));
    await store.createRun(makeSeedRun("runs-list-c", { state: "executed", createdAt: "2026-08-26T01:10:00.000Z", updatedAt: "2026-08-26T01:10:00.000Z" }));

    const { status, json } = await get("/runs?state=executed");
    expect(status).toBe(200);
    const body = json as ApiOk<RunRow[]>;
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain("runs-list-b");
    expect(ids).toContain("runs-list-c");
    expect(ids).not.toContain("runs-list-a");
    expect(ids.indexOf("runs-list-c")).toBeLessThan(ids.indexOf("runs-list-b"));
  });

  it("returns 400 validation_failed for an unknown state", async () => {
    const { status, json } = await get("/runs?state=not-a-real-state");
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });

  it("defaults to 25 results and caps an oversized limit", async () => {
    const store = createD1Store(env.DB);
    const MORE_THAN_MAX_LIMIT = 55;
    for (let i = 0; i < MORE_THAN_MAX_LIMIT; i += 1) {
      await store.createRun(
        makeSeedRun(`runs-cap-${i}`, {
          incidentId: "runs-cap-incident",
          createdAt: `2026-08-26T02:${String(i % 60).padStart(2, "0")}:00.000Z`,
          updatedAt: `2026-08-26T02:${String(i % 60).padStart(2, "0")}:00.000Z`
        })
      );
    }

    const { status, json } = await get("/runs?limit=999999");
    expect(status).toBe(200);
    const body = json as ApiOk<RunRow[]>;
    expect(body.data.length).toBeLessThanOrEqual(50);

    const defaultLimit = await get("/runs");
    const defaultBody = defaultLimit.json as ApiOk<RunRow[]>;
    expect(defaultBody.data.length).toBeLessThanOrEqual(25);
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/runs", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /runs/:id", () => {
  it("returns everything the run detail screen needs", async () => {
    const store = createD1Store(env.DB);
    const incidentId = "runs-detail-incident";
    await store.createIncident({
      id: incidentId,
      title: "Detail run incident",
      service: "payment-service",
      signals: ["timeout", "error_rate"],
      status: "open",
      createdBy: "runs-test-operator@example.com",
      createdAt: new Date().toISOString()
    });

    const { status: runStatus, json: runJson } = await post(`/incidents/${incidentId}/run`, {
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });
    expect(runStatus).toBe(200);
    const runBody = runJson as ApiOk<{ run: { id: string }; gate: { id: string } }>;
    const runId = runBody.data.run.id;

    const { status, json } = await get(`/runs/${runId}`);
    expect(status).toBe(200);
    const body = json as ApiOk<{
      run: { id: string; incidentId: string };
      incident: { id: string } | null;
      packet: { cards: unknown[] } | null;
      action: { id: string; kind: string } | null;
      gate: { id: string; state: string } | null;
      failures: { source: string; message: string }[];
      confidence: string | null;
    }>;

    expect(body.data.run.id).toBe(runId);
    expect(body.data.incident?.id).toBe(incidentId);
    expect(body.data.packet?.cards.length).toBeGreaterThan(0);
    expect(body.data.action?.kind).toBe("rollback");
    expect(body.data.gate?.state).toBe("locked");
    expect(body.data.failures).toEqual([]);
    expect(["high", "medium", "low"]).toContain(body.data.confidence);
  });

  it("returns 404 not_found for an unknown run id", async () => {
    const { status, json } = await get("/runs/no-such-run");
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/runs/no-such-run", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});
