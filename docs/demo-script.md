# Demo video script

The hackathon asks for "a demo video of about three minutes showing the agent
working." This is the shot list that video follows: what is on screen, what is
said, and the exact command or click that produces it.

Total target: **3:00**. Timings are cumulative.

## Before recording

```bash
# 1. TrueForge on :8790 — logs "local sandbox fallback is available" at startup
npx @truefoundry/trueforge

# 2. RunProof backend + console
./scripts/dev.sh

# 3. Register the MCP server and a model provider
cd backend
export GEMINI_API_KEY="..."      # free, no card: https://aistudio.google.com/apikey
npm run trueforge:setup
```

A model provider is required for beats 3–5. Without it the agent cannot take a
turn, and the video falls back to showing tool discovery only — which does not
match the wording of the requirement. Get the key first.

Have ready in separate tabs: a terminal, the TrueForge UI, the console at
`http://localhost:3000/app`, and `backend/src/domain/approval.ts` in an editor.

The one gotcha: a run needs a runbook whose trigger matches. Only one ships, and
it triggers on service **`payment-service`** with signals **`timeout`** and
**`error_rate`**. File the incident against anything else and the run fails with
`no_matching_runbook`.

---

## 0:00–0:20 — The premise

**Screen:** the landing page at `/`.

> "When an alert fires at 3am, an agent is the most useful and the most
> dangerous thing you can point at production. RunProof splits that in half.
> Reading logs, metrics, deploy history — that's free, and the agent does it
> alone. Rolling back a deploy is not. Looking is free; touching needs a
> signature."

## 0:20–0:50 — TrueForge discovers the tools

**Screen:** terminal.

```bash
curl -s localhost:8790/api/v1/mcp-servers/runproof/tools | jq '.[] | {name, annotations}'
```

**Point at the annotations as they scroll.**

> "TrueForge is the harness. It found RunProof's six tools over MCP. Five are
> marked `readOnlyHint`. One — `propose_rollback` — is marked
> `destructiveHint`. RunProof never tells TrueForge which calls to gate. It
> just declares what each tool does, and TrueForge's default policy,
> `require_approval_for_tools: ["@write", "@destructive"]`, matches on that
> annotation."

## 0:50–1:30 — The agent works

**Screen:** TrueForge, running a turn against the `payment-service` alert.

> "The agent matches the runbook the team already wrote, then gathers only what
> that runbook authorizes — logs, metrics, deploys. If it asked for a source the
> runbook doesn't list, RunProof refuses the call. That check is in RunProof's
> domain layer, not in a prompt."

**Then the diagnostic:**

> "It asks for a diagnostic script. RunProof hands back script *text* — it's a
> Cloudflare Worker, it has no shell, no filesystem, no subprocess. TrueForge's
> sandbox runs it and hands stdout back."

## 1:30–2:00 — The gate holds

**Screen:** TrueForge pausing on the approval prompt.

> "Now it proposes a rollback. TrueForge stops the turn and waits — that's the
> `destructiveHint` annotation doing its job. Nothing has executed. And if I
> allow it, RunProof's own handler still only mints a *locked* gate and returns
> it. Two independent systems, both refusing to act."

## 2:00–2:35 — A human signs

**Screen:** the console, Approval tab.

> "Here's the same decision from the operator side. Evidence packet on the
> left. The gate is locked, and the run response has no `execution` field —
> nothing has run."

**Approve it. Show the audit log.**

> "Approving is the only thing in the system that mints an `ApprovalToken`, and
> that token is a mandatory argument to the one function that can change state.
> Not a runtime check a route could forget — a compile error. And the audit log
> has who approved what, and when."

## 2:35–3:00 — Why you can trust the gate

**Screen:** `backend/src/domain/approval.ts`, on the `WeakSet`.

> "This line exists because of a code review. In PR #1 the token was branded
> with a TypeScript `unique symbol`. It typechecked. It looked airtight. Qodo
> pointed out the brand is erased at runtime — so any hand-built object with a
> matching `actionId` could type-cast straight past the check and authorize a
> rollback. The safety property this whole project exists for was false, and
> the type system was the reason it looked true."

**Cut to `testing/tests/safety/bypass.test.ts`.**

> "The fix was a module-private `WeakSet` identity check, and the finding became
> a permanent test that tries to forge a token every way a caller might — 
> including a JSON round-trip of a real one. Thirty-three pull requests, every
> one reviewed. Several fixes introduced the next finding. That's the trail."

---

## What not to do

- Don't narrate the architecture diagram. Show the software running.
- Don't claim the rollback touches production. It is simulated, and the README
  says so — a judge who catches one overclaim discounts everything else.
- Don't skip the annotations shot at 0:20. It is the single clearest piece of
  evidence that TrueForge is the harness rather than a dependency.
