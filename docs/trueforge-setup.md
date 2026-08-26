# Running RunProof as a TrueForge MCP server

RunProof's tools — evidence collectors and a gated rollback proposal — are exposed as
an MCP server that TrueForge calls over HTTP. RunProof no longer reimplements
tool-calling, sandboxing, or approval checkpoints; TrueForge provides those, and
RunProof supplies the tools plus its own independent domain-level approval gate
(`backend/src/domain/approval.ts`) as defence in depth behind TrueForge's checkpoint.

## 1. Start TrueForge

Start your local TrueForge instance (this was verified against v0.1.4 on
`http://localhost:8790`; local sandbox fallback, no Daytona account required).

## 2. Start the RunProof backend

```bash
cd backend
npm install
npm run dev   # wrangler dev, listens on http://localhost:8787
```

Confirm it's up:

```bash
curl http://localhost:8787/health
# {"status":"ok","service":"runproof-api"}
```

## 3. Register RunProof with TrueForge

```bash
cd backend
npm run register:mcp
```

This `PUT`s a manifest to `POST/PUT /api/v1/settings/mcp-servers`:

```json
{
  "manifest": {
    "type": "remote",
    "name": "runproof",
    "url": "http://localhost:8787/mcp",
    "description": "..."
  }
}
```

and then checks `GET /api/v1/mcp-servers/runproof/tools` to confirm TrueForge actually
discovered the tools. Override `TRUEFORGE_URL`, `RUNPROOF_MCP_URL`, or
`MCP_SERVER_NAME` as env vars if you're not running the defaults. The script uses
`PUT` (create-or-replace), so it's safe to re-run.

## What a judge should expect to see

1. **Tool discovery** — `GET /api/v1/mcp-servers/runproof/tools` lists 5 tools:
   `collect_logs`, `collect_metrics`, `collect_deploys`, `get_runbook` (all
   `readOnlyHint: true`), and `propose_rollback` (`readOnlyHint: false,
   destructiveHint: true`).
2. **Reaching a tool, no approval needed** — attach `runproof` to an agent
   (`AgentSpec.mcp_servers: [{ name: "runproof" }]`) and have it call `get_runbook`
   or `collect_logs`. These run immediately: TrueForge's default
   `require_approval_for_tools: ["@write", "@destructive"]` doesn't gate read-only
   tools.
3. **Stopping for a person** — have the agent call `propose_rollback`. Because it's
   annotated destructive, TrueForge emits a `ToolApprovalRequiredEvent` and pauses
   the turn until a human sends an `ApprovalDecision` (`allow`/`deny`) via
   `UserToolApprovalEvent`. Only after an explicit `allow` does RunProof's handler
   run — and even then it does not execute a rollback. It mints a RunProof
   `ApprovalGate` in the **locked** state (via the same `createGate`/`approveGate`
   machinery every other RunProof action goes through) and returns that in the tool
   result. A second, RunProof-native approval is still required to actually act —
   TrueForge's checkpoint and RunProof's gate are independent locks, not one
   swapped for the other.

## Attaching RunProof to an agent

```jsonc
// POST /api/v1/sessions
{
  "agent": {
    "spec": {
      "model": { "name": "<provider>/<model>" }, // requires a configured model provider
      "instructions": "You are RunProof's incident-response agent...",
      "mcp_servers": [{ "name": "runproof" }]
    }
  }
}
```

Then `POST /api/v1/sessions/{id}/turns` with a user message describing the incident,
and watch `GET /api/v1/sessions/{id}/turns/{turn_id}/events` for the
`ToolApprovalRequiredEvent` on `propose_rollback`.

**Note:** driving a full turn requires at least one model provider configured
(`PUT /api/v1/settings/model-providers`) — a fresh TrueForge instance ships with none
(`GET /api/v1/models` returns `{"data":[]}`). Tool registration and discovery (steps 1–3
above) work with zero model configuration; only the last "watch it actually run" step
needs an LLM API key.

## Origin allow-list

Per the MCP Streamable HTTP transport spec, `/mcp` validates the `Origin` header on
every request — required because these servers listen on localhost, where any page a
browser visits could otherwise POST to them (DNS rebinding) and drive every exposed
tool. `http://localhost` and `http://127.0.0.1` on any port are always allowed for
local development; anything else must be listed in the `ALLOWED_MCP_ORIGINS`
wrangler var (comma-separated). Requests with no `Origin` header at all — TrueForge's
own server-side `fetch`, or `register:mcp` — are allowed unconditionally: the attack
this guards against requires a browser, and browsers always send `Origin`. See
`backend/src/routes/mcp.ts`.

## Known limitations (local-dev scope)

- `backend/src/routes/mcp.ts` keeps MCP sessions in a process-local `Map`, correct for
  the single long-lived `wrangler dev` process this setup targets. A horizontally
  scaled production Workers deployment would need a Durable Object per session
  instead, since separate requests can land on separate isolates there.
- This repo does not run `wrangler deploy` or any `--remote` command as part of this
  workflow — everything above is local `wrangler dev` talking to a local TrueForge.
