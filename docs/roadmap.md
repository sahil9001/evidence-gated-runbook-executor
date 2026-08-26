# RunProof Roadmap: What's Left to Build

This document explains the RunProof idea in plain language, records what actually
exists in the repository today, and lists the remaining work as concrete tasks.

---

## Part 1 — The Idea in Simple Terms

### The problem

Something breaks in production at 2am. The on-call engineer has to figure out
what happened and fix it, fast, while stressed and half awake.

An AI agent could help. But nobody wants an AI agent that can restart services,
roll back deploys, or edit production config on its own. One confident-but-wrong
action and a small incident becomes a large one.

So teams end up with two bad options:

- **A chatbot that only talks.** Safe, but the engineer still does all the work.
- **An agent that can act.** Fast, but you are trusting a guess with production.

### The RunProof answer

Give the agent a **hard split** between looking and touching.

**Looking is free. Touching needs a signature.**

RunProof lets the agent do all the tedious investigation work by itself — read
logs, pull metrics, check what deployed recently, run a diagnostic script in a
throwaway sandbox. None of that can damage anything, so none of it needs
permission.

But the moment the agent wants to do something real — roll back, restart, scale,
change a flag — it stops. It hands the human a packet that says:

> Here is what I found. Here is the evidence. Here is what I want to do,
> and here is exactly what it will touch. Approve or reject.

The engineer reads the proof, not the reasoning. Then they click Approve, and
*then* the action runs.

### The analogy

It works like a hospital or an airline. A junior does the full workup — reads the
charts, runs the tests, writes it all down — and presents a recommendation. A
senior signs off before anything irreversible happens. The junior is genuinely
useful and genuinely cannot hurt anyone.

### The three ideas that make it work

**1. Start from a runbook, not from scratch.**
The agent does not improvise. It picks a runbook the team already wrote —
`checkout-failure`, `db-connection-pool-exhausted` — and follows its steps.
The runbook defines what the agent may look at and what it may propose. This is
the *scope*: the agent cannot wander outside it.

**2. Every claim carries its receipt.**
The agent does not say "I think it's the latest deploy." It produces an
**evidence packet** — the actual log lines, the actual metric, the actual commit
SHA, the actual sandbox output. Each claim links to the raw data behind it. If
the evidence is thin, that shows too.

**3. The dangerous step is locked by default.**
Actions are tagged read-only or state-changing. Read-only runs immediately.
State-changing goes into an **approval gate** and sits there until a human
approves it. There is no "the agent decided it was safe enough" path. Locked is
the default and only a person unlocks it.

### What the user actually sees

```
  Alert fires
      ↓
  Agent picks the matching runbook
      ↓
  Agent reads logs, metrics, deploy history      ← no permission needed
      ↓
  Agent runs a diagnostic script in a sandbox    ← no permission needed
      ↓
  Agent writes an evidence packet + risk score
      ↓
  ┌─────────────────────────────────────┐
  │  APPROVAL GATE — nothing past here  │   ← waits for a human
  │  runs without a human clicking yes  │
  └─────────────────────────────────────┘
      ↓
  Action executes, and the whole run is recorded for replay
```

The frontend in this repo is a picture of exactly that flow: a risk score, an
evidence trail, and a locked Approve button.

---

## Part 2 — What Exists Today

**Built and deployed:** the marketing frontend, and nothing else.

| Area | State |
|---|---|
| `frontend/` | Real. Next.js 16 landing page, ~1,000 lines, live on Cloudflare Workers |
| `backend/src/domain/` | Empty (`.gitkeep`) |
| `backend/src/mcp/` | Empty (`.gitkeep`) |
| `backend/src/routes/` | Empty (`.gitkeep`) |
| `testing/runbooks/` | Empty (`.gitkeep`) |
| `testing/fixtures/` | Empty (`.gitkeep`) |
| `testing/prompts/` | Empty (`.gitkeep`) |
| `testing/tests/` | Empty (`.gitkeep`) |
| `docs/` | `cloudflare-deployment.md` and this file |

Everything the frontend displays is hardcoded. The risk score of `82`, the
four-step timeline, the sandbox output block, the workflow rows — all literal
arrays in `RunbookPreview.tsx` and `LandingSections.tsx`. There is no data layer
behind any of it.

There is also **no test tooling at all** — no test runner in `package.json`, no
CI workflow. Given the project's own 80% coverage standard, that is a gap to
close early rather than late.

**The useful part:** the frontend has already fixed the vocabulary. The backend
should implement these exact nouns, so the UI can be wired up without a
translation layer:

`Incident` · `Runbook` · `RunbookStep` · `EvidencePacket` · `EvidenceCard` ·
`SandboxRun` · `RiskScore` · `ApprovalGate` · `Action`

---

## Part 3 — Decisions to Lock First

These block real design work. Each has a recommendation, but they are the
project owner's call.

### D1. Backend runtime

**Recommended: a second Cloudflare Worker (Hono + TypeScript) in `backend/`.**
Keeps one deployment story, one language, and OpenNext already proved the
Cloudflare path works. Alternative: Next.js route handlers inside `frontend/` —
simpler, but merges the product surface with the engine.

### D2. State storage

**Recommended: D1 for incidents, packets, and the audit log; a Durable Object
per in-flight run** to hold live step state and stream progress to the UI.
Alternative: KV only, which is simpler but makes the audit log and any
list/filter query awkward.

### D3. Sandbox execution

**Recommended: Cloudflare Sandbox SDK** (`@cloudflare/sandbox`) for diagnostic
scripts. Native to the stack and isolated by construction. Alternative: a
container runner outside Cloudflare, which is more capable but a second
deployment target.

### D4. Evidence sources for v1

Real integrations are a lot of surface area. **Recommended: build against a
fixture-backed adapter first** — every collector reads from `testing/fixtures/`
behind the same interface a real integration would implement. This makes the
whole system demoable and testable before any credential exists.

### D5. Who approves

**Recommended for v1: a single shared operator view, no auth**, with the
approver's identity recorded as a free-text field. Real auth (D6) is a follow-on.
Do not ship this to a real production environment without it.

### D6. Is this a demo or a real tool?

The honest answer changes the whole plan. A demo needs Phases 1–7 with fixtures.
A real tool additionally needs auth, secret handling, rate limiting, and actual
production credentials — a substantially larger effort. **This roadmap is
written for the demo path**, with real-tool concerns flagged where they arise.

---

## Part 4 — Remaining Work

Phases are ordered by dependency. Each task lists where the code goes and what
"done" means.

### Phase 0 — Foundations

Do this before writing feature code, or the coverage standard becomes
unreachable retroactively.

| ID | Task | Location | Done when |
|---|---|---|---|
| F1 | Add a test runner (Vitest) with coverage reporting | `frontend/`, `backend/` | `npm test` and `npm run test:coverage` run and pass |
| F2 | Scaffold the backend package: TypeScript, `wrangler.jsonc`, lint, typecheck | `backend/` | `npm run lint && npm run typecheck && npm run build` all pass |
| F3 | Add CI running lint, typecheck, build, and test on every push | `.github/workflows/` | CI green on `main` |
| F4 | Document the local dev loop for running frontend and backend together | `docs/` | A new contributor can start both from the README |

### Phase 1 — The Domain Model

The vocabulary as types. Everything downstream depends on these, so get them
right before building around them.

| ID | Task | Location | Done when |
|---|---|---|---|
| D1.1 | `Incident` — id, title, service, severity, status, timestamps | `backend/src/domain/incident.ts` | Type + validator + unit tests |
| D1.2 | `Runbook` and `RunbookStep` — id, trigger conditions, ordered steps, allowed evidence sources, proposed actions | `backend/src/domain/runbook.ts` | Type + validator + unit tests |
| D1.3 | `EvidenceCard` — source, claim, raw payload, collected-at, confidence | `backend/src/domain/evidence.ts` | Type + validator + unit tests |
| D1.4 | `EvidencePacket` — the ordered set of cards for one incident, plus a summary | `backend/src/domain/evidence.ts` | Type + validator + unit tests |
| D1.5 | `Action` — id, kind, target, **`isStateChanging` flag**, parameters, reversibility | `backend/src/domain/action.ts` | Type + validator + unit tests |
| D1.6 | `ApprovalGate` — action ref, state (`locked`/`approved`/`rejected`), approver, decided-at, reason | `backend/src/domain/approval.ts` | Type + validator + unit tests |
| D1.7 | `RunRecord` — the full replayable transcript of one incident run | `backend/src/domain/run.ts` | Type + validator + unit tests |

> **The load-bearing decision:** `isStateChanging` on `Action` is what the entire
> safety guarantee rests on. Model it so a state-changing action *cannot* be
> constructed without an approval reference — make it impossible in the type
> system, not merely checked at runtime.

### Phase 2 — Runbook Format and Loader

| ID | Task | Location | Done when |
|---|---|---|---|
| R1 | Design the runbook file format (YAML or JSON) with a documented schema | `docs/runbook-format.md` | Schema documented with a worked example |
| R2 | Write the loader and schema validator; reject malformed runbooks loudly | `backend/src/domain/runbook-loader.ts` | Valid runbooks load; every malformed case has a named error and a test |
| R3 | Author `checkout-failure.yaml` — the runbook the frontend already shows | `testing/runbooks/` | Loads and validates |
| R4 | Author two more runbooks to prove the format generalizes | `testing/runbooks/` | Both load; format needed no special-casing |
| R5 | Build the trigger matcher that selects a runbook from an incident | `backend/src/domain/runbook-matcher.ts` | Correct selection, plus a defined no-match behavior |

### Phase 3 — Evidence Collection

| ID | Task | Location | Done when |
|---|---|---|---|
| E1 | Define the `EvidenceSource` interface every collector implements | `backend/src/mcp/source.ts` | Interface + docs |
| E2 | Log collector (fixture-backed) | `backend/src/mcp/logs.ts` | Returns `EvidenceCard[]`; tested |
| E3 | Metrics collector (fixture-backed) | `backend/src/mcp/metrics.ts` | Returns `EvidenceCard[]`; tested |
| E4 | Deploy-history collector (fixture-backed) | `backend/src/mcp/deploys.ts` | Returns `EvidenceCard[]`; tested |
| E5 | Build realistic fixtures for the checkout incident — logs, p95 series, commit list including `8f31c2b` | `testing/fixtures/` | Fixtures reproduce the exact scenario the UI depicts |
| E6 | Packet assembler: run allowed collectors, order cards, write the summary | `backend/src/domain/packet-builder.ts` | Produces a complete packet; tested |
| E7 | **Scope enforcement**: a collector not listed in the runbook must be refused | `backend/src/domain/packet-builder.ts` | Out-of-scope collection throws; test asserts it |

> E7 is a safety boundary, not a feature. Test it as adversarially as the
> approval gate itself.

### Phase 4 — Sandbox Diagnostics

| ID | Task | Location | Done when |
|---|---|---|---|
| S1 | Define `SandboxRun` — script, inputs, stdout/stderr, exit code, duration | `backend/src/domain/sandbox.ts` | Type + tests |
| S2 | Implement the sandbox executor per decision D3 | `backend/src/mcp/sandbox.ts` | Runs a script, captures output, enforces a timeout |
| S3 | Write the checkout diagnostic script producing the UI's output shape (`timeout_ms`, `failed_requests`, `likely_commit`, `recommendation`) | `testing/runbooks/scripts/` | Output parses into an `EvidenceCard` |
| S4 | Assert the sandbox has **no network and no credential access** | `backend/src/mcp/sandbox.ts` | Escape attempts are blocked; tests prove it |
| S5 | Attach sandbox output to the evidence packet as a card | `backend/src/domain/packet-builder.ts` | Card appears in the packet; tested |

### Phase 5 — Risk Scoring and Recommendation

| ID | Task | Location | Done when |
|---|---|---|---|
| K1 | Design the risk model — what inputs, what weights, why (the UI shows `82/100`) | `docs/risk-model.md` | Documented and defensible |
| K2 | Implement the scorer | `backend/src/domain/risk.ts` | Deterministic for a given packet; tested |
| K3 | Make every score **explainable**: which evidence pushed it up or down | `backend/src/domain/risk.ts` | Score returns a breakdown, not a bare number |
| K4 | Recommendation builder: propose the runbook action justified by the evidence | `backend/src/domain/recommend.ts` | Produces an `Action` + rationale; tested |
| K5 | Handle thin evidence: recommend *nothing* rather than guessing | `backend/src/domain/recommend.ts` | Low-evidence case returns "insufficient evidence"; tested |

> K5 matters more than it looks. A system that always produces a confident
> recommendation trains operators to rubber-stamp. Saying "I don't know" is a
> feature.

### Phase 6 — The Approval Gate

The core of the product. Build it defensively.

| ID | Task | Location | Done when |
|---|---|---|---|
| A1 | Gate state machine: `locked → approved` / `locked → rejected`, no other paths | `backend/src/domain/approval.ts` | Every illegal transition is rejected; tested exhaustively |
| A2 | Executing a state-changing action without an approval must be **impossible** | `backend/src/domain/executor.ts` | Bypass attempts fail; tests attempt bypass explicitly |
| A3 | Record the decision: who, when, and what they saw at decision time | `backend/src/domain/approval.ts` | Decision snapshot is immutable |
| A4 | Expiry: an unapproved gate goes stale after a configurable window | `backend/src/domain/approval.ts` | Stale gates cannot be approved; tested |
| A5 | Action executor with dry-run mode, running only post-approval | `backend/src/domain/executor.ts` | Dry-run and real paths both tested |
| A6 | Rejection path: log the reason, halt the runbook, keep the packet | `backend/src/domain/executor.ts` | Rejection is a clean terminal state |

> Write the bypass tests first. The valuable assertion in this codebase is not
> "approval works" — it is "**nothing runs without it**." Treat A2 as the
> project's central test.

### Phase 7 — API Routes

| ID | Task | Location | Done when |
|---|---|---|---|
| P1 | `POST /incidents` — create an incident, match a runbook | `backend/src/routes/incidents.ts` | Returns an incident + selected runbook |
| P2 | `POST /incidents/:id/run` — execute the read-only phase | `backend/src/routes/run.ts` | Returns an evidence packet + risk score |
| P3 | `GET /incidents/:id/packet` — fetch the packet with all cards | `backend/src/routes/packet.ts` | Returns the packet the UI needs |
| P4 | `POST /approvals/:id/approve` and `/reject` | `backend/src/routes/approvals.ts` | Drives the state machine; rejects illegal calls |
| P5 | `GET /incidents/:id/run-record` — the full replay transcript | `backend/src/routes/replay.ts` | Returns an ordered transcript |
| P6 | Validate every request body at the boundary; consistent error envelope | `backend/src/routes/` | Malformed input returns a structured error, never a 500 |
| P7 | Live progress for the UI (SSE or WebSocket via the Durable Object) | `backend/src/routes/stream.ts` | Frontend can render steps as they complete |

### Phase 8 — Audit Trail and Replay

The README calls out "explainable, replayable" as the product direction. This is
where that gets delivered.

| ID | Task | Location | Done when |
|---|---|---|---|
| L1 | Append-only run log: every step, collection, sandbox run, and decision | `backend/src/domain/audit.ts` | Log is append-only; tested |
| L2 | Replay: reconstruct any past run from its log alone | `backend/src/domain/replay.ts` | A completed run replays identically |
| L3 | Export a run as a shareable post-incident artifact | `backend/src/routes/replay.ts` | Produces a readable document |

### Phase 9 — Connect the Frontend

Replace hardcoded arrays with live data. Nothing here should require redesign —
the components already match the domain shapes.

| ID | Task | Location | Done when |
|---|---|---|---|
| U1 | API client with typed responses shared from the domain types | `frontend/src/lib/api.ts` | No duplicated type definitions across packages |
| U2 | Wire `RunbookPreview` to a real incident (replaces the `timeline` array) | `frontend/src/app/components/RunbookPreview.tsx` | Timeline reflects real run state |
| U3 | Live risk score and gauge from the API (replaces the hardcoded `82`) | `frontend/src/app/components/` | Score and breakdown are real |
| U4 | Make Approve and Review functional against `POST /approvals/:id` | `frontend/src/app/components/RunbookPreview.tsx` | Buttons drive the real gate |
| U5 | Evidence detail view — drill from a card into its raw payload | `frontend/src/app/` | Every claim reaches its receipt in one click |
| U6 | Incident list and run history view | `frontend/src/app/` | Past runs are browsable and replayable |
| U7 | Loading, empty, and error states for every new surface | `frontend/src/app/` | No surface can render blank or stuck |
| U8 | Keep the landing page as the marketing route; put the app on `/app` | `frontend/src/app/` | Both routes build and deploy |

### Phase 10 — Verification

| ID | Task | Location | Done when |
|---|---|---|---|
| T1 | Unit tests across domain logic to the 80% standard | `testing/tests/` | Coverage ≥ 80% and enforced in CI |
| T2 | Integration tests over the full alert → packet → gate flow | `testing/tests/` | Happy path passes end to end |
| T3 | **Safety test suite**: every attempt to act without approval fails | `testing/tests/safety/` | Suite is exhaustive and CI-blocking |
| T4 | E2E test of the operator approval journey (Playwright) | `testing/tests/e2e/` | Journey passes in CI |
| T5 | Agent prompt fixtures and regression checks | `testing/prompts/` | Prompt changes are reviewable and diffable |

---

## Part 5 — Suggested Order

If the goal is the shortest path to something demonstrable end to end:

1. **F1–F3** — test tooling and CI first. Everything after is cheaper.
2. **D1.1–D1.7** — the domain model. All later work assumes it.
3. **R1–R3** — the runbook format and the checkout runbook.
4. **E1–E7** — fixture-backed evidence collection.
5. **A1–A3** — the approval gate, with bypass tests. Earlier than feels natural,
   because it is the actual product.
6. **P1–P4** — enough API to drive the existing UI.
7. **U1–U4** — replace the hardcoded frontend arrays with real data.

That sequence produces a working vertical slice: a real incident, real evidence,
a real locked gate, a real approval — using the screen that already exists.

Sandbox execution (Phase 4), risk scoring (Phase 5), and replay (Phase 8) are
each valuable but deferrable; the slice above demonstrates the core idea without
them.

---

## Part 6 — Known Risks

**The safety guarantee is only as good as its tests.** "The agent cannot act
without approval" is a claim about code paths that do not exist. It is proven by
tests that try to bypass the gate and fail. If the safety suite is thin, the
product's central promise is unverified.

**Fixtures can hide integration reality.** Building entirely against
`testing/fixtures/` is the right call for velocity, but real log APIs are
paginated, rate-limited, and occasionally down. Keep the `EvidenceSource`
interface honest about failure so real adapters slot in without a redesign.

**Risk scores invite false confidence.** A number like `82/100` reads as more
precise than the evidence usually supports. K3's explainability requirement is
the mitigation — the breakdown should always be one click away from the number.

**The demo/production gap is wide.** Auth, secret management, rate limiting, and
credential scoping (D6) are not in this roadmap. They are not small. Do not let
a convincing demo blur into an assumption of production readiness.
