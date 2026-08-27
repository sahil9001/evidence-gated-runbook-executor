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

**RunProof's own evidence-gated approval API is the second gate, and it is
now wired end to end.** `backend/src/domain/approval.ts` defines an
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

**That machinery now backs a real HTTP API.** `POST /incidents/:id/run`
collects evidence within the matched runbook's scope, builds the `Action`,
and opens a locked `ApprovalGate` — same as `propose_rollback`, and it
executes nothing either: the response has no `execution` field. `POST
/approvals/:id/approve` is the only thing that can change that. It:

1. Refuses with `409 insufficient_evidence` if the incident's evidence packet
   has zero cards — evidence-gated is enforced server-side, not just by
   disabling a button in the UI.
2. Atomically claims the run (a conditional `updateRunState` that only one of
   two concurrent approvals can win) before minting a token or executing
   anything, so a losing request gets `409 gate_already_decided` and never
   reaches the executor.
3. Calls `approveGate()` to mint the `ApprovalToken`, then hands it to
   `backend/src/domain/executor.ts`'s `executeStateChanging` — the only
   function that can perform a state-changing action, and one that makes a
   token a **mandatory** second positional argument with no overload or
   wrapper that omits it. Calling it without a token, or with a hand-built
   object shaped like one, is a compile error, not a runtime check a route
   author could forget. `executeStateChanging` also re-validates the token
   against the action's exact fingerprint at execution time, so a token
   minted for one action is rejected if replayed against another — see
   `testing/tests/safety/bypass.test.ts`, which tries to defeat this gate
   every way a caller might attempt it (including a JSON round-trip of a
   real token, which loses the `WeakSet` identity `tokenAuthorizes` checks)
   and asserts each attempt fails.

Execution is still simulated — `executeStateChanging` returns a descriptive
string and touches nothing real; see [Honesty](#honesty) below.

**What this does not yet do: connect to the live MCP flow.**
`handleProposeRollback` still mints its own `Action`/`ApprovalGate` purely in
memory and returns them in the tool result — it never calls RunProof's
store, so that gate cannot currently be looked up or approved through `POST
/approvals/:id`. An agent-proposed rollback (via MCP) and an operator
run/approve (via this HTTP API) are two separate flows built on the same
domain machinery, not one connected pipeline yet. Today, an agent-proposed
rollback is still stopped only by TrueForge's `@destructive` checkpoint
above — `propose_rollback` itself still returns a locked gate and executes
nothing. The new second gate is real and enforced, but it is reached through
RunProof's own API, not (yet) through `propose_rollback`.

## Honesty

See the README's ["What is NOT built"](../README.md#what-is-not-built) section
for the complete list of what this submission does and does not demonstrate —
in particular, that a full end-to-end agent turn (tool discovery through a
human resolving the approval prompt) has not been run against a live model
provider as part of this submission, only verified up through tool discovery.
