import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../index";
import type { Env } from "../index";
import { handleCollectLogs } from "../mcp/toolHandlers";

// Wraps the real handler in a `vi.fn` so every test gets real collector
// behaviour by default; only the in-flight-request lifecycle test below
// overrides it (via `mockImplementationOnce`, which self-restores after one
// call) to get a controllable pause point inside a live tool call.
vi.mock("../mcp/toolHandlers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mcp/toolHandlers")>();
  return { ...actual, handleCollectLogs: vi.fn(actual.handleCollectLogs) };
});

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

type PostMcpOptions = {
  sessionId?: string;
  origin?: string;
  env?: Env;
};

async function postMcp(body: JsonRpcRequest, options: PostMcpOptions = {}): Promise<Response> {
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(options.sessionId ? { "mcp-session-id": options.sessionId } : {}),
      ...(options.origin ? { origin: options.origin } : {})
    },
    body: JSON.stringify(body)
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, options.env ?? env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function openSseStream(sessionId: string, options: PostMcpOptions = {}): Promise<Response> {
  const request = new Request("http://localhost/mcp", {
    method: "GET",
    headers: {
      accept: "text/event-stream",
      "mcp-session-id": sessionId,
      ...(options.origin ? { origin: options.origin } : {})
    }
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, options.env ?? env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function initializeSession(options: PostMcpOptions = {}): Promise<string> {
  const response = await postMcp(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" }
      }
    },
    options
  );
  expect(response.status).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  await response.body?.cancel();

  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, { ...options, sessionId: sessionId ?? undefined });

  return sessionId as string;
}

describe("MCP endpoint origin validation", () => {
  it("rejects a hostile Origin with 403 and never reaches the transport", async () => {
    const response = await postMcp(
      { jsonrpc: "2.0", id: 1, method: "initialize" },
      { origin: "https://evil.example.com" }
    );
    expect(response.status).toBe(403);
  });

  it("allows the configured TrueForge origin", async () => {
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "trueforge", version: "0.1.4" } }
      },
      { origin: "http://localhost:8790" }
    );
    expect(response.status).toBe(200);
  });

  it("allows a localhost dev origin on any port", async () => {
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "dev", version: "0.0.1" } }
      },
      { origin: "http://localhost:5173" }
    );
    expect(response.status).toBe(200);
  });

  it("allows requests with no Origin header at all (non-browser clients)", async () => {
    const response = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "server-fetch", version: "0.0.1" } }
    });
    expect(response.status).toBe(200);
  });
});

describe("MCP endpoint", () => {
  it("rejects a non-initialize call with no known session", async () => {
    const response = await postMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(400);
  });

  it("issues a session id on initialize", async () => {
    const sessionId = await initializeSession();
    expect(sessionId).toMatch(/.+/);
  });

  it("discovers every tool this slice registers, with the destructive one annotated for approval", async () => {
    const sessionId = await initializeSession();
    const response = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      result: { tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[] };
    };
    const names = body.result.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "collect_deploys",
      "collect_logs",
      "collect_metrics",
      "get_diagnostic_script",
      "get_runbook",
      "propose_rollback"
    ]);

    const readOnlyTools = body.result.tools.filter((tool) => tool.name !== "propose_rollback");
    expect(readOnlyTools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const rollback = body.result.tools.find((tool) => tool.name === "propose_rollback");
    expect(rollback?.annotations?.readOnlyHint).toBe(false);
    expect(rollback?.annotations?.destructiveHint).toBe(true);
  });

  it("calls a read-only tool and returns evidence cards", async () => {
    const sessionId = await initializeSession();
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "collect_logs",
          arguments: { incidentId: "inc-mcp-1", service: "payment-service", signals: ["timeout", "error_rate"] }
        }
      },
      { sessionId }
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    expect(body.result.isError).toBeFalsy();
    const cards = JSON.parse(body.result.content[0]?.text ?? "[]") as { source: string }[];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "logs")).toBe(true);
  });

  it("calls get_diagnostic_script and returns a runnable, deterministic script", async () => {
    const sessionId = await initializeSession();
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "get_diagnostic_script",
          arguments: { service: "payment-service", signals: ["timeout", "error_rate"] }
        }
      },
      { sessionId }
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0]?.text ?? "{}") as {
      runbookId: string;
      script: string;
      expectedOutput: string;
    };
    expect(payload.runbookId).toBe("checkout-failure");
    expect(payload.script).toContain("#!/usr/bin/env python3");
    expect(payload.expectedOutput.length).toBeGreaterThan(0);
  });

  it("refuses get_diagnostic_script with an MCP error when no runbook matches", async () => {
    const sessionId = await initializeSession();
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "get_diagnostic_script",
          arguments: { service: "totally-unknown-service", signals: ["nope"] }
        }
      },
      { sessionId }
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    expect(body.result.isError).toBe(true);
  });

  it("calls propose_rollback and confirms nothing was executed", async () => {
    const sessionId = await initializeSession();
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "propose_rollback",
          arguments: { service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" }
        }
      },
      { sessionId }
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { result: { content: { type: string; text: string }[] } };
    const payload = JSON.parse(body.result.content[0]?.text ?? "{}") as { executed: boolean; gate: { state: string } };
    expect(payload.executed).toBe(false);
    expect(payload.gate.state).toBe("locked");
  });
});

describe("MCP session lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts an idle session past its TTL and rejects a follow-up as unknown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "1000" };

    const sessionId = await initializeSession({ env: shortTtlEnv });

    vi.setSystemTime(5000); // well past the 1000ms idle TTL, no requests in between

    const followUp = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(followUp.status).toBe(400);
  });

  it("does not evict a session that keeps getting used before its TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "1000" };

    const sessionId = await initializeSession({ env: shortTtlEnv });

    vi.setSystemTime(700); // under the TTL — this request should refresh lastUsedAt
    const first = await postMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId, env: shortTtlEnv });
    expect(first.status).toBe(200);

    vi.setSystemTime(1300); // 600ms after the refresh above, still under the 1000ms TTL
    const second = await postMcp({ jsonrpc: "2.0", id: 3, method: "tools/list" }, { sessionId, env: shortTtlEnv });
    expect(second.status).toBe(200);
  });

  it("evicts the oldest session, not the newest, once the capacity cap is exceeded", async () => {
    const cappedEnv: Env = { ...env, MCP_MAX_SESSIONS: "2" };

    const oldestId = await initializeSession({ env: cappedEnv });
    const middleId = await initializeSession({ env: cappedEnv });
    const newestId = await initializeSession({ env: cappedEnv });

    const oldestResponse = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId: oldestId, env: cappedEnv }
    );
    expect(oldestResponse.status).toBe(400);

    const middleResponse = await postMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { sessionId: middleId, env: cappedEnv }
    );
    expect(middleResponse.status).toBe(200);

    const newestResponse = await postMcp(
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      { sessionId: newestId, env: cappedEnv }
    );
    expect(newestResponse.status).toBe(200);
  });
});

describe("MCP session lifecycle — active work is not idle-evicted", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not evict a session with an open GET/SSE stream, even past the idle TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "1000" };

    const sessionId = await initializeSession({ env: shortTtlEnv });

    const stream = await openSseStream(sessionId, { env: shortTtlEnv });
    expect(stream.status).toBe(200);

    vi.setSystemTime(5000); // well past the 1000ms idle TTL, stream still open

    // Any request runs pruneExpiredSessions as a side effect — this is what
    // must skip the session above because it still has active work.
    const followUp = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(followUp.status).toBe(200);

    await stream.body?.cancel();
  });

  it("resumes the idle countdown once the SSE stream closes, and evicts after a further TTL elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "1000" };

    const sessionId = await initializeSession({ env: shortTtlEnv });

    const stream = await openSseStream(sessionId, { env: shortTtlEnv });
    expect(stream.status).toBe(200);

    vi.setSystemTime(5000); // past the TTL, but the stream is still open — not idle yet

    // Client disconnects: cancelling the body is what a dropped connection
    // looks like from the server's side. This must bring the session's
    // active-work counter back to zero and stamp a fresh lastUsedAt.
    await stream.body?.cancel();

    // Immediately after the close, the session must still be usable — the
    // idle clock only just restarted.
    const rightAfterClose = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(rightAfterClose.status).toBe(200);

    vi.setSystemTime(5000 + 1300); // past the TTL again, measured from the close, not from stream-open

    const afterTtlFromClose = await postMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(afterTtlFromClose.status).toBe(400);
  });

  it("does not evict a session with an in-flight non-SSE request", async () => {
    // Real timers here, deliberately: this test needs two genuinely
    // concurrent, overlapping `app.fetch` calls (one gated open, one that
    // triggers pruning while the first is still in flight), and the exact
    // elapsed time doesn't matter — only that it exceeds the TTL below
    // while the tool call is still gated.
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "10" };

    const sessionId = await initializeSession({ env: shortTtlEnv });

    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseTool!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    vi.mocked(handleCollectLogs).mockImplementationOnce(async () => {
      signalStarted();
      await gate;
      return [];
    });

    const inFlight = postMcp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "collect_logs",
          arguments: { incidentId: "inc-1", service: "payment-service", signals: ["timeout"] }
        }
      },
      { sessionId, env: shortTtlEnv }
    );

    await started;
    await new Promise((resolve) => setTimeout(resolve, 50)); // well past the 10ms TTL, tool call still gated

    const pruneTrigger = await postMcp(
      {
        jsonrpc: "2.0",
        id: 99,
        method: "initialize",
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "other", version: "0.0.1" } }
      },
      { env: shortTtlEnv }
    );
    expect(pruneTrigger.status).toBe(200);
    await pruneTrigger.body?.cancel();

    releaseTool();
    const toolResponse = await inFlight;
    expect(toolResponse.status).toBe(200);

    const followUp = await postMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(followUp.status).toBe(200);
  });

  it("existing idle-TTL and capacity behaviour is unaffected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const shortTtlEnv: Env = { ...env, MCP_SESSION_IDLE_TTL_MS: "1000" };

    const sessionId = await initializeSession({ env: shortTtlEnv });
    vi.setSystemTime(5000); // idle the whole time, no stream, no in-flight request

    const followUp = await postMcp(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { sessionId, env: shortTtlEnv }
    );
    expect(followUp.status).toBe(400);
  });
});
