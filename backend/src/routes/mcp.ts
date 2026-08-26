import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../index";
import { createRunProofMcpServer } from "../mcp/server";

const SESSION_ID_HEADER = "mcp-session-id";

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
