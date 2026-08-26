import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../index";
import { createRunProofMcpServer } from "../mcp/server";

const SESSION_ID_HEADER = "mcp-session-id";

/**
 * Origins always allowed for local development, regardless of
 * `ALLOWED_MCP_ORIGINS` configuration — any port on localhost/127.0.0.1.
 */
const DEV_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/
];

function parseConfiguredOrigins(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Validates the Origin header on every /mcp request, per the MCP
 * Streamable HTTP transport spec — required because these servers listen
 * on localhost, where any page a user's browser visits can otherwise POST
 * to them (DNS rebinding) and drive every exposed tool.
 *
 * A request with no Origin header at all is allowed: the attack this
 * guards against requires a browser, and browsers always send Origin on
 * cross-origin requests. A non-browser client — TrueForge's own
 * server-side fetch — sends no Origin and is unaffected.
 */
function isOriginAllowed(origin: string | undefined, env: Env): boolean {
  if (!origin) return true;
  if (DEV_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) return true;
  return parseConfiguredOrigins(env.ALLOWED_MCP_ORIGINS).includes(origin);
}

type McpSession = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastUsedAt: number;
  /**
   * Count of requests/streams currently in flight against this session — a
   * GET/SSE stream held open for the life of an agent turn, or a POST tool
   * call still being handled. `pruneExpiredSessions` never evicts a session
   * while this is > 0, no matter how stale `lastUsedAt` looks: a GET/SSE
   * stream is a single request that started once and then stays open, so
   * "time since the request started" is not the same thing as "idle".
   *
   * Incremented when work starts, decremented once it actually finishes —
   * immediately after the awaited response for POST/DELETE, or when the
   * stream closes (naturally, on error, or on client disconnect) for GET —
   * so it cannot leak upward and make a session immortal.
   */
  activeRequests: number;
};

/**
 * Sessions keyed by the id TrueForge is issued at `initialize`, kept in a
 * process-local Map. That is correct for the single long-lived
 * `wrangler dev` process this project runs against for the hackathon (see
 * docs/trueforge-setup.md) — a horizontally-scaled production Workers
 * deployment would need a Durable Object per session instead, since
 * separate requests can land on separate isolates there and this Map
 * would not be visible across them.
 *
 * This is transport-layer bookkeeping only. It has nothing to do with
 * RunProof's actual safety property: the domain-level `ApprovalGate` in
 * `../domain/approval.ts` is a separate, non-forgeable lock that
 * `toolHandlers.ts`'s `handleProposeRollback` still goes through on every
 * call, regardless of which MCP session invoked it.
 *
 * Insertion order doubles as recency order: `touchSession` deletes and
 * re-inserts a session's entry on every use, so `sessions.keys().next()`
 * always yields the least-recently-used session — the one both idle-TTL
 * pruning and capacity eviction treat as "oldest".
 *
 * Considered and rejected: `WebStandardStreamableHTTPServerTransport`
 * does support a fully stateless mode (`sessionIdGenerator: undefined` —
 * no session ID is ever issued, and the transport itself performs no
 * session validation). That would sidestep the cross-isolate problem
 * entirely, since there would be no server-side session state to be
 * inconsistent about. It was not adopted here because it is a strictly
 * bigger change than this bug warrants: it removes the session concept
 * this file's idle-TTL/capacity bounding (see `pruneExpiredSessions` /
 * `evictOldestOverCapacity`) exists to police, it would require every
 * request to spin up a fresh `McpServer` + transport pair (the SDK
 * explicitly requires a new transport per request in stateless mode), and
 * it would need re-verification against the live TrueForge integration
 * this slice already has working. `wrangler dev` — the only way this
 * project runs today — is a single isolate, so the bug this Map has is
 * latent, not active, in the environment this actually ships to for the
 * hackathon. See docs/trueforge-setup.md for the deployment-time fix.
 */
const sessions = new Map<string, McpSession>();

/** Default idle timeout for a session with no `MCP_SESSION_IDLE_TTL_MS` override. */
const DEFAULT_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
/** Default hard cap on concurrently held sessions with no `MCP_MAX_SESSIONS` override. */
const DEFAULT_MAX_SESSIONS = 500;

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSessionIdleTtlMs(env: Env): number {
  return parsePositiveIntEnv(env.MCP_SESSION_IDLE_TTL_MS, DEFAULT_SESSION_IDLE_TTL_MS);
}

function getMaxSessions(env: Env): number {
  return parsePositiveIntEnv(env.MCP_MAX_SESSIONS, DEFAULT_MAX_SESSIONS);
}

/** Closes and forgets a session, swallowing shutdown errors — this is best-effort cleanup, not a request path. */
function evictSession(sessionId: string, session: McpSession): void {
  sessions.delete(sessionId);
  void session.server.close().catch(() => {});
}

/**
 * Removes every idle session past `idleTtlMs`, as of `now` — but never one
 * with active work (`activeRequests > 0`). An open GET/SSE stream or an
 * in-progress tool call is not idle no matter how long ago its request
 * started; evicting it would sever a client mid-turn. See the
 * `activeRequests` doc on `McpSession`.
 */
function pruneExpiredSessions(now: number, idleTtlMs: number): void {
  for (const [sessionId, session] of sessions) {
    if (session.activeRequests > 0) continue;
    if (now - session.lastUsedAt > idleTtlMs) {
      evictSession(sessionId, session);
    }
  }
}

/** The least-recently-used session with no work in flight, if any. */
function findOldestIdleSession(): readonly [string, McpSession] | undefined {
  for (const entry of sessions) {
    if (entry[1].activeRequests === 0) return entry;
  }
  return undefined;
}

/** The most-recently-inserted session — last in the map's iteration order. */
function findNewestSession(): readonly [string, McpSession] | undefined {
  let newest: readonly [string, McpSession] | undefined;
  for (const entry of sessions) newest = entry;
  return newest;
}

/**
 * Evicts sessions until the map is back at or under `maxSessions`,
 * preferring the least-recently-used *idle* session — capacity pressure
 * should not sever a client mid-turn any more than the idle TTL should.
 *
 * If every session currently has work in flight (enough concurrent agent
 * turns to fill the cap), there is no idle victim. Evicting a busy session
 * to make room is worse than refusing growth, so the most-recently-admitted
 * session is evicted instead — ordinarily the one that just pushed the map
 * over capacity. Its `initialize` call still succeeds at the transport
 * level (the SDK has already committed to a response by the time this
 * runs), but the session record is gone immediately after, so its very
 * next request is rejected as unknown: this refuses the new session rather
 * than punishing an established, busy one.
 */
function evictOldestOverCapacity(maxSessions: number): void {
  while (sessions.size > maxSessions) {
    const victim = findOldestIdleSession() ?? findNewestSession();
    if (!victim) return;
    evictSession(victim[0], victim[1]);
  }
}

/** Marks a session as just-used: refreshes its TTL clock and moves it to the recent end of the LRU order. */
function touchSession(sessionId: string, session: McpSession, now: number): void {
  sessions.delete(sessionId);
  sessions.set(sessionId, { ...session, lastUsedAt: now });
}

export const mcpRoute = new Hono<{ Bindings: Env }>();

/**
 * Looks up a session by id, evicting it first if it has gone idle past its
 * TTL — a request that names an expired session is treated exactly like a
 * request that names no session at all (both fall through to the "unknown
 * session" 400 the transport itself already produces for non-initialize
 * calls). A session that is still alive gets its idle clock refreshed.
 */
function existingSession(sessionId: string | undefined, now: number, idleTtlMs: number): McpSession | undefined {
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (session.activeRequests === 0 && now - session.lastUsedAt > idleTtlMs) {
    evictSession(sessionId, session);
    return undefined;
  }
  touchSession(sessionId, session, now);
  return sessions.get(sessionId);
}

/** Increments a session's in-flight counter. No-op if it was already evicted (e.g. a capacity refusal). */
function incrementActive(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.set(sessionId, { ...session, activeRequests: session.activeRequests + 1 });
}

/**
 * Decrements a session's in-flight counter, floored at zero. Once it
 * reaches zero, `lastUsedAt` is stamped to `now` — the idle clock starts
 * fresh from the moment the work actually finished, not from when the
 * request that did that work started.
 */
function decrementActive(sessionId: string, now: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  const activeRequests = Math.max(0, session.activeRequests - 1);
  sessions.set(sessionId, { ...session, activeRequests, lastUsedAt: activeRequests === 0 ? now : session.lastUsedAt });
}

/**
 * Wraps a GET/SSE response's body so `onStreamEnd` fires exactly once,
 * whenever the stream actually stops moving bytes: natural completion, an
 * upstream read error, or the client cancelling (a disconnect). This is
 * what lets `activeRequests` track a long-lived SSE stream instead of just
 * the instant its opening request was accepted — `transport.handleRequest`
 * for a GET resolves immediately with the stream still open, so "the
 * request resolved" and "the work finished" are different moments here.
 */
function withTrackedStreamBody(response: Response, onStreamEnd: () => void): Response {
  const body = response.body;
  if (!body) {
    onStreamEnd();
    return response;
  }

  const reader = body.getReader();
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    onStreamEnd();
  };

  const tracked = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          finish();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    cancel(reason) {
      // The client disconnected. Forward the cancel to the SDK's own
      // stream so its existing cleanup (clearing the keep-alive timer,
      // removing the entry from the transport's internal stream map)
      // still runs — this wrapper only adds accounting on top of it.
      finish();
      return reader.cancel(reason);
    }
  });

  return new Response(tracked, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Finishes tracking a request's activity against `sessionId` once its
 * response is available: for GET, that means waiting for the SSE stream
 * body to actually close; for everything else, the response being ready
 * already means the work is done.
 */
function finishActivity(sessionId: string, method: string, response: Response): Response {
  if (method === "GET") {
    return withTrackedStreamBody(response, () => decrementActive(sessionId, Date.now()));
  }
  decrementActive(sessionId, Date.now());
  return response;
}

/**
 * Runs a request against an existing session, tracking it as active work
 * for exactly as long as it stays in flight.
 */
async function withSessionActivity(sessionId: string, method: string, run: () => Promise<Response>): Promise<Response> {
  incrementActive(sessionId);
  try {
    return finishActivity(sessionId, method, await run());
  } catch (error) {
    decrementActive(sessionId, Date.now());
    throw error;
  }
}

/**
 * One route handles GET (SSE stream), POST (JSON-RPC calls, including
 * `initialize`), and DELETE (session termination) — `handleRequest`
 * dispatches on `req.method` internally. A request carrying a known
 * `Mcp-Session-Id` is handed straight to that session's transport. A
 * request with no known session is only valid as a fresh `initialize`
 * call: a new server and transport are created and connected, and the
 * transport itself rejects anything that isn't actually an initialize
 * request (400) rather than this route guessing.
 */
mcpRoute.all("/", async (c) => {
  if (!isOriginAllowed(c.req.header("origin"), c.env)) {
    return c.json({ ok: false, error: { code: "forbidden_origin", message: "Origin not allowed" } }, 403);
  }

  const now = Date.now();
  const idleTtlMs = getSessionIdleTtlMs(c.env);
  const maxSessions = getMaxSessions(c.env);
  pruneExpiredSessions(now, idleTtlMs);

  const method = c.req.raw.method;
  const sessionIdHeader = c.req.header(SESSION_ID_HEADER);
  const existing = existingSession(sessionIdHeader, now, idleTtlMs);
  if (existing && sessionIdHeader) {
    return await withSessionActivity(sessionIdHeader, method, () => existing.transport.handleRequest(c.req.raw));
  }

  const server = createRunProofMcpServer();
  let newSessionId: string | undefined;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      newSessionId = sessionId;
      // Starts at 1, not 0: this very `initialize` call is itself active
      // work against the session it just created, for the rest of this
      // handler — see `finishActivity` below, which brings it back down.
      sessions.set(sessionId, { server, transport, lastUsedAt: Date.now(), activeRequests: 1 });
      evictOldestOverCapacity(maxSessions);
    },
    onsessionclosed: async (sessionId) => {
      sessions.delete(sessionId);
      await server.close();
    }
  });

  await server.connect(transport);
  try {
    const response = await transport.handleRequest(c.req.raw);
    return newSessionId ? finishActivity(newSessionId, method, response) : response;
  } catch (error) {
    if (newSessionId) decrementActive(newSessionId, Date.now());
    throw error;
  }
});
