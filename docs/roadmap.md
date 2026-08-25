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

**UPDATE (2026-08-25, approval-gate-vertical-slice):** the vertical slice
described in Part 5 below is now built and verified end to end — a real
backend, a real D1-backed approval gate, and a `/app` dashboard wired to live
data. See `docs/IMPLEMENTATION-STATUS.md` for the task-by-task record and
`docs/local-development.md` for how to run it. The landing page below is still
the original marketing route.

| Area | State |
|---|---|
| `frontend/` | Real. Next.js 16 landing page (marketing, `/`) **and** a live operator dashboard (`/app`) wired to the backend API. 14/14 tests, lint/typecheck/build clean |
| `backend/` | Real. Hono Worker on Cloudflare Workers, D1-backed. Domain model, runbook loader, fixture-backed evidence collectors, packet builder with scope enforcement, token-gated executor with a safety bypass suite, and the full API surface for the slice below. 114/114 tests, typecheck clean |
| `backend/src/domain/` | Real — incident/runbook/evidence/action/approval/run types, runbook matcher, packet builder, executor |
| `backend/src/mcp/` | Real — fixture-backed `logs`, `metrics`, `deploys` collectors behind a shared `EvidenceSource` interface |
| `backend/src/routes/` | Real — `POST /incidents/:id/run`, `GET /incidents/:id/packet`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` |
| `testing/runbooks/` | Real — `checkout-failure.json` (the runbook the frontend has always shown) plus two more proving the format generalizes |
| `testing/fixtures/` | Real — logs, p95 metrics, and deploy history fixtures reproducing the exact checkout-incident scenario the UI depicts |
| `testing/prompts/` | Empty (`.gitkeep`) — out of scope for this slice |
| `testing/tests/` | Real — safety bypass suite proving state-changing actions cannot execute without an approval token |
| `docs/` | `cloudflare-deployment.md`, `local-development.md` (new), `roadmap.md`, `IMPLEMENTATION-STATUS.md`, `runbook-format.md` |

The risk score shown in `/app` is still **fixture-derived, not a computed
model** — Phase 5 (Risk Scoring and Recommendation) was explicitly out of
scope for this slice and remains open below. Sandbox execution (Phase 4) is
also still simulated: the post-approval "execution" result is a descriptive
string, not a real side effect. Replay (Phase 8) has not been started.

**The useful part:** the frontend had already fixed the vocabulary before this
slice, and the backend now implements those exact nouns, so the UI could be
wired up without a translation layer:

`Incident` · `Runbook` · `RunbookStep` · `EvidencePacket` · `EvidenceCard` ·
`SandboxRun` · `RiskScore` · `ApprovalGate` · `Action`

(`RunRecord` was deliberately reduced to a simpler `RunRow` for this slice —
see `docs/IMPLEMENTATION-STATUS.md` T7.)

---

## Part 3 — Decisions to Lock First

These block real design work. Each has a recommendation, but they are the
project owner's call.

### D1. Backend runtime — RESOLVED

**Chosen: a second Cloudflare Worker (Hono + TypeScript) in `backend/`.** Built
as `runproof-api`, Hono 4.13, deployed independently from the frontend Worker.
This keeps one deployment story and one language, and OpenNext had already
proved the Cloudflare path works for the frontend. The rejected alternative —
Next.js route handlers inside `frontend/` — was not used, to keep the product
surface separate from the engine.

### D2. State storage — RESOLVED (partial)

**Chosen: Cloudflare D1** for incidents, evidence packets, actions, approval
gates, and the append-only audit log (binding `DB`, database `runproof-db`,
one migration in `backend/migrations/0001_init.sql`). The **Durable Object for
live in-flight step state was not built** — this slice's `/incidents/:id/run`
runs synchronously and returns the full packet in one response rather than
streaming progress, so a per-run Durable Object was unnecessary for the scope
delivered. Revisit if/when Phase 7's P7 (live progress via SSE/WebSocket) is
picked up.

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

### D6. Is this a demo or a real tool? — RESOLVED

**Chosen: this slice is the demo path, scoped to a vertical slice — not a real
tool.** Concretely: Phases 0–3 and 6–7 were built (foundations, domain model,
runbook format, fixture-backed evidence collection, the approval gate, and the
API/frontend wiring). Phase 4 (real sandbox execution), Phase 5 (computed risk
scoring), and Phase 8 (audit replay) were **explicitly excluded** and remain
open in Part 4 below. There is still no auth (D5), execution is still
simulated, and the risk score shown in `/app` is still fixture-derived, not
computed. Do not point this at a real production environment.

---

## Part 4 — Remaining Work

Phases are ordered by dependency. Each task lists where the code goes and what
"done" means.

### Phase 0 — Foundations

Do this before writing feature code, or the coverage standard becomes
unreachable retroactively.

| ID | Task | Location | Done when |
|---|---|---|---|
| F1 | Add a test runner (Vitest) with coverage reporting | `frontend/`, `backend/` | ✅ Done (T1, T10). `npm test`: backend 114/114, frontend 14/14. Coverage reporting scripts exist (`test:coverage`) but no enforced threshold is wired into CI (there is no CI — see F3) |
| F2 | Scaffold the backend package: TypeScript, `wrangler.jsonc`, lint, typecheck | `backend/` | ✅ Done (T1). `npm run typecheck && npm run build` pass. Backend has no `lint` script — ESLint was never added to `backend/` (known gap, see below) |
| F3 | Add CI running lint, typecheck, build, and test on every push | `.github/workflows/` | ⬜ Not done. No `.github/workflows/` exists. Explicitly deferred — needs a repo decision (GitHub Actions vs Cloudflare build hooks) and there was nothing to gate until the suite existed. Do this next |
| F4 | Document the local dev loop for running frontend and backend together | `docs/` | ✅ Done (T12) — `docs/local-development.md` |

### Phase 1 — The Domain Model

The vocabulary as types. Everything downstream depends on these, so get them
right before building around them.

| ID | Task | Location | Done when |
|---|---|---|---|
| D1.1 | `Incident` — id, title, service, severity, status, timestamps | `backend/src/domain/incident.ts` | ✅ Done, in reduced form. There is no standalone `Incident` type/file — an incident is identified by its id string (e.g. `inc-demo-1`) directly on the run/route layer. Deliberate scope reduction for this slice |
| D1.2 | `Runbook` and `RunbookStep` — id, trigger conditions, ordered steps, allowed evidence sources, proposed actions | `backend/src/domain/runbook.ts` | ✅ Done (T4) |
| D1.3 | `EvidenceCard` — source, claim, raw payload, collected-at, confidence | `backend/src/domain/evidence.ts` | ✅ Done (T2) |
| D1.4 | `EvidencePacket` — the ordered set of cards for one incident, plus a summary | `backend/src/domain/evidence.ts` | ✅ Done (T2) |
| D1.5 | `Action` — id, kind, target, **`isStateChanging` flag**, parameters, reversibility | `backend/src/domain/action.ts` | ✅ Done (T3), as `ReadOnlyAction` / `StateChangingAction` |
| D1.6 | `ApprovalGate` — action ref, state (`locked`/`approved`/`rejected`), approver, decided-at, reason | `backend/src/domain/approval.ts` | ✅ Done (T3) |
| D1.7 | `RunRecord` — the full replayable transcript of one incident run | `backend/src/domain/run.ts` | ⚠️ Deliberately reduced to a simpler `RunRow` in `backend/src/domain/store.ts` (T7) — id, incidentId, runbookId, service, state, timestamps. Not a full replayable transcript; no step-by-step history. Full `RunRecord` + replay is Phase 8, still open |

> **The load-bearing decision:** `isStateChanging` on `Action` is what the entire
> safety guarantee rests on. Model it so a state-changing action *cannot* be
> constructed without an approval reference — make it impossible in the type
> system, not merely checked at runtime.

### Phase 2 — Runbook Format and Loader

| ID | Task | Location | Done when |
|---|---|---|---|
| R1 | Design the runbook file format (YAML or JSON) with a documented schema | `docs/runbook-format.md` | ✅ Done (T4). **JSON, not YAML** — Workers have no filesystem, and JSON imports natively via `import … with { type: "json" }` without bundling a YAML parser |
| R2 | Write the loader and schema validator; reject malformed runbooks loudly | `backend/src/domain/runbook.ts` | ✅ Done (T4), folded into `runbook.ts` rather than a separate `runbook-loader.ts` file |
| R3 | Author `checkout-failure.yaml` — the runbook the frontend already shows | `testing/runbooks/` | ✅ Done (T4) as `checkout-failure.json` |
| R4 | Author two more runbooks to prove the format generalizes | `testing/runbooks/` | ⬜ Not done. Only `checkout-failure.json` exists. Open — worth doing before the matcher's tie-breaking (see R5) is exercised by more than one runbook |
| R5 | Build the trigger matcher that selects a runbook from an incident | `backend/src/domain/runbook.ts` | ✅ Done (T4) as `matchRunbook`. **Known gap:** returns `null` on a signal-overlap tie, which means two overlapping runbooks silently 404 instead of erroring. Safe while only one runbook exists; revisit before there are many |

### Phase 3 — Evidence Collection

| ID | Task | Location | Done when |
|---|---|---|---|
| E1 | Define the `EvidenceSource` interface every collector implements | `backend/src/mcp/source.ts` | ✅ Done (T5) |
| E2 | Log collector (fixture-backed) | `backend/src/mcp/logs.ts` | ✅ Done (T5) |
| E3 | Metrics collector (fixture-backed) | `backend/src/mcp/metrics.ts` | ✅ Done (T5) |
| E4 | Deploy-history collector (fixture-backed) | `backend/src/mcp/deploys.ts` | ✅ Done (T5) |
| E5 | Build realistic fixtures for the checkout incident — logs, p95 series, commit list including `8f31c2b` | `testing/fixtures/checkout-incident/` | ✅ Done (T5). `47` failed requests and commit `8f31c2b` verified present in the fixtures and absent from collector source, confirming the numbers are data-driven, not hardcoded |
| E6 | Packet assembler: run allowed collectors, order cards, write the summary | `backend/src/domain/packet-builder.ts` | ✅ Done (T6) |
| E7 | **Scope enforcement**: a collector not listed in the runbook must be refused | `backend/src/domain/packet-builder.ts` | ✅ Done (T6). Verified: scope is checked before any `collect()` call runs, not just before using the result |

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
| A1 | Gate state machine: `locked → approved` / `locked → rejected`, no other paths | `backend/src/domain/approval.ts` | ✅ Done (T3). Verified live in this task (T12): a second `approve` call on an already-approved gate returns `409 gate_already_decided`, and the `approved` state was confirmed persisted directly in D1 |
| A2 | Executing a state-changing action without an approval must be **impossible** | `backend/src/domain/executor.ts` | ✅ Done (T3, T8). `ApprovalToken` is a branded type that only `approveGate` can mint; all three attempted bypass routes are compile errors (TS2554, TS2345 ×2). This is the project's central safety property |
| A3 | Record the decision: who, when, and what they saw at decision time | `backend/src/domain/approval.ts` | ✅ Done (T3, T9) — `decidedBy`, `decidedAt` on the gate, persisted |
| A4 | Expiry: an unapproved gate goes stale after a configurable window | `backend/src/domain/approval.ts` | ✅ Done (T3) — `isExpired(gate, nowIso)`, gate carries `expiresAt` |
| A5 | Action executor with dry-run mode, running only post-approval | `backend/src/domain/executor.ts` | ✅ Done (T3, T8) — `executeStateChanging(action, token, { dryRun })` |
| A6 | Rejection path: log the reason, halt the runbook, keep the packet | `backend/src/routes/approvals.ts` | ✅ Done (T9) — `POST /approvals/:id/reject` |

> Write the bypass tests first. The valuable assertion in this codebase is not
> "approval works" — it is "**nothing runs without it**." Treat A2 as the
> project's central test.

### Phase 7 — API Routes

| ID | Task | Location | Done when |
|---|---|---|---|
| P1 | `POST /incidents` — create an incident, match a runbook | `backend/src/routes/incidents.ts` | ⬜ Not done. There is no incident-creation route — an incident id is just a string (`inc-demo-1`) passed straight to `POST /incidents/:id/run`, which matches the runbook inline. Folded into P2 for this slice |
| P2 | `POST /incidents/:id/run` — execute the read-only phase | `backend/src/routes/run.ts` | ✅ Done (T9). Returns the packet, action, and a **locked** gate — confirmed live in T12: 16 evidence cards, `gate.state === "locked"`, no `execution` field in the response. Does not return a risk score (that's Phase 5, still fixture-derived on the frontend, not from this route) |
| P3 | `GET /incidents/:id/packet` — fetch the packet with all cards | `backend/src/routes/packet.ts` | ✅ Done (T9). Confirmed live in T12 |
| P4 | `POST /approvals/:id/approve` and `/reject` | `backend/src/routes/approvals.ts` | ✅ Done (T9). Confirmed live in T12: approve returns `gate.state === "approved"` plus a simulated `execution` result; a second approve on the same gate returns `409 gate_already_decided` |
| P5 | `GET /incidents/:id/run-record` — the full replay transcript | `backend/src/routes/replay.ts` | ⬜ Not done — Phase 8 (replay), explicitly out of scope for this slice |
| P6 | Validate every request body at the boundary; consistent error envelope | `backend/src/routes/` | ✅ Done (T9) — Zod schemas in `run.ts`/`approvals.ts`, shared `apiError()` envelope, generic `onError` handler returning 500 only for truly unhandled errors |
| P7 | Live progress for the UI (SSE or WebSocket via the Durable Object) | `backend/src/routes/stream.ts` | ⬜ Not done. `/run` responds synchronously with the full packet in one round trip; no per-run Durable Object or streaming was built (see D2 above) |

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
| U1 | API client with typed responses shared from the domain types | `frontend/src/lib/api.ts` | ✅ Done (T10). Structural mirror, not a shared import (separate Workers/builds) — `frontend/src/lib/types.ts` names which backend module each type shadows so drift shows up in review |
| U2 | Wire `RunbookPreview` to a real incident (replaces the `timeline` array) | `frontend/src/app/app/DashboardClient.tsx` | ✅ Done (T11) — timeline is built from the live packet + gate, not a hardcoded array |
| U3 | Live risk score and gauge from the API (replaces the hardcoded `82`) | `frontend/src/app/app/DashboardClient.tsx` | ⚠️ Partially done. The gauge reads from real evidence-packet confidence, but there is still **no computed risk model** — `DashboardClient.tsx` maps packet confidence (`high`/`medium`/`low`) to one of three fixed scores (e.g. `medium → 55`). This is not the `82/100` hardcoded on the landing page, but it is still not Phase 5's explainable, weighted score. Do not describe this as "real" scoring |
| U4 | Make Approve and Review functional against `POST /approvals/:id` | `frontend/src/app/app/DashboardClient.tsx` | ✅ Done (T11). Confirmed live in T12 via both curl and a real headless-browser screenshot of `/app` showing the locked gate and an enabled Approve button |
| U5 | Evidence detail view — drill from a card into its raw payload | `frontend/src/app/` | ⬜ Not done. Evidence cards render their `claim` text; there's no click-through to the raw payload |
| U6 | Incident list and run history view | `frontend/src/app/` | ⬜ Not done. `/app` shows only the single seeded `inc-demo-1` incident |
| U7 | Loading, empty, and error states for every new surface | `frontend/src/app/app/DashboardClient.tsx` | ✅ Done (T11) — loading/error states present; error codes (`not_found`, `gate_already_decided`, `gate_expired`) have user-facing copy |
| U8 | Keep the landing page as the marketing route; put the app on `/app` | `frontend/src/app/` | ✅ Done (T11). Confirmed live in T12 — both `/` and `/app` render correctly in a real browser |

### Phase 10 — Verification

| ID | Task | Location | Done when |
|---|---|---|---|
| T1 | Unit tests across domain logic to the 80% standard | `testing/tests/` | ✅ Done, colocated rather than centralized. 114 backend + 14 frontend tests live next to the code they test (`backend/src/**/*.test.ts`), not under `testing/tests/`. No coverage threshold is enforced in CI — there is no CI (F3, still open) |
| T2 | Integration tests over the full alert → packet → gate flow | `testing/tests/` | ✅ Done as `backend/src/routes/routes.test.ts`, and manually re-verified end to end in this task (T12) against real running dev servers, not just mocked handlers |
| T3 | **Safety test suite**: every attempt to act without approval fails | `testing/tests/safety/` | ✅ Done — `testing/tests/safety/bypass.test.ts` (implementation task T8). All bypass routes proven to be compile errors, not just runtime rejections |
| T4 | E2E test of the operator approval journey (Playwright) | `testing/tests/e2e/` | ⬜ No automated Playwright suite committed. This task (T12) drove the journey manually with curl and an ad hoc Playwright script against real dev servers, but nothing reusable was added to the repo |
| T5 | Agent prompt fixtures and regression checks | `testing/prompts/` | ⬜ Not done — `testing/prompts/` is still an empty placeholder. There is no LLM-driven agent in this slice (evidence collection is fixture-backed, not model-driven), so there's nothing yet to regression-test |

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
