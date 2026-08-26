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
  authCookie = await registerAndGetCookie("overview-test-operator@example.com");
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

type OverviewJson = {
  awaitingApproval: number;
  activeIncidents: number;
  runsToday: number;
  recentActivity: AuditEntry[];
};

async function get(path: string, cookie: string | null = authCookie): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`, { headers: cookie === null ? {} : { cookie } });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

describe("GET /overview", () => {
  it("counts awaiting-approval runs, active incidents, today's runs, and lists recent activity", async () => {
    const store = createD1Store(env.DB);

    const before = await get("/overview");
    const beforeBody = before.json as ApiOk<OverviewJson>;

    const nowIso = new Date().toISOString();
    await store.createIncident({
      id: "overview-inc-active",
      title: "Active incident",
      service: "payment-service",
      signals: ["timeout"],
      status: "open",
      createdBy: "overview-test-operator@example.com",
      createdAt: nowIso
    });
    await store.createIncident({
      id: "overview-inc-resolved",
      title: "Resolved incident",
      service: "payment-service",
      signals: ["timeout"],
      status: "resolved",
      createdBy: "overview-test-operator@example.com",
      createdAt: nowIso
    });

    await store.createRun({
      id: "overview-run-awaiting",
      incidentId: "overview-inc-active",
      runbookId: "checkout-failure",
      service: "payment-service",
      state: "awaiting_approval",
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: "overview-test-operator@example.com"
    });
    await store.createRun({
      id: "overview-run-executed",
      incidentId: "overview-inc-active",
      runbookId: "checkout-failure",
      service: "payment-service",
      state: "executed",
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: "overview-test-operator@example.com"
    });
    await store.appendAudit({
      id: "overview-audit-1",
      runId: "overview-run-awaiting",
      at: nowIso,
      kind: "run_created",
      detail: "created for overview test"
    });

    const after = await get("/overview");
    expect(after.status).toBe(200);
    const afterBody = after.json as ApiOk<OverviewJson>;

    expect(afterBody.data.awaitingApproval).toBe(beforeBody.data.awaitingApproval + 1);
    expect(afterBody.data.activeIncidents).toBe(beforeBody.data.activeIncidents + 1);
    expect(afterBody.data.runsToday).toBe(beforeBody.data.runsToday + 2);
    expect(afterBody.data.recentActivity.some((e) => e.id === "overview-audit-1")).toBe(true);
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/overview", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});
