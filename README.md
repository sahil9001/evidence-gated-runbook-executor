# RunProof

RunProof is an evidence-gated runbook executor for incident response.

It helps an operations team move from alert to action without letting an AI agent make risky production changes on its own. The agent follows a scoped runbook, gathers evidence, explains the recommended action, and waits for human approval before anything sensitive happens.

A working vertical slice of this idea now exists: a real backend that matches
an incident to a runbook, collects evidence from fixture-backed sources, and
locks the proposed action behind a real approval gate persisted in Cloudflare
D1 — plus a `/app` operator dashboard wired to it. See
[What's Actually Built](#whats-actually-built) below for exactly what that
covers, and what it does not.

## Why It Exists

Production incidents are stressful. Teams need speed, but they also need control.

RunProof is built around one simple rule:

> Prove first. Act only after approval.

Instead of asking an AI assistant to improvise, RunProof gives it a controlled path:

1. Start from a known runbook.
2. Read logs, metrics, deploy history, and related context.
3. Run diagnostic checks in isolation.
4. Produce an evidence packet.
5. Recommend a safe next step.
6. Keep production actions locked until an operator approves.

## What's Actually Built

This repo has two working pieces now: a marketing frontend and a real backend
behind a live dashboard.

- **`frontend/` — Next.js app, two routes.**
  - `/` is the original marketing landing page (hero, workflow preview,
    illustrations — all still hardcoded example content, unchanged from the
    original product-surface mockup).
  - `/app` is a **live operator dashboard**. It calls the real backend on
    load, renders the actual evidence packet it gets back, and drives a real
    approval gate — Approve/Reject buttons call the backend and the UI
    reflects the persisted result.
- **`backend/` — a Hono API on Cloudflare Workers, backed by D1.** Given an
  incident (service + signals), it matches a runbook, collects evidence from
  three fixture-backed sources (logs, metrics, deploy history), assembles an
  evidence packet, proposes an action, and locks it behind an approval gate.
  Nothing state-changing can execute without an approval — this is enforced
  at the type level (`ApprovalToken` is a branded type only the approval flow
  can mint), not just checked at runtime. Approving persists the decision to
  D1 and returns a simulated execution result; approving the same gate twice
  correctly fails with `409 gate_already_decided`.

**What is honestly NOT built:**

- **No real sandbox execution.** Diagnostics and the post-approval
  "execution" are both simulated — a descriptive string, not a real side
  effect against any system.
- **No computed risk model.** The risk score/gauge shown in `/app` is derived
  from a small fixed lookup table keyed by evidence confidence (`high` /
  `medium` / `low`), not a weighted, explainable model. The `82/100` on the
  landing page is separately hardcoded and unrelated to any real run.
- **No auth.** The approver's identity (`by`) is a free-text field with no
  verification. Do not point this at a real production environment or expose
  it on a shared network.
- **No CI.** Verification is run by hand (see below).
- **No replay / audit trail UI**, and no incident list — only the single
  seeded `inc-demo-1` incident exists.

Full details on what's done vs. open are in [docs/roadmap.md](docs/roadmap.md)
and [docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md).

Live deployment (frontend only, marketing route):

https://runproof-frontend.sahilsilare.workers.dev

The backend is not yet deployed anywhere — it only runs locally today. See
[docs/local-development.md](docs/local-development.md) for the one-time
`wrangler d1 create` step a human needs to run before that changes.

## Repository Structure

```text
.
|-- backend/                  # Hono API on Cloudflare Workers, D1-backed
|   |-- migrations/           # D1 schema migrations
|   `-- src/
|       |-- domain/           # Incident/runbook/evidence/action/approval types + logic
|       |-- mcp/               # Fixture-backed evidence collectors (logs, metrics, deploys)
|       `-- routes/           # /incidents/:id/run, /incidents/:id/packet, /approvals/:id/*
|-- docs/                     # Deployment, roadmap, local dev, and status documentation
|-- frontend/                 # Next.js app: marketing landing page (/) + operator dashboard (/app)
|   |-- public/brand/         # Generated logo assets
|   |-- public/illustrations/ # Product illustration assets
|   `-- src/
|       |-- app/              # App routes and components
|       `-- lib/              # Typed API client for the backend
`-- testing/
    |-- runbooks/             # checkout-failure.json runbook
    |-- fixtures/             # Logs/metrics/deploys fixtures behind the collectors
    `-- tests/safety/         # Bypass-attempt suite proving the approval gate can't be skipped
```

## Stack

**Frontend:** Next.js 16, React 19, Tailwind CSS, Lucide icons, OpenNext for
Cloudflare, Wrangler for deployment.

**Backend:** Hono 4, TypeScript, Zod for request validation, Cloudflare D1,
Vitest (with `@cloudflare/vitest-pool-workers` for a real Workers runtime in
tests), Wrangler for local dev and deployment.

## Local Development

Two servers, run in separate terminals. Full detail — including the D1
migration step and the `NEXT_PUBLIC_API_URL` variable — is in
[docs/local-development.md](docs/local-development.md). Quick start:

```bash
# Terminal 1 — backend, http://localhost:8787
cd backend
npm ci
npm run db:migrate
npm run dev

# Terminal 2 — frontend, http://localhost:3000
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000/` for the landing page, or
`http://localhost:3000/app` for the live dashboard (needs the backend
running).

## Verification

Run these before pushing changes:

```bash
cd backend
npm test
npm run typecheck

cd ../frontend
npm test
npm run lint
npm run typecheck
npm run build
```

As of the last full run: backend 114/114 tests passing, frontend 14/14 tests
passing, both typecheck/lint/build clean. There is no ESLint config for
`backend/` yet and no CI workflow — both are open items in
[docs/roadmap.md](docs/roadmap.md) (Phase 0, F3).

## Cloudflare Deployment

The **frontend** is configured for Cloudflare Workers through OpenNext and is
live at the URL above. Deploy it with:

```bash
cd frontend
npm run deploy
```

Useful related commands:

```bash
npm run preview
npx wrangler tail
```

More details are in [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md)
(frontend only — written before the backend existed).

The **backend has never been deployed**. `backend/wrangler.jsonc` still points
at a placeholder D1 `database_id` (`local-dev-placeholder`), and nobody has
run `wrangler d1 create runproof-db` against a real Cloudflare account yet.
That is a deliberate, human-triggered step — see
[docs/local-development.md](docs/local-development.md) for exactly what it
involves before a `wrangler deploy` of `backend/` would work. This README does
not run or recommend that step.

## Future Buildout

The full breakdown of remaining work — the idea in plain terms, resolved and
open decisions, and a phased task list with what's actually done — is in
[docs/roadmap.md](docs/roadmap.md). The short version: Phases 0–3 and 6–7
(foundations, domain model, runbook format, evidence collection, the approval
gate, and the API/frontend wiring) are largely built. Phase 4 (real sandbox
execution), Phase 5 (a computed risk model), and Phase 8 (audit replay) are
still open and were explicitly out of scope for this slice.

The intended product direction is a system where agent actions are explainable, replayable, and gated by evidence.
