# Local Development

RunProof is two Cloudflare Workers run locally as two separate dev servers: a
Hono API (`backend/`, port `8787`) backed by a local D1 database, and a
Next.js frontend (`frontend/`, port `3000`) that talks to it over HTTP. Both
must be running for the `/app` dashboard to show real data.

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
current.

Useful checks:

```bash
npm test        # vitest — 114 tests as of this writing
npm run typecheck
```

To inspect the local D1 state directly (e.g. to confirm a row persisted):

```bash
npx wrangler d1 execute runproof-db --local --command "SELECT * FROM gates"
```

## 2. Frontend — `frontend/`

```bash
cd frontend
npm ci
npm run dev      # next dev, http://localhost:3000
```

Open `http://localhost:3000/` for the marketing landing page, or
`http://localhost:3000/app` for the live operator dashboard. `/app` calls the
backend on load (`POST /incidents/inc-demo-1/run`) and renders the returned
evidence packet, risk score, and approval gate.

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

## 3. Exercising the API directly

With the backend running, the full evidence → approval flow can be driven with
curl:

```bash
# 1. Kick off a run — returns evidence cards and a locked gate, no execution field
curl -X POST http://localhost:8787/incidents/inc-demo-1/run \
  -H 'Content-Type: application/json' \
  -d '{"service":"payment-service","signals":["timeout","error_rate"]}'

# 2. Fetch the packet independently
curl http://localhost:8787/incidents/inc-demo-1/packet

# 3. Approve the gate returned in step 1 (use its "gate.id")
curl -X POST http://localhost:8787/approvals/<gateId>/approve \
  -H 'Content-Type: application/json' \
  -d '{"by":"your-name"}'
# → gate.state becomes "approved" and an "execution" result is returned
# (execution is SIMULATED — see "What's not built" below)

# 4. Approving the same gate again returns 409 gate_already_decided
```

There is no separate `GET` endpoint for gate state — the persisted decision
can be read back via `wrangler d1 execute --local` as shown above, or by
attempting a second approve/reject and observing the `gate_already_decided`
error.

## 4. One-time setup before any real deploy

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
`backend/wrangler.jsonc`, then run the migration against the **remote**
database (not `--local`) before the first deploy:

```bash
npx wrangler d1 migrations apply runproof-db --remote
```

This project's automation intentionally never runs `wrangler d1 create`,
`wrangler deploy`, `wrangler login`, or any `--remote` command — deployment is
a deliberate, human-triggered step, not something an agent does in passing.

## 5. What's not built yet

- **No real sandbox execution.** The evidence packet's diagnostic step and the
  post-approval "execution" are both simulated — see `docs/roadmap.md` Phase 4
  and Phase 5 for what real sandboxing and a computed risk model would need.
- **No auth.** The `by` field on an approval is free text. Do not point this
  local setup at a real production environment or a shared network.
- **No CI workflow yet.** Run the verification commands below by hand.

## 6. Full verification

```bash
cd backend && npm ci && npm run db:migrate && npm test && npm run typecheck
cd ../frontend && npm ci && npm test && npm run typecheck && npm run lint && npm run build
```
