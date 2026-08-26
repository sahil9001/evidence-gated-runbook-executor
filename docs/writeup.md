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

## The safety argument: two independent gates

The core safety claim is that an irreversible action requires two separate,
independently-enforced approvals — not one approval implemented twice.

**Gate 1 — TrueForge's approval checkpoint (runtime, harness-level).**
`propose_rollback` is annotated `destructiveHint: true`. When the agent calls it,
TrueForge emits a `ToolApprovalRequiredEvent` and pauses the turn. Only after a
human sends an explicit `UserToolApprovalEvent` with `allow` does TrueForge let
the call through to RunProof's handler. This gate lives entirely in TrueForge and
would stop *any* MCP tool annotated this way, regardless of what RunProof does
internally.

**Gate 2 — RunProof's approval gate (compile-time-enforced, domain-level).**
Even after TrueForge's human approves the tool call, RunProof's handler does not
execute a rollback. It creates an `Action`, opens an `ApprovalGate` in the
**locked** state via `createGate`, and returns that — locked — gate in the tool
result. Nothing has happened to production yet.

Getting from a locked gate to an executed action requires an `ApprovalToken`:

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

`approveGate()` is the only function in the codebase that can produce a value of
this type. `executeStateChanging(action: Action, token: ApprovalToken)` — the
function that actually performs a state-changing action — requires one as a
parameter. **Calling it without a real token is a TypeScript compile error, not
a check that a future refactor could accidentally skip.** There is no code path
where "forgot to check for approval" compiles.

That said, a `unique symbol` brand is erased by the TypeScript compiler — at
runtime it leaves no trace on the object. A hand-built object with a matching
shape (from JSON, from D1, from any untyped boundary) could type-cast its way
past the *type system* and still fail at *runtime*, because `tokenAuthorizes`
doesn't trust the shape — it checks a module-private `WeakSet` of objects that
`approveGate()` actually minted in this process. Only real tokens are members.
This is why the type brand alone isn't the safety mechanism — it's the WeakSet
identity check backing it that is. (One consequence: tokens are intentionally
not serializable — they must never survive a JSON round-trip, D1 write, or
`structuredClone`. If an approval needs to persist, the plain, serializable
`ApprovalGate` is what gets persisted, never the token.)

The token is also bound to more than an id: it carries an `actionFingerprint`
computed by a type-tagged deterministic serializer over the action's content, so
an approval granted for one action's exact parameters can't be silently reused
for a different action that happens to share an id. (This fingerprinting logic
is itself the subject of one of the fixes described in the README's Qodo
section — the serializer's edge cases were caught and closed by re-review.)

So: TrueForge stops the agent before the tool call reaches RunProof at all.
RunProof stops itself again before that approved call turns into an executed
change, using a mechanism the type checker enforces and a runtime identity check
backs up. Removing either gate individually still leaves the other standing.

## Honesty

See the README's ["What is NOT built"](../README.md#what-is-not-built) section
for the complete list of what this submission does and does not demonstrate —
in particular, that a full end-to-end agent turn (tool discovery through a
human resolving the approval prompt) has not been run against a live model
provider as part of this submission, only verified up through tool discovery.
