# Local Development

RunProof is two Cloudflare Workers run locally as two separate dev servers: a
Hono API (`backend/`, port `8787`) backed by a local D1 database, and a
Next.js frontend (`frontend/`, port `3000`) that talks to it over HTTP. Both
must be running for the `/app` operator console to show real data.

## Prerequisites

- Node.js 22 LTS
- npm (the repo uses `package-lock.json`, not yarn/pnpm)

## 1. Backend — `backend/`

```bash
cd backend
npm ci
npm run db:migrate   # applies migrations/ to a local D1 sqlite file, idempotent
npm run dev           # wrangler dev, http://localhost:8787
```

`npm run db:migrate` runs `wrangler d1 migrations apply runproof-db --local`.
It writes a local SQLite file under `backend/.wrangler/state/v3/d1/` — this is
**not** a real Cloudflare D1 database, just wrangler's local emulation, and it
persists across `wrangler dev` restarts in the same checkout. Re-running the
command is safe; it prints `✅ No migrations to apply!` once the schema is
current. As of this writing there are two migrations: `0001_init.sql` (the
original evidence/gate/audit schema) and `0002_auth_and_incidents.sql`
(`users`, `sessions`, `incidents`, plus `runs.created_by` / `packets.built_at`).

Useful checks:

```bash
npm test        # vitest — 242 tests as of this writing
npm run typecheck
```

To inspect the local D1 state directly (e.g. to confirm a row persisted):

```bash
npx wrangler d1 execute runproof-db --local --command "SELECT * FROM gates"
npx wrangler d1 execute runproof-db --local --command "SELECT id, email FROM users"
npx wrangler d1 execute runproof-db --local --command "SELECT id, state, decided_by FROM runs ORDER BY created_at DESC LIMIT 5"
```

## 2. Frontend — `frontend/`

```bash
cd frontend
npm ci
npm run dev      # next dev, http://localhost:3000
```

Open `http://localhost:3000/` for the marketing landing page. Everything
under `http://localhost:3000/app/*` is the live operator console and requires
being logged in — an unauthenticated visit to any `/app/*` route redirects to
`/login?next=<path>`.

### `NEXT_PUBLIC_API_URL`

The frontend's API client (`frontend/src/lib/api.ts`) reads
`NEXT_PUBLIC_API_URL` to know where the backend lives, defaulting to
`http://localhost:8787` when unset — so a plain `npm run dev` needs no
`.env` file as long as the backend runs on its default port. See
`frontend/.env.example`:

```bash
cp frontend/.env.example frontend/.env.local
# NEXT_PUBLIC_API_URL=http://localhost:8787
```

Set it to a deployed backend URL (e.g. `https://runproof-api.<account>.workers.dev`)
when pointing the frontend at a non-local backend. Because this is a
`NEXT_PUBLIC_*` variable, it is inlined into the client bundle at build time —
changing it requires a rebuild, not just a restart.

The API client also always sends `credentials: "include"` on every request —
this is what lets the session cookie survive a page reload and what CORS's
`credentials: true` (backend `index.ts`) has to match. If you fork this to a
different frontend origin, both sides of that contract need to move together
or auth silently breaks (requests still "succeed" but come back `401`).

## 3. Registering the first user

There is no seeded operator account and no admin bootstrap — the very first
user is created the same way every later one is, through the UI or the API.

**Via the UI:** with both servers running, open
`http://localhost:3000/register`, enter an email and a password of **at least
12 characters**, and submit. You're immediately signed in and redirected to
`/app`.

**Via curl**, if you want a session cookie for scripting against the API
directly:

```bash
curl -c cookies.txt -X POST http://localhost:8787/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"at-least-12-characters"}'

# cookies.txt now holds the session cookie; reuse it with -b cookies.txt
curl -b cookies.txt http://localhost:8787/incidents
```

Passwords are hashed with PBKDF2-SHA256 (210,000 iterations) — see
`backend/src/auth/password.ts`. Sessions are 30-day cookies resolved against
the `sessions` table on every request via `requireAuth` middleware; there is
no "remember me" toggle or shorter-lived option yet.

## 4. Exercising the API directly

With the backend running and a session cookie from step 3, the full
incident → evidence → approval flow can be driven with curl:

```bash
# 1. Create an incident
curl -b cookies.txt -X POST http://localhost:8787/incidents \
  -H 'Content-Type: application/json' \
  -d '{"title":"Checkout errors spiking","service":"payment-service","signals":["timeout","error_rate"]}'
# → note the returned "id"

# 2. Start the run — matches a runbook, collects evidence, returns a locked gate
curl -b cookies.txt -X POST http://localhost:8787/incidents/<incidentId>/run \
  -H 'Content-Type: application/json' \
  -d '{"service":"payment-service","signals":["timeout","error_rate"]}'
# → returns { run, packet, action, gate, failures } — no "execution" field yet,
#   gate.state is "locked". Note gate.id (it equals the run id).

# 3. Fetch the run detail again any time
curl -b cookies.txt http://localhost:8787/runs/<runId>

# 4. Approve the gate
curl -b cookies.txt -X POST http://localhost:8787/approvals/<gateId>/approve \
  -H 'Content-Type: application/json' -d '{}'
# → gate.state becomes "approved" and an "execution" result is returned
# (execution is SIMULATED — see "What's not built" below). Approver identity
# comes from the session cookie, not the request body.

# 5. Approving the same gate again returns 409 gate_already_decided
```

Other useful reads: `GET /overview` (counts for the console's header badge),
`GET /runbooks`, `GET /runs?state=` (backs the `/app/history` screen), and
`GET /audit?runId=<runId>` or `GET /audit` (backs `/app/audit`) for the full
trail.

Every route above except `/auth/*` and `/health` requires the session cookie;
a request with no cookie (or an expired/unknown one) gets a uniform
`401 unauthenticated` — the backend deliberately does not distinguish "no
cookie" from "bad cookie" in the response.

## 5. One-time setup before any real deploy

**Nobody has run this yet.** `backend/wrangler.jsonc` currently points at a
placeholder D1 database:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "runproof-db",
    "database_id": "local-dev-placeholder",
    "migrations_dir": "./migrations"
  }
]
```

`local-dev-placeholder` only works for `wrangler dev --local`. Before deploying
the backend to real Cloudflare infrastructure, a human with account access must:

```bash
cd backend
npx wrangler d1 create runproof-db
```

Copy the `database_id` UUID from the command's output into
`backend/wrangler.jsonc`, then run the migrations against the **remote**
database (not `--local`) before the first deploy:

```bash
npx wrangler d1 migrations apply runproof-db --remote
```

This project's automation intentionally never runs `wrangler d1 create`,
`wrangler deploy`, `wrangler login`, or any `--remote` command — deployment is
a deliberate, human-triggered step, not something an agent does in passing.

## 6. What's not built yet

- **No real sandbox execution.** The evidence packet's diagnostic step and the
  post-approval "execution" are both simulated — see `docs/roadmap.md` Phase 4
  and Phase 5 for what real sandboxing and a computed risk model would need.
- **No computed risk model.** The risk figure shown on a run's Approval tab is
  a disclosed display heuristic derived from evidence confidence, not a
  weighted, explainable model.
- **No login rate limiting.** `/auth/login` has no throttling — do not point
  this local setup at a real production environment or a shared network.
- **No CI workflow yet.** Run the verification commands below by hand.

## 7. Full verification

```bash
cd backend && npm ci && npm run db:migrate && npm test && npm run typecheck
cd ../frontend && npm ci && npm test && npm run typecheck && npm run lint && npm run build
```

As of the last full run (2026-08-26): backend 242/242 tests, frontend 151/151
tests, both typecheck/lint/build clean from a fresh `npm ci` checkout. Full
browser walkthrough and curl-level guard checks are recorded in
`.superpowers/sdd/2026-08-26-operator-console/task-b12-report.md`.
