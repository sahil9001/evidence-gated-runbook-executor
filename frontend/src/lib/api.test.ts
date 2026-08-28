import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  approve,
  getOverview,
  getPacket,
  getRun,
  listAudit,
  listAuditLog,
  listIncidents,
  listRuns,
  reject,
  startRun
} from "./api";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_URL;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = ORIGINAL_ENV;
    }
  });

  it("unwraps `data` from a successful response instead of returning the envelope", async () => {
    const data = {
      run: { id: "run-1", incidentId: "inc-1", runbookId: "rb-1", service: "checkout", state: "awaiting_approval", createdAt: "t", updatedAt: "t", createdBy: "oncall@runproof.dev" },
      packet: { id: "pk-1", incidentId: "inc-1", runbookId: "rb-1", cards: [], summary: "s", builtAt: "t" },
      action: { id: "run-1", kind: "rollback", target: "checkout", params: {}, reversible: true, description: "d", isStateChanging: true },
      gate: { id: "run-1", actionId: "run-1", createdAt: "t", expiresAt: "t2", state: "locked" },
      failures: []
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data }));

    const result = await startRun("inc-1");

    // A test that only checked "truthy" would pass even if the envelope leaked
    // through unwrapped; asserting exact equality with the inner `data` (no
    // `ok` key) is what actually proves unwrapping happened.
    expect(result).toEqual(data);
    expect(result).not.toHaveProperty("ok");
  });

  it("sends no body fields the backend doesn't accept when starting a run (no service/signals)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          run: { id: "run-1", incidentId: "inc-1", runbookId: "rb-1", service: "checkout", state: "awaiting_approval", createdAt: "t", updatedAt: "t", createdBy: "oncall@runproof.dev" },
          packet: { id: "pk-1", incidentId: "inc-1", runbookId: "rb-1", cards: [], summary: "s", builtAt: "t" },
          action: { id: "run-1", kind: "rollback", target: "checkout", params: {}, reversible: true, description: "d", isStateChanging: true },
          gate: { id: "run-1", actionId: "run-1", createdAt: "t", expiresAt: "t2", state: "locked" },
          failures: []
        }
      })
    );

    await startRun("inc-1");

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const sentBody: unknown = JSON.parse(String(init?.body));
    expect(sentBody).toEqual({});
    expect(sentBody).not.toHaveProperty("service");
    expect(sentBody).not.toHaveProperty("signals");
  });

  it("throws ApiClientError with the backend's specific code and status on 409 gate_already_decided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "gate_already_decided", message: "already decided" } }, 409)
    );

    await expect(approve("gate-1")).rejects.toMatchObject({
      code: "gate_already_decided",
      status: 409
    });
  });

  it("throws ApiClientError with the backend's specific code and status on 400 validation_failed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: false, error: { code: "validation_failed", message: "bad body" } }, 400)
    );

    await expect(startRun("inc-1")).rejects.toMatchObject({
      code: "validation_failed",
      status: 400
    });
  });

  it("throws ApiClientError with code network_error when fetch rejects (network down)", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const error = await getPacket("inc-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("network_error");
    expect((error as ApiClientError).status).toBe(0);
  });

  it("throws ApiClientError (not a raw SyntaxError) when a 2xx response body is malformed JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("not json{{{", { status: 200, headers: { "content-type": "application/json" } })
    );

    const error = await getPacket("inc-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).not.toBeInstanceOf(SyntaxError);
  });

  it("builds the request URL from NEXT_PUBLIC_API_URL when set", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { packet: { id: "p", incidentId: "i", runbookId: "r", cards: [], summary: "s", builtAt: "t" }, confidence: "high" } })
    );

    await getPacket("inc-42");

    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe("https://api.example.test/incidents/inc-42/packet");
  });

  it("falls back to http://localhost:8787 when NEXT_PUBLIC_API_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { packet: { id: "p", incidentId: "i", runbookId: "r", cards: [], summary: "s", builtAt: "t" }, confidence: "high" } })
    );

    await getPacket("inc-42");

    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe("http://localhost:8787/incidents/inc-42/packet");
  });

  it("omits `reason` from the request body when approve is called without one, and never sends `by`", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { gate: { id: "g", actionId: "a", createdAt: "t", expiresAt: "t2", state: "approved" } } })
    );

    await approve("gate-1");

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const sentBody: unknown = JSON.parse(String(init?.body));
    expect(sentBody).toEqual({});
    expect(sentBody).not.toHaveProperty("reason");
    expect(sentBody).not.toHaveProperty("by");
  });

  it("sends credentials: 'include' on every request so the session cookie travels cross-origin", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { packet: { id: "p", incidentId: "i", runbookId: "r", cards: [], summary: "s", builtAt: "t" }, confidence: "high" } })
    );

    await getPacket("inc-42");

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.credentials).toBe("include");
  });

  it("always sends `reason` (and never `by`) in the request body for reject", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { gate: { id: "g", actionId: "a", createdAt: "t", expiresAt: "t2", state: "rejected", decidedBy: "alice", decidedAt: "t3", reason: "bad idea" } } })
    );

    await reject("gate-1", "bad idea");

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const sentBody: unknown = JSON.parse(String(init?.body));
    expect(sentBody).toEqual({ reason: "bad idea" });
    expect(sentBody).not.toHaveProperty("by");
  });

  it("unwraps the overview payload from GET /overview", async () => {
    const data = { awaitingApproval: 2, activeIncidents: 3, runsToday: 5, recentActivity: [] };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data }));

    const result = await getOverview();

    expect(result).toEqual(data);
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe("http://localhost:8787/overview");
  });

  it("unwraps the run detail payload from GET /runs/:id", async () => {
    const data = {
      run: { id: "run-1", incidentId: "inc-1", runbookId: "rb-1", service: "checkout", state: "awaiting_approval", createdAt: "t", updatedAt: "t", createdBy: "oncall@runproof.dev" },
      incident: { id: "inc-1", title: "Checkout errors", service: "checkout", signals: [], status: "open", createdBy: "oncall@runproof.dev", createdAt: "t" },
      packet: null,
      action: null,
      gate: null,
      failures: [],
      confidence: null
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data }));

    const result = await getRun("run-1");

    expect(result).toEqual(data);
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe("http://localhost:8787/runs/run-1");
  });

  it("unwraps the audit list payload from GET /audit?runId=", async () => {
    const data = [{ id: "a1", runId: "run-1", at: "t", kind: "run_created", detail: "d" }];
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data }));

    const result = await listAudit("run-1");

    expect(result).toEqual(data);
    const calledUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe("http://localhost:8787/audit?runId=run-1");
  });

  // These four calls back every list/detail screen that filters on user
  // input (IncidentsClient, HistoryClient, AuditClient) — an AbortSignal
  // passed through to `fetch` is what lets those screens cancel a stale
  // in-flight request when the filter changes again before it resolves.
  describe("AbortSignal passthrough", () => {
    it("forwards an AbortSignal to fetch for listIncidents", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
      const controller = new AbortController();

      await listIncidents(undefined, undefined, controller.signal);

      const init = vi.mocked(fetch).mock.calls[0]?.[1];
      expect(init?.signal).toBe(controller.signal);
    });

    it("forwards an AbortSignal to fetch for listRuns", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
      const controller = new AbortController();

      await listRuns(undefined, controller.signal);

      const init = vi.mocked(fetch).mock.calls[0]?.[1];
      expect(init?.signal).toBe(controller.signal);
    });

    it("forwards an AbortSignal to fetch for getRun", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            run: { id: "run-1", incidentId: "inc-1", runbookId: "rb-1", service: "checkout", state: "awaiting_approval", createdAt: "t", updatedAt: "t", createdBy: null },
            incident: { id: "inc-1", title: "t", service: "checkout", signals: [], status: "open", createdBy: "a@b.com", createdAt: "t" },
            packet: null,
            action: null,
            gate: null,
            failures: [],
            confidence: null
          }
        })
      );
      const controller = new AbortController();

      await getRun("run-1", controller.signal);

      const init = vi.mocked(fetch).mock.calls[0]?.[1];
      expect(init?.signal).toBe(controller.signal);
    });

    it("forwards an AbortSignal to fetch for listAuditLog", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
      const controller = new AbortController();

      await listAuditLog({ runId: "run-1" }, controller.signal);

      const init = vi.mocked(fetch).mock.calls[0]?.[1];
      expect(init?.signal).toBe(controller.signal);
    });
  });
});
