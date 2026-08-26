# RunProof

RunProof is an evidence-gated runbook executor for incident response, built for
**The Agent Harness Hackathon** ("Give AI models a License to act").

When an alert fires, an agent follows a runbook the team already wrote: it reads
logs, metrics, and deploy history, runs a diagnostic in a sandbox, assembles an
evidence packet, and proposes a remediation — which stays **locked** until a human
approves it.

> Looking is free. Touching needs a signature.

## Why the approval gate is the point

Incident response is exactly the place an autonomous agent is most tempting and
most dangerous: the pressure to act fast is highest, and the actions available
(rollback a deploy, restart a service, page someone) are hard to undo. RunProof's
premise is that an agent should be free to gather and reason about evidence — that
part is safe and reversible — but the moment it wants to change production state,
a human has to look at the same evidence and explicitly sign off.

That split is enforced twice, independently:

1. **TrueForge's approval checkpoint.** RunProof's `propose_rollback` MCP tool is
   annotated `destructiveHint: true`. TrueForge's default
   `require_approval_for_tools: ["@write", "@destructive"]` matches on that
   annotation and pauses the agent's turn — emitting a `ToolApprovalRequiredEvent`
   — until a human sends an explicit `allow`/`deny` decision. Read-only tools
   (`collect_logs`, `collect_metrics`, `collect_deploys`, `get_runbook`,
   `get_diagnostic_script`) are all `readOnlyHint: true` and are never gated.
2. **RunProof's own domain-level gate**, behind that checkpoint. Even after
   TrueForge's human approves the tool call, RunProof does not execute anything —
   it mints an `ApprovalGate` in the **locked** state and returns it. Actually
   flipping that gate to approved, and then executing the change, requires a
   branded `ApprovalToken` that only `approveGate()` can mint
   (`backend/src/domain/approval.ts`). Calling the state-changing executor without
   one is a **compile error**, not a runtime check that could be forgotten —
   `executeStateChanging` is typed to accept nothing else.

Two independent locks, not one swapped for the other. See
[`docs/writeup.md`](docs/writeup.md) for the full argument, including how the
token is made non-forgeable at runtime (a `WeakSet` identity check, since the
`unique symbol` brand TypeScript uses is erased at runtime and can't stop a
hand-built object from type-casting its way past a naive check).

## Architecture

```text
                     ┌─────────────────────────┐
   incident alert →  │   TrueForge (harness)    │
                     │  - runs the agent turn   │
                     │  - discovers MCP tools    │
                     │  - @destructive approval  │  ← human stops it here
                     │    checkpoint             │
                     │  - sandbox (local /       │
                     │    Daytona) for code exec │
                     └────────────┬─────────────┘
                                  │ MCP over HTTP (/mcp)
                     ┌────────────▼─────────────┐
                     │   RunProof (this repo)    │
                     │   Cloudflare Worker,       │
                     │   no execution surface     │
                     │                            │
                     │  MCP tools (backend/src/mcp)│
                     │  - collect_logs            │
                     │  - collect_metrics         │
                     │  - collect_deploys         │
                     │  - get_runbook             │
                     │  - get_diagnostic_script    │
                     │  - propose_rollback (💥)    │
                     │                            │
                     │  Domain layer (backend/src/domain)
                     │  - runbook matching + scope │
                     │  - evidence packet assembly │
                     │  - ApprovalToken / gate     │
                     └────────────────────────────┘
```

- **TrueForge is the harness.** It runs the agent loop, discovers RunProof's
  tools over MCP, decides which tool calls need a human in the loop (via the
  `destructiveHint`/`readOnlyHint` annotations RunProof's tools declare), and
  provides the sandbox that actually executes the diagnostic script RunProof
  hands back.
- **RunProof is a remote MCP server plus a domain layer**, not a thin wrapper
  around TrueForge. The runbook-scope enforcement (an MCP tool call is refused
  if the matched runbook doesn't authorize that evidence source), the evidence
  packet assembly, and the non-forgeable approval gate are all RunProof's own
  logic, independent of TrueForge.
- **RunProof never executes code.** It is a Cloudflare Worker with no shell, no
  filesystem, no subprocess. `get_diagnostic_script` only returns script text;
  TrueForge's sandbox (local fallback, or Daytona when hosted) is what runs it.
- A polished Next.js frontend (`frontend/`) presents the evidence packet, the
  locked/approved gate state, and a disclosed risk-score display — see
  [What is NOT built](#what-is-not-built) for what that score actually is.

## Repository structure

```text
.
├── backend/                 # RunProof: Cloudflare Worker (Hono) + MCP server
│   ├── src/domain/          # runbook, evidence, action, approval gate
│   ├── src/mcp/             # the 6 MCP tools + collectors
│   ├── src/routes/mcp.ts    # /mcp transport, Origin allow-list, sessions
│   └── scripts/             # register-mcp-server.mjs, register-model-provider.mjs
├── frontend/                 # Next.js product UI (evidence packet, approval flow)
├── testing/
│   ├── runbooks/             # checkout-failure.json
│   ├── fixtures/             # fixed logs/deploys snapshot the diagnostic reads
│   └── tests/
└── docs/
    ├── trueforge-setup.md    # step-by-step TrueForge integration + judge walkthrough
    ├── writeup.md            # the agent's job, and the two-gate safety argument
    ├── runbook-format.md
    └── cloudflare-deployment.md
```

## How to run it

You need: Node 18+, a local [TrueForge](https://github.com) instance (verified
against v0.1.4), and — only for a full end-to-end agent turn — a free Gemini API
key. No API keys are committed anywhere in this repo.

**1. Start TrueForge** on `http://localhost:8790`. No Daytona account is needed —
TrueForge logs a "local sandbox fallback is available" message at startup and
uses that instead.

**2. Start the RunProof backend:**

```bash
cd backend
npm install
npm run dev   # wrangler dev, http://localhost:8787
curl http://localhost:8787/health   # {"status":"ok","service":"runproof-api"}
```

**3. Register RunProof's MCP server and a model provider with TrueForge:**

```bash
cd backend
npm run register:mcp             # PUTs the MCP manifest, verifies tool discovery
export GEMINI_API_KEY="..."      # free, no card: https://aistudio.google.com/apikey
npm run register:model           # registers gemini-2.0-flash as the model provider
# or do both in one step:
npm run trueforge:setup
```

Tool discovery works with **zero** model configuration — `GET
/api/v1/mcp-servers/runproof/tools` will list all 6 tools right after step 3's
first command. The model provider is only needed to drive a live agent turn.

**4. (Optional) Run the frontend:**

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

Full step-by-step detail, including exactly what a judge should expect to see at
each stage (tool discovery → a read-only call → the sandboxed diagnostic →
`propose_rollback` pausing for approval), is in
[`docs/trueforge-setup.md`](docs/trueforge-setup.md).

### Verification

```bash
cd backend && npm test && npm run typecheck   # 168 tests, clean typecheck
cd frontend && npm run lint && npm run typecheck && npm run build
```

## Qodo Code Review Evidence

All four merged PRs went through a full Qodo review cycle. This section is meant
as evidence of a working review loop, not a trophy list — the most interesting
fact is that **several fixes introduced the next finding**, caught by re-review
rather than by the original author.

| PR | Subject | Notable findings Qodo raised and we fixed |
|---|---|---|
| [#1](https://github.com/sahil9001/evidence-gated-runbook-executor/pull/1) | Backend foundation + approval gate | Forged tokens passed authorization — the `unique symbol` brand is erased at runtime, so `tokenAuthorizes` accepted any object with a matching `actionId`; fixed with a module-private `WeakSet`. Approval permitted action substitution — a token was bound only to an id; fixed with a content fingerprint. That fingerprint then collided (`undefined` vs. a function both serialized to `undefined`; `NaN` vs. `null` both to `null`) — fixed with a type-tagged serializer over JSON-safe params. Backdated approvals and `NaN` expiry failing open. |
| [#2](https://github.com/sahil9001/evidence-gated-runbook-executor/pull/2) | Runbooks + evidence collectors | Cross-service evidence leakage — per-entry cards weren't filtered by `ctx.service`, so another service's logs could enter an evidence packet. Duplicate signals skewed runbook matching. Invalid action params were accepted. |
| [#3](https://github.com/sahil9001/evidence-gated-runbook-executor/pull/3) | TrueForge MCP server | Source allow-list bypass — MCP tools called collectors directly, skipping the runbook scope check that is the product's core safety property. Missing `Origin` validation (DNS rebinding against a localhost server). Sessions never expired. Active SSE sessions got evicted mid-stream. |
| [#4](https://github.com/sahil9001/evidence-gated-runbook-executor/pull/4) | Sandboxed diagnostic step | Whitespace-only diagnostics were accepted. |

**Fixes that caused the next finding:**
- PR #1's fingerprint serializer exists *because* fixing action substitution
  needed a content fingerprint — and that fingerprint's own edge cases
  (`undefined`/function, `NaN`/`null`) were the next thing Qodo caught.
- PR #2's evidence-leakage fix tightened `createAction`'s validation, which is
  part of what surfaced the loose `runbookSchema` gap re-review flagged.
- PR #3's SSE eviction bug was introduced by adding the session idle-TTL that
  the *previous* finding ("sessions never expired") required.

**Two findings we did not fix, and why:**
- **PR #1 — "Serializer breaks strict typecheck."** Disputed: `npm run
  typecheck` exits 0 against `tsc --noEmit`, so there was nothing to fix at the
  time. It became moot later anyway — a subsequent rewrite removed the disputed
  line entirely.
- **PR #3 — "Sessions break across Worker instances."** Documented rather than
  fixed. The MCP session map in `backend/src/routes/mcp.ts` is process-local;
  `wrangler dev` runs a single isolate, so this is latent in local dev, and a
  Durable Object per session is the correct fix for a horizontally scaled
  deployment. We chose an honest, documented limitation over a rushed migration
  this close to the deadline — see "Known limitations" in
  [`docs/trueforge-setup.md`](docs/trueforge-setup.md#known-limitations-local-dev-scope).

## What is NOT built

Being direct about this because a judge who spots one overclaim discounts
everything else in the submission:

- **No live end-to-end agent turn has been demonstrated.** Tool discovery is
  verified (`GET /api/v1/mcp-servers/runproof/tools` returns all 6 tools with
  correct annotations against a running TrueForge instance). Driving a full
  turn — an agent actually calling the tools, hitting the approval checkpoint,
  and having a human resolve it — requires a configured model provider, which
  this submission does not ship a key for. `docs/trueforge-setup.md` documents
  the exact steps and expected output for a judge to run this themselves.
- **The rollback is simulated.** `propose_rollback` never touches a real
  production system. Even after TrueForge's human approves the tool call, it
  only mints a locked RunProof `ApprovalGate` — no infrastructure API is called.
- **The UI risk score is a disclosed display heuristic**, not a computed risk
  model. It's derived from evidence confidence for presentation purposes; it is
  not a statistical or ML-based risk assessment.
- **The local sandbox fallback is not real isolation.** It runs the diagnostic
  script on the TrueForge host process with host permissions — a convenience
  for local dev, not a security boundary. Daytona provides actual sandbox
  isolation for hosted TrueForge deployments; RunProof works with either, but
  only the local fallback has been exercised here.
- **No CI workflow** runs on this repository. Tests and typecheck are run
  manually (`npm test`, `npm run typecheck` in `backend/`).
- **No authentication exists yet.** The domain layer's `approvedBy` field is
  free text with no identity verification behind it (see decision D5 in
  `docs/IMPLEMENTATION-STATUS.md`) — there is no login flow, and consequently
  no rate limiting on one. This is a vertical-slice prototype, not a
  production-hardened multi-tenant system.

## Live deployment

A frontend build has previously been deployed to
`https://runproof-frontend.sahilsilare.workers.dev` via OpenNext/Wrangler; it
serves the product UI only and is not wired to a live TrueForge instance or a
running backend. Judges should follow "How to run it" above to see the actual
system, not the static deployment.

## Further reading

- [`docs/writeup.md`](docs/writeup.md) — the agent's job, and the full safety
  argument for the two independent approval gates.
- [`docs/trueforge-setup.md`](docs/trueforge-setup.md) — step-by-step TrueForge
  integration, including exactly what a judge should expect to see.
- [`docs/runbook-format.md`](docs/runbook-format.md) — the runbook schema and
  why it's JSON, not YAML.
- [`docs/cloudflare-deployment.md`](docs/cloudflare-deployment.md) — deployment
  notes for the frontend.
- [`docs/roadmap.md`](docs/roadmap.md) — remaining work beyond this slice.
