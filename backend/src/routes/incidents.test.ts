import { env, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import app from "../index";
import { createD1Store } from "../store/d1";

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
  authCookie = await registerAndGetCookie("incidents-test-operator@example.com");
});

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };

// `null` (not the default-parameter-triggering `undefined`) is the "send no
// cookie at all" sentinel for the 401 tests below.
async function post(
  path: string,
  body: unknown,
  cookie: string | null = authCookie
): Promise<{ status: number; json: unknown }> {
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

async function get(path: string, cookie: string | null = authCookie): Promise<{ status: number; json: unknown }> {
  const request = new Request(`http://localhost${path}`, { headers: cookie === null ? {} : { cookie } });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, json: await response.json() };
}

type IncidentJson = {
  id: string;
  title: string;
  service: string;
  signals: string[];
  status: string;
  createdBy: string;
  createdAt: string;
};

describe("POST /incidents", () => {
  it("creates an incident and sets createdBy from the session, not the body", async () => {
    const { status, json } = await post("/incidents", {
      title: "Checkout failures spiking",
      service: "payment-service",
      signals: ["timeout", "error_rate"],
      // A client-supplied createdBy must be ignored — the same discipline
      // as `by` on approvals (B4).
      createdBy: "someone-else@example.com"
    });
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentJson>;
    expect(body.data.title).toBe("Checkout failures spiking");
    expect(body.data.service).toBe("payment-service");
    expect(body.data.signals).toEqual(["timeout", "error_rate"]);
    expect(body.data.createdBy).toBe("incidents-test-operator@example.com");
    expect(typeof body.data.id).toBe("string");
    expect(body.data.id.length).toBeGreaterThan(0);
  });

  it("returns 400 validation_failed when required fields are missing", async () => {
    const { status, json } = await post("/incidents", { title: "Missing fields" });
    expect(status).toBe(400);
    const body = json as ApiErr;
    expect(body.error.code).toBe("validation_failed");
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await post(
      "/incidents",
      { title: "No session", service: "payment-service", signals: ["timeout"] },
      null
    );
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /incidents", () => {
  it("lists incidents newest-first and filters by status", async () => {
    const store = createD1Store(env.DB);
    await store.createIncident({
      id: "inc-list-open",
      title: "Open one",
      service: "payment-service",
      signals: ["timeout"],
      status: "open",
      createdBy: "incidents-test-operator@example.com",
      createdAt: "2026-08-26T10:00:00.000Z"
    });
    await store.createIncident({
      id: "inc-list-resolved",
      title: "Resolved one",
      service: "payment-service",
      signals: ["timeout"],
      status: "resolved",
      createdBy: "incidents-test-operator@example.com",
      createdAt: "2026-08-26T10:05:00.000Z"
    });

    const { status, json } = await get("/incidents?status=open");
    expect(status).toBe(200);
    const body = json as ApiOk<IncidentJson[]>;
    const ids = body.data.map((i) => i.id);
    expect(ids).toContain("inc-list-open");
    expect(ids).not.toContain("inc-list-resolved");

    const all = await get("/incidents");
    const allBody = all.json as ApiOk<IncidentJson[]>;
    const allIds = allBody.data.map((i) => i.id);
    expect(allIds.indexOf("inc-list-resolved")).toBeLessThan(allIds.indexOf("inc-list-open"));
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/incidents", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});

describe("GET /incidents/:id", () => {
  it("returns the incident plus its runs", async () => {
    const store = createD1Store(env.DB);
    await store.createIncident({
      id: "inc-detail-1",
      title: "Detail incident",
      service: "payment-service",
      signals: ["timeout", "error_rate"],
      status: "open",
      createdBy: "incidents-test-operator@example.com",
      createdAt: "2026-08-26T11:00:00.000Z"
    });
    const { status: runStatus, json: runJson } = await post("/incidents/inc-detail-1/run", {
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });
    expect(runStatus).toBe(200);
    const runBody = runJson as ApiOk<{ run: { id: string } }>;

    const { status, json } = await get("/incidents/inc-detail-1");
    expect(status).toBe(200);
    const body = json as ApiOk<{ incident: IncidentJson; runs: { id: string }[] }>;
    expect(body.data.incident.id).toBe("inc-detail-1");
    expect(body.data.runs.map((r) => r.id)).toContain(runBody.data.run.id);
  });

  it("returns 404 not_found for an unknown incident id", async () => {
    const { status, json } = await get("/incidents/no-such-incident");
    expect(status).toBe(404);
    const body = json as ApiErr;
    expect(body.error.code).toBe("not_found");
  });

  it("returns 401 unauthenticated without a session cookie", async () => {
    const { status, json } = await get("/incidents/inc-detail-1", null);
    expect(status).toBe(401);
    const body = json as ApiErr;
    expect(body.error.code).toBe("unauthenticated");
  });
});
