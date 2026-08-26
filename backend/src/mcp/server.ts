import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  handleCollectDeploys,
  handleCollectLogs,
  handleCollectMetrics,
  handleGetDiagnosticScript,
  handleGetRunbook,
  handleProposeRollback
} from "./toolHandlers";

const SERVER_NAME = "runproof";
const SERVER_VERSION = "0.1.0";

const collectArgsShape = {
  incidentId: z.string().min(1).describe("The incident this evidence is being gathered for"),
  service: z.string().min(1).describe("The service the incident is about"),
  signals: z
    .array(z.string().min(1))
    .describe(
      "Signals observed for this incident, e.g. ['timeout', 'error_rate']. Used to resolve the same " +
        "runbook get_runbook would match, so the collector can be refused if that runbook does not " +
        "authorize this source."
    )
};

/**
 * Builds a fresh RunProof `McpServer` and registers every tool this slice
 * exposes. Called per-request (see `routes/mcp.ts`) so a Worker never
 * shares MCP server state across isolates or requests — every tool
 * handler underneath is already stateless (fixture-backed collectors, pure
 * domain functions), so there is nothing worth keeping alive between calls.
 *
 * Read-only tools (`collect_*`, `get_runbook`, `get_diagnostic_script`) are
 * annotated `readOnlyHint: true` so TrueForge's default
 * `require_approval_for_tools: ["@write", "@destructive"]` does not stop
 * for them — this is the "reaching a tool" half of the demo.
 * `get_diagnostic_script` in particular only hands back text; TrueForge's
 * own sandbox (local fallback or a configured provider) is what actually
 * runs it once the calling agent takes that script and executes it there —
 * this is the "running code in the sandbox" half. RunProof does not
 * reimplement a sandbox of its own.
 *
 * `propose_rollback` is annotated `readOnlyHint: false, destructiveHint:
 * true` so TrueForge's `@destructive` selector (and its default `@write`
 * selector, since it is not read-only either way) catches it and pauses
 * for a human before the agent can call it — the "stopping for a person"
 * half. See `toolHandlers.ts` for what happens (and does not happen) once
 * it is finally called.
 */
export function createRunProofMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "collect_logs",
    {
      title: "Collect logs",
      description:
        "Gather log-derived evidence cards for an incident's service from RunProof's log source. " +
        "Refuses with an error if no runbook matches the given service/signals, or if the matched " +
        "runbook's allowedSources does not include logs.",
      inputSchema: collectArgsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) => textResult(await handleCollectLogs(args))
  );

  server.registerTool(
    "collect_metrics",
    {
      title: "Collect metrics",
      description:
        "Gather metric-derived evidence cards for an incident's service from RunProof's metrics source. " +
        "Refuses with an error if no runbook matches the given service/signals, or if the matched " +
        "runbook's allowedSources does not include metrics.",
      inputSchema: collectArgsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) => textResult(await handleCollectMetrics(args))
  );

  server.registerTool(
    "collect_deploys",
    {
      title: "Collect deploys",
      description:
        "Gather deploy-history evidence cards for an incident's service from RunProof's deploy source. " +
        "Refuses with an error if no runbook matches the given service/signals, or if the matched " +
        "runbook's allowedSources does not include deploys.",
      inputSchema: collectArgsShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (args) => textResult(await handleCollectDeploys(args))
  );

  server.registerTool(
    "get_runbook",
    {
      title: "Get runbook",
      description:
        "Match an incident's service and signals against RunProof's runbook set and return the matched " +
        "runbook — including allowedSources, the evidence sources this incident authorizes touching.",
      inputSchema: {
        service: z.string().min(1).describe("The service the incident is about"),
        signals: z.array(z.string().min(1)).describe("Signals observed for this incident, e.g. ['timeout', 'error_rate']")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => textResult(handleGetRunbook(args))
  );

  server.registerTool(
    "get_diagnostic_script",
    {
      title: "Get diagnostic script",
      description:
        "Return the diagnostic script a matched runbook authorizes running, plus a description of what " +
        "it checks and what its output means, so the calling agent can execute it in TrueForge's own " +
        "sandbox (RunProof never runs it) and interpret the result. Refuses with an error if no runbook " +
        "matches the given service/signals, if the matched runbook's allowedSources does not include " +
        "sandbox, or if the matched runbook has no diagnostic authored.",
      inputSchema: {
        service: z.string().min(1).describe("The service the incident is about"),
        signals: z.array(z.string().min(1)).describe("Signals observed for this incident, e.g. ['timeout', 'error_rate']")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (args) => textResult(handleGetDiagnosticScript(args))
  );

  server.registerTool(
    "propose_rollback",
    {
      title: "Propose rollback",
      description:
        "Propose rolling back a service to a prior commit. This is a destructive, state-changing action: " +
        "it does not execute a rollback, and TrueForge must obtain human approval before it can even be called.",
      inputSchema: {
        service: z.string().min(1).describe("The service to roll back"),
        commit: z.string().min(1).describe("The commit to roll back to"),
        reason: z.string().min(1).describe("Why this rollback is being proposed")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
    },
    (args) => textResult(handleProposeRollback(args))
  );

  return server;
}

function textResult(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
