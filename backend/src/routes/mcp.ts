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
};

/**
 * Sessions keyed by the id TrueForge is issued at `initialize`, kept in a
 * process-local Map. That is correct for the single long-lived
 * `wrangler dev` process this project runs against for the hackathon (see
 * docs/trueforge-setup.md) — a horizontally-scaled production Workers
 * deployment would need a Durable Object per session instead, since
 * separate requests can land on separate isolates there.
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

/** Removes every session idle for longer than `idleTtlMs`, as of `now`. */
function pruneExpiredSessions(now: number, idleTtlMs: number): void {
  for (const [sessionId, session] of sessions) {
    if (now - session.lastUsedAt > idleTtlMs) {
      evictSession(sessionId, session);
    }
  }
}

/** Evicts the least-recently-used session(s) until the map is back at or under `maxSessions`. */
function evictOldestOverCapacity(maxSessions: number): void {
  while (sessions.size > maxSessions) {
    const oldest = sessions.entries().next();
    if (oldest.done) return;
    const [sessionId, session] = oldest.value;
    evictSession(sessionId, session);
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
  if (now - session.lastUsedAt > idleTtlMs) {
    evictSession(sessionId, session);
    return undefined;
  }
  touchSession(sessionId, session, now);
  return sessions.get(sessionId);
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

  const existing = existingSession(c.req.header(SESSION_ID_HEADER), now, idleTtlMs);
  if (existing) {
    return await existing.transport.handleRequest(c.req.raw);
  }

  const server = createRunProofMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport, lastUsedAt: Date.now() });
      evictOldestOverCapacity(maxSessions);
    },
    onsessionclosed: async (sessionId) => {
      sessions.delete(sessionId);
      await server.close();
    }
  });

  await server.connect(transport);
  return await transport.handleRequest(c.req.raw);
});
