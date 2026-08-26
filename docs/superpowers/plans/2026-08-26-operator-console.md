# Operator Console Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Live status: [`docs/CONSOLE-STATUS.md`](../../CONSOLE-STATUS.md) — read before starting, update when you finish.

**Goal:** An authenticated multi-screen operator console with a left sidebar and tabbed run detail, backed by real APIs.

**Spec:** [`docs/superpowers/specs/2026-08-26-operator-console-design.md`](../specs/2026-08-26-operator-console-design.md)

**Tech Stack:** Hono 4.13, Cloudflare Workers + D1, Zod 4.4, Vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.22, Next.js 16 / React 19, Tailwind.

## Global Constraints

- `compatibility_date` is **2026-08-15** in `backend/` (local workerd refuses later dates), 2026-08-24 in `frontend/`. Never raise the backend one.
- `@cloudflare/vitest-pool-workers@0.22.0` exports only `.`, `./types`, `./codemods/…`. There is **no `/config` subpath** and no `defineWorkersConfig`. Use the `cloudflareTest` plugin; `readD1Migrations` is a **root** export.
- Test-only bindings go in `backend/src/test-env.d.ts` — `wrangler types` regenerates `worker-configuration.d.ts` and would clobber edits to it.
- `gates` is an upsert; **`audit_log` is append-only and must never get `ON CONFLICT`**. Its PRIMARY KEY rejection is the enforcement.
- Domain modules are PURE — no `fetch`, no bindings, no internal `Date.now()`/`new Date()` for "now". Clocks inject at the route boundary.
- Types inferred from Zod via `z.infer`. No `any` — use `unknown` and narrow. No mutation.
- `noUncheckedIndexedAccess` is ON.
- `executor.ts` has exactly two functions and **no `execute(action, token?)` wrapper**. That split is what makes bypassing approval a compile error. Never unify them.
- SQL: always `.prepare(...).bind(...)`. Never interpolate.
- Conventional commits. Never run `wrangler deploy`, `wrangler login`, `wrangler d1 create`, or any `--remote` command.

## File Structure

```text
backend/src/
├── auth/
│   ├── password.ts        PBKDF2 hash/verify via SubtleCrypto
│   ├── session.ts         session create/resolve/revoke
│   └── middleware.ts      requireAuth
├── store/
│   ├── d1.ts              createD1Store
│   ├── memory.ts          createMemoryStore
│   └── conformance.ts     shared suite, both adapters
├── domain/store.ts        the interface only
└── routes/
    ├── auth.ts            register/login/logout/me
    ├── incidents.ts       list/create/get
    ├── runs.ts            list/get/start
    ├── runbooks.ts        list/get
    └── audit.ts           list by run

frontend/src/app/
├── (auth)/login, register
└── app/
    ├── layout.tsx         shell: sidebar + header
    ├── page.tsx           Overview
    ├── incidents/
    ├── runs/[id]/         tabbed detail
    ├── runbooks/
    ├── history/
    └── audit/
```

---

## Phase 0 — Merge-Gate Fixes

### Task B1: Safety fixes — atomic approval and parse-on-read

**Files:** `backend/src/routes/approvals.ts`, `backend/src/domain/store.ts`
**Tests:** `backend/src/routes/routes.test.ts`, `backend/src/domain/store.test.ts`

- [ ] **C1 — atomic claim.** Before minting a token, claim the run with a conditional update:
```sql
UPDATE runs SET state = ?, updated_at = ? WHERE id = ? AND state = 'awaiting_approval'
```
`updateRunState` gains an `expectedState` parameter and returns whether it won (`meta.changes === 1`). Zero changes → 409 `gate_already_decided`. Claim first, then mint the token, then execute.

- [ ] **Concurrency test.** Fire two `POST /approvals/:id/approve` in the same tick with `Promise.all`. Assert exactly one 200 and one 409, and exactly ONE `action_executed` entry in the audit log. This test must fail against the current code.

- [ ] **C2 — re-derive on read.** `getAction` becomes `return createAction(JSON.parse(record.data))` — `createAction` recomputes `isStateChanging` from `kind` and ignores any stored value. Test: write an `actions` row with `{kind:"rollback", isStateChanging:false}` directly, read it back, assert `isStateChanging === true`.

- [ ] **M9 — `getGate` parses.** Validate the gate union with Zod on read rather than casting. A corrupt `expiresAt` must fail loudly, not produce an immortal gate.

### Task B2: Evidence honesty — surface failures, gate on the server

**Files:** `backend/src/routes/run.ts`, `backend/src/routes/approvals.ts`, `backend/src/index.ts`

- [ ] **I1 — return `failures`.** `POST /incidents/:id/run` returns `failures: failures.map(f => ({ source: f.kind, message: f.message }))`. Append one `evidence_partial` audit entry when non-empty. Test: inject a throwing collector, assert the response names the failed source.

- [ ] **I3 — server-side evidence gate.** `POST /approvals/:id/approve` refuses a gate whose packet has zero cards: 409 `insufficient_evidence`. This currently lives only in the browser. Test at the route.

- [ ] **I2 — error mapping.** Domain guard errors (`approver identity required`, `rejection reason required`) map to 400 `validation_failed`, not 500. Add the empty-approver test.

---

## Phase 1 — Storage Seam and Auth

### Task B3: Store seam + memory adapter + conformance suite

**Files:** `backend/src/domain/store.ts` (interface only), `backend/src/store/{d1,memory,conformance}.ts`

- [ ] Move `createD1Store` to `src/store/d1.ts`; `src/domain/store.ts` keeps only types and the interface.
- [ ] Write `createMemoryStore()` — same interface, Maps inside, no D1.
- [ ] Write `conformance.ts` exporting `runStoreConformance(name, makeStore)`. Every existing store test moves into it. Run it twice: once against D1, once against memory. **Both must pass identically.**
- [ ] Interface grows: `listIncidents(filter?)`, `getIncident(id)`, `createIncident(row)`, `listRuns(filter?)`, `listRunsByIncident(id)`, `createUser`, `getUserByEmail`, `getUserById`, `createSession`, `getSession`, `deleteSession`, `deleteExpiredSessions`.
- [ ] `getPacketByIncident` orders deterministically by `built_at`, not by UUID (M1).

### Task B4: Auth backend

**Files:** `backend/src/auth/{password,session,middleware}.ts`, `backend/src/routes/auth.ts`, `backend/migrations/0002_auth.sql`

- [ ] `hashPassword(plain, salt?)` / `verifyPassword(plain, hash, salt)` using PBKDF2-SHA256, 210,000 iterations, 16-byte random salt, constant-time compare. Pure except for `crypto`.
- [ ] Sessions: create (30-day expiry), resolve (returns null when expired), revoke.
- [ ] `requireAuth` middleware → 401 `unauthenticated` without a valid cookie; sets `c.var.user`.
- [ ] Routes: register (rejects duplicate email 409 `email_taken`, weak password 400), login (401 `invalid_credentials` — **same message for unknown email and wrong password**, never leak which), logout, me.
- [ ] Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`.
- [ ] Mount `requireAuth` on `/incidents/*`, `/runs/*`, `/approvals/*`, `/audit/*`.
- [ ] **Remove `by` from approve/reject request bodies.** The approver comes from `c.var.user.email`. Update existing route tests.

### Task B5: Incidents as first-class + listing APIs

**Files:** `backend/migrations/0003_incidents.sql`, `backend/src/routes/{incidents,runs,runbooks,audit}.ts`

- [ ] `incidents` table; `runs` gains `created_by` and an `incident_id` FK.
- [ ] `GET /incidents` (filter by status), `POST /incidents`, `GET /incidents/:id`
- [ ] `GET /runs` (recent, paginated), `GET /runs/:id` → run + packet + action + gate + failures
- [ ] `GET /runbooks`, `GET /runbooks/:id` — expose `allowedSources` and steps so the console can show scope
- [ ] `GET /audit?runId=` — ordered entries
- [ ] `GET /overview` — counts: awaiting approval, active incidents, runs today; plus recent activity

---

## Phase 2 — Frontend Auth and Shell

### Task B6: Login, register, route guard

**Files:** `frontend/src/app/(auth)/login/page.tsx`, `register/page.tsx`, `frontend/middleware.ts`, `frontend/src/lib/auth.ts`

- [ ] Client functions: `register`, `login`, `logout`, `me`. `credentials: "include"` on every request.
- [ ] Next middleware guards `/app/*`, redirects to `/login?next=…` server-side.
- [ ] Forms show field-level validation and a general error. Never reveal whether an email exists.
- [ ] Tests: submitting invalid input surfaces errors; a failed login shows the generic message.

### Task B7: The app shell

**Files:** `frontend/src/app/app/layout.tsx`, `frontend/src/app/app/components/{Sidebar,TopBar}.tsx`

- [ ] Persistent left sidebar: Overview, Incidents, Runbooks, History, Audit. Active route highlighted. Collapsible on narrow viewports.
- [ ] Top bar: current user email, logout, and a count badge for gates awaiting approval.
- [ ] Match the existing design language — the landing page's tokens, type scale, and Tailwind conventions. **Do not introduce a new styling system.** Read `globals.css` and `RunbookPreview.tsx` first.
- [ ] Tests: sidebar marks the active route; logout calls the API and redirects.

---

## Phase 3 — Screens

### Task B8: Overview
`/app` — awaiting-approval count (the number that matters), active incidents, recent activity feed. Each awaiting item links to its run. Loading, empty, and error states all present.

### Task B9: Incidents list + create
`/app/incidents` — table with status filter, links to runs. `/app/incidents/new` — service + signals form that shows the **matched runbook and its `allowedSources` scope before you start**, so the operator sees what the agent will be permitted to touch. No match → say so and refuse to start.

### Task B10: Run detail with tabs
`/app/runs/:id` — four tabs: **Evidence** (cards grouped by source, expandable to raw payload, banner when `failures` is non-empty), **Diagnostics** (sandbox output, labelled as fixture), **Approval** (reuse `RunbookPreview`'s panels; Approve disabled when the packet has zero cards or the gate is decided), **Audit** (this run's entries). Tab state lives in the URL (`?tab=evidence`) so it is shareable.

### Task B11: Runbooks, History, Audit
`/app/runbooks` — cards showing each runbook's trigger, steps, `allowedSources`, and proposed action. `/app/history` — past runs, decision, approver, timestamp. `/app/audit` — the append-only trail, filterable by run, newest first.

---

## Phase 4 — Verification

### Task B12: End-to-end verification and docs
Clean `npm ci` on both packages, full suites, build. Drive the real flow: register → login → create incident → start run → inspect evidence → approve → verify persisted → logout. Screenshot every screen. Update `README.md`, `docs/local-development.md`, `docs/roadmap.md`. Report anything broken rather than fixing it.
