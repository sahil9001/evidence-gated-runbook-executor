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
 */
const sessions = new Map<string, McpSession>();

export const mcpRoute = new Hono<{ Bindings: Env }>();

function existingSession(sessionId: string | undefined): McpSession | undefined {
  return sessionId ? sessions.get(sessionId) : undefined;
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

  const existing = existingSession(c.req.header(SESSION_ID_HEADER));
  if (existing) {
    return await existing.transport.handleRequest(c.req.raw);
  }

  const server = createRunProofMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport });
    },
    onsessionclosed: async (sessionId) => {
      sessions.delete(sessionId);
      await server.close();
    }
  });

  await server.connect(transport);
  return await transport.handleRequest(c.req.raw);
});
