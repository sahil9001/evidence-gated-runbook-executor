# RunProof — write-up

## The agent's job

RunProof's agent is an incident responder. When an alert fires for a service, the
agent's job is:

1. Look up the runbook that matches the alert's `service` + `signals` (`get_runbook`).
2. Gather evidence within the scope that runbook authorizes: logs, metrics, and
   deploy history (`collect_logs`, `collect_metrics`, `collect_deploys`).
3. Ask for a diagnostic script and run it in a sandbox (`get_diagnostic_script`,
   executed by TrueForge's sandbox, not by RunProof).
4. Assemble everything into an evidence packet and propose a remediation
   (`propose_rollback`).
5. Stop. A human decides whether the remediation actually happens.

Every one of those tool calls is scoped: an MCP tool refuses to return data from
a source the matched runbook doesn't list in `allowedSources`. The agent cannot
freelance its way to evidence — or an action — outside what the runbook it
matched actually authorizes. That scope check is enforced inside RunProof's
domain layer, not left to the agent's judgment or to prompt instructions.

Steps 1–3 are read-only and run without any human involvement — that's the
"looking is free" half of the premise. Step 4 is where "touching needs a
signature" kicks in.

## Where TrueForge fits

TrueForge is the harness: it runs the agent loop, discovers RunProof's tools over
MCP, decides when a human needs to approve a tool call, and provides the sandbox
that executes code. RunProof supplies the tools and the domain logic; it does not
reimplement any of the harness's job.

Concretely:

- **Tool discovery.** RunProof registers as a remote MCP server
  (`npm run register:mcp` PUTs a manifest to
  `POST/PUT /api/v1/settings/mcp-servers`). TrueForge then exposes RunProof's 6
  tools to any agent that lists `{ name: "runproof" }` in its `mcp_servers`.
- **Approval routing.** RunProof's tools declare `readOnlyHint` and
  `destructiveHint` annotations per the MCP tool-annotation convention.
  `propose_rollback` is the only tool with `destructiveHint: true`. TrueForge's
  default `require_approval_for_tools: ["@write", "@destructive"]` selector
  matches on exactly that annotation — RunProof doesn't tell TrueForge which
  calls to gate via any RunProof-specific config; it just tells the truth about
  what each tool does, and TrueForge's policy does the rest.
- **Sandboxed execution.** RunProof never runs code. `get_diagnostic_script`
  returns script text (a self-contained, stdlib-only Python script) plus a
  description of what it checks. TrueForge's sandbox — local fallback in this
  submission, or a configured Daytona provider in a hosted deployment — is what
  actually executes it and returns stdout back to the agent.

RunProof is not a thin wrapper that just forwards calls: the runbook matching,
the scope enforcement per tool call, the evidence-packet assembly, and the
approval-gate state machine are all RunProof's own domain logic
(`backend/src/domain/`), independent of and unaware of TrueForge's internals.
TrueForge is the only thing in the system that can execute code or grant tool
access; RunProof is the only thing that knows what a valid runbook, a valid
evidence packet, or a valid approval actually look like.

## The safety argument: what's enforced today, and what still isn't

**Gate — TrueForge's approval checkpoint (runtime, harness-level).**
`propose_rollback` is annotated `destructiveHint: true`. When the agent calls it,
TrueForge emits a `ToolApprovalRequiredEvent` and pauses the turn. Only after a
human sends an explicit `UserToolApprovalEvent` with `allow` does TrueForge let
the call through to RunProof's handler at all. This gate lives entirely in
TrueForge and stops the call before it ever reaches RunProof's code.

**What RunProof does once that call gets through: mints a locked gate, and
nothing more.** `handleProposeRollback` resolves the runbook that must
authorize the proposed action (see above), builds an `Action`, and opens an
`ApprovalGate` in the **locked** state via `createGate`. That locked gate is
the entire tool result — `executed` is always `false`. Nothing approves it as
part of this call, and nothing in this codebase turns a locked gate into a
production change.

**The domain layer has real, tested machinery for a second gate — it just
isn't wired to anything yet.** `backend/src/domain/approval.ts` defines an
`ApprovalToken`, a branded type only `approveGate()` can produce:

```typescript
declare const tokenBrand: unique symbol;

export type ApprovalToken = {
  readonly gateId: string;
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly [tokenBrand]: true;   // not exported — nothing outside this
                                  // module can construct this shape
};
```

The `unique symbol` brand is erased at runtime, so the actual non-forgeability
guarantee comes from a module-private `WeakSet`: `tokenAuthorizes` only
accepts objects `approveGate()` actually minted in this process, regardless of
shape — a hand-built object with a matching shape from JSON, D1, or any
untyped boundary is rejected even if it type-casts its way past the type
system. Each token is further bound to an `actionFingerprint`, computed by a
type-tagged deterministic serializer over the action's content, so approval
granted for one action's exact parameters can't be silently reused for a
different action that happens to share an id.

**That machinery is real and unit-tested, but that's as far as it goes on
`main`.** There is no HTTP route that calls `approveGate`, and there is no
`executeStateChanging` function or any other code path that takes an
`ApprovalToken` and performs a rollback. A second, token-gated enforcement
layer built on top of this machinery exists only on an unmerged branch, not
in this submission — **it is not implemented here.** Until it lands, the
only thing standing between an agent and an executed `propose_rollback` is
TrueForge's `@destructive` checkpoint above: `propose_rollback` itself
returns a locked gate and executes nothing, full stop.

## Honesty

See the README's ["What is NOT built"](../README.md#what-is-not-built) section
for the complete list of what this submission does and does not demonstrate —
in particular, that a full end-to-end agent turn (tool discovery through a
human resolving the approval prompt) has not been run against a live model
provider as part of this submission, only verified up through tool discovery.
