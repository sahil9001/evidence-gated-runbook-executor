#!/usr/bin/env node
// Registers RunProof's MCP endpoint with a running TrueForge instance.
//
// Usage:
//   node scripts/register-mcp-server.mjs
//
// Env vars (all optional, defaults match local dev):
//   TRUEFORGE_URL      TrueForge base URL     (default http://localhost:8790)
//   RUNPROOF_MCP_URL   RunProof's MCP URL     (default http://localhost:8787/mcp)
//   MCP_SERVER_NAME    Name to register under (default runproof)
//
// Uses PUT (create-or-replace), so re-running this script is safe and
// idempotent — it will not fail if "runproof" is already registered.

const trueforgeUrl = process.env.TRUEFORGE_URL ?? "http://localhost:8790";
const runproofMcpUrl = process.env.RUNPROOF_MCP_URL ?? "http://localhost:8787/mcp";
const name = process.env.MCP_SERVER_NAME ?? "runproof";

const manifest = {
  type: "remote",
  name,
  url: runproofMcpUrl,
  description:
    "RunProof evidence-gated incident response: read-only log/metric/deploy collectors " +
    "and runbook matching, plus a destructive propose_rollback tool that requires human " +
    "approval and never executes automatically."
};

const endpoint = `${trueforgeUrl}/api/v1/settings/mcp-servers`;

console.log(`Registering "${name}" -> ${runproofMcpUrl} with TrueForge at ${trueforgeUrl} ...`);

const response = await fetch(endpoint, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ manifest })
});

const body = await response.json().catch(() => undefined);

if (!response.ok) {
  console.error(`Registration failed: HTTP ${response.status}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`Registered (HTTP ${response.status}):`);
console.log(JSON.stringify(body, null, 2));

console.log("\nVerifying tool discovery ...");
const toolsResponse = await fetch(`${trueforgeUrl}/api/v1/mcp-servers/${name}/tools`);
const tools = await toolsResponse.json().catch(() => undefined);

if (!toolsResponse.ok) {
  console.error(`Tool discovery check failed: HTTP ${toolsResponse.status}`);
  console.error(JSON.stringify(tools, null, 2));
  process.exit(1);
}

const toolNames = (tools?.data ?? []).map((tool) => tool.name);
console.log(`TrueForge discovered ${toolNames.length} tool(s): ${toolNames.join(", ")}`);
