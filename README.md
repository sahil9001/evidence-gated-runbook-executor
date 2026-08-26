# RunProof

RunProof is an evidence-gated runbook executor for incident response.

It helps an operations team move from alert to action without letting an AI agent make risky production changes on its own. The agent follows a scoped runbook, gathers evidence, explains the recommended action, and waits for human approval before anything sensitive happens.

A working operator console now exists on top of the original vertical slice: real auth, a multi-incident model, a full incident-to-approval flow, and dedicated screens for runbooks, run history, and the audit trail — all backed by a real Cloudflare D1 database via a pluggable storage interface. See [What's Actually Built](#whats-actually-built) below for exactly what that covers, and what it does not.

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

This repo has two working pieces: a marketing frontend and a real backend behind a full operator console.

- **`frontend/` — Next.js app.**
  - `/` is the original marketing landing page (hero, workflow preview,
    illustrations — all still hardcoded example content, unchanged from the
    original product-surface mockup).
  - `/register` and `/login` are real auth pages; every `/app/*` route is
    guarded and redirects an unauthenticated visit to `/login?next=<path>`.
  - `/app` — **Overview**: an awaiting-approval count, active-incident and
    runs-today stats, a plain-language recent-activity feed.
  - `/app/incidents` — every incident, filterable by status, newest first.
  - `/app/incidents/new` — create an incident (service + free-text signal
    tags) and see, before submitting, exactly which runbook it would match
    and what that runbook authorizes the agent to read.
  - `/app/runs/:id` — the run detail screen, tabbed **Evidence** (every
    collected card with a "Show raw" drill-down), **Diagnostics**, **Approval**
    (the risk gauge, evidence trail, and the Approve/Reject controls
    themselves), and **Audit** (this run's own entries).
  - `/app/runbooks` — the scope contract for each runbook: what it's allowed
    to read, its steps, and its proposed action.
  - `/app/history` — every run, filterable by state.
  - `/app/audit` — the full append-only audit log across every run, filterable
    by run id.
- **`backend/` — a Hono API on Cloudflare Workers, backed by D1.** Real
  password auth (PBKDF2-SHA256, 210,000 iterations) with 30-day session
  cookies and a `requireAuth` middleware gating every route except
  `/auth/*` and `/health`. Given an incident (service + signals), it matches
  a runbook, collects evidence from three fixture-backed sources (logs,
  metrics, deploy history), assembles an evidence packet, proposes an
  action, and locks it behind an approval gate. Nothing state-changing can
  execute without an approval — this is enforced at the type level
  (`ApprovalToken` is a branded type only the approval flow can mint), not
  just checked at runtime. Approving persists the decision to D1 and returns
  a simulated execution result — confirmed to survive a page reload, not
  just live in React state; approving the same gate twice correctly fails
  with `409 gate_already_decided`.
- **`backend/src/store/` — a pluggable storage seam.** The `Store` interface
  has two implementations, a D1 adapter and an in-memory adapter, both
  proven conformant against one shared test suite (`store/conformance.ts`)
  rather than tested separately and hoped to agree.

**What is honestly NOT built:**

- **No real sandbox execution.** Diagnostics and the post-approval
  "execution" are both simulated — a descriptive string, not a real side
  effect against any system.
- **No computed risk model.** The risk figure shown on a run's Approval tab
  is a disclosed display heuristic derived from evidence confidence
  (`high`/`medium`/`low` mapped to a small fixed set of scores), not a
  weighted, explainable model. The `82/100` on the landing page is
  separately hardcoded and unrelated to any real run.
- **No CI.** Verification is run by hand (see below).
- **No login rate limiting.** `/auth/login` has no throttling — do not point
  this at a real production environment or a shared network.
- **No full run replay.** History and Audit show real persisted rows, but
  nothing reconstructs a run's behavior from its log the way a true replay
  feature would.

Full details on what's done vs. open are in [docs/roadmap.md](docs/roadmap.md),
[docs/CONSOLE-STATUS.md](docs/CONSOLE-STATUS.md) (the task-by-task build log
for the operator console), and
[docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md) (the
predecessor vertical slice).

Live deployment (frontend only, marketing route):

https://runproof-frontend.sahilsilare.workers.dev

The backend is not yet deployed anywhere — it only runs locally today. See
[docs/local-development.md](docs/local-development.md) for the one-time
`wrangler d1 create` step a human needs to run before that changes.

## Repository Structure

```text
.
|-- backend/                  # Hono API on Cloudflare Workers, D1-backed
|   |-- migrations/           # D1 schema migrations (auth/incidents added in 0002)
|   `-- src/
|       |-- auth/             # Password hashing, sessions, requireAuth middleware
|       |-- domain/           # Incident/runbook/evidence/action/approval types + logic
|       |-- mcp/              # Fixture-backed evidence collectors (logs, metrics, deploys)
|       |-- store/            # Store interface + D1 and in-memory adapters (shared conformance suite)
|       `-- routes/           # auth, incidents, runs, runbooks, approvals, audit, overview
|-- docs/                     # Deployment, roadmap, local dev, and status documentation
|-- frontend/                 # Next.js app: marketing landing page (/) + operator console (/app/*)
|   |-- public/brand/         # Generated logo assets
|   |-- public/illustrations/ # Product illustration assets
|   `-- src/
|       |-- app/              # App routes: /, /login, /register, /app/* console screens
|       `-- lib/              # Typed API client for the backend
`-- testing/
    |-- runbooks/             # checkout-failure.json runbook (+ two more)
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
migrations, the `NEXT_PUBLIC_API_URL` variable, and how to register the first
user — is in [docs/local-development.md](docs/local-development.md). Quick
start:

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

Open `http://localhost:3000/` for the landing page, or register at
`http://localhost:3000/register` to reach the live operator console at
`/app` (needs the backend running).

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

As of the last full run (2026-08-26, from a fresh `npm ci`): backend 242/242
tests passing, frontend 151/151 tests passing, both typecheck/lint/build
clean. A full headless-browser walkthrough of every screen plus curl-level
guard checks (401 with no session, 409 on a double-approve) is recorded in
`.superpowers/sdd/2026-08-26-operator-console/task-b12-report.md`. There is
no ESLint config for `backend/` yet and no CI workflow — both are open items
in [docs/roadmap.md](docs/roadmap.md) (Phase 0, F3).

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
[docs/roadmap.md](docs/roadmap.md). The short version: Phases 0–3, 6–7, and
9 (foundations, domain model, runbook format, evidence collection, the
approval gate, the API surface, and the full operator console frontend) are
built. Phase 4 (real sandbox execution), Phase 5 (a computed risk model), and
Phase 8 (full run replay) are still open.

The intended product direction is a system where agent actions are explainable, replayable, and gated by evidence.
