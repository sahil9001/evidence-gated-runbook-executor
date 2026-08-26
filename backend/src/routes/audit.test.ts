import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import app from "../index";
import { createD1Store } from "../store/d1";
import type { AuditEntry } from "../domain/store";

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
  authCookie = await registerAndGetCookie("audit-test-operator@example.com");
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

describe("GET /audit?runId=", () => {
  it("returns one run's entries in `at` order", async () => {
    const store = createD1Store(env.DB);
    const runId = "audit-route-run-1";
    const entries: AuditEntry[] = [
      { id: "audit-route-b", runId, at: "2026-08-26T12:05:00.000Z", kind: "gate_approved", detail: "b" },
      { id: "audit-route-a", runId, at: "2026-08-26T12:00:00.000Z", kind: "run_created", detail: "a" }
    ];
    for (const entry of entries) await store.appendAudit(entry);

    const { status, json } = await get(`/audit?runId=${runId}`);
    expect(status).toBe(200);
    const body = json as ApiOk<AuditEntry[]>;
    expect(body.data.map((e) => e.id)).toEqual(["audit-route-a", "audit-route-b"]);
  });

  it("returns an empty array for a run with no audit entries", async () => {
    const { status, json } = await get("/audit?runId=no-such-run");
    expect(status).toBe(200);
    const body = json as ApiOk<AuditEntry[]>;
    expect(body.data).toEqual([]);
  });
});

describe("GET /audit (no runId)", () => {
  it("returns the most recent entries across all runs, newest first", async () => {
    const store = createD1Store(env.DB);
    const entries: AuditEntry[] = [
      { id: "audit-recent-route-a", runId: "run-x", at: "2026-08-26T13:00:00.000Z", kind: "run_created", detail: "a" },
      { id: "audit-recent-route-b", runId: "run-y", at: "2026-08-26T13:05:00.000Z", kind: "gate_approved", detail: "b" }
    ];
    for (const entry of entries) await store.appendAudit(entry);

    const { status, json } = await get("/audit");
    expect(status).toBe(200);
    const body = json as ApiOk<AuditEntry[]>;
    const ids = body.data.map((e) => e.id);
    expect(ids.indexOf("audit-recent-route-b")).toBeLessThan(ids.indexOf("audit-recent-route-a"));
  });

  it("caps an oversized limit instead of returning every entry ever written", async () => {
    const store = createD1Store(env.DB);
    const MORE_THAN_MAX_LIMIT = 105;
    for (let i = 0; i < MORE_THAN_MAX_LIMIT; i += 1) {
      await store.appendAudit({
        id: `audit-cap-${i}`,
        runId: "run-cap",
        at: `2026-08-26T14:${String(i % 60).padStart(2, "0")}:00.000Z`,
        kind: "run_created",
        detail: `entry ${i}`
      });
    }

    const { status, json } = await get("/audit?limit=999999");
    expect(status).toBe(200);
    const body = json as ApiOk<AuditEntry[]>;
    expect(body.data.length).toBeLessThanOrEqual(100);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/audit", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});
