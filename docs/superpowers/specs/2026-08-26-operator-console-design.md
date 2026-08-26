# RunProof Operator Console — Design

**Status:** approved to build, 2026-08-26
**Supersedes scope of:** [`docs/roadmap.md`](../../roadmap.md) Phases 0–3, 6–7, 9
**Predecessor:** [`2026-08-25-approval-gate-vertical-slice.md`](../plans/2026-08-25-approval-gate-vertical-slice.md) — 12 tasks, complete, 5 defects outstanding

## Goal

Turn the single-screen demo at `/app` into a real operator console: authenticated, multi-screen, with a left sidebar and tabbed detail views, backed by APIs that make every screen real rather than seeded.

## Why the current `/app` is not an app

`DashboardClient.tsx` hardcodes `SEEDED_INCIDENT_ID = "payment-service-dashboard"` and fires `startRun` on mount. There is one incident, it cannot be chosen, and a fresh run is created on every page load. There is nothing to navigate between, no history, and no identity.

Three things are missing, in dependency order: **identity** (who is approving), **a data model with plurals** (incidents you can list), and **a shell** (somewhere to put more than one screen).

## What auth actually buys

`approve(gateId, by, reason?)` currently takes `by` as free text. The audit log records that "sahil approved this" with no evidence that sahil did. For a product whose premise is *a human approved it*, that is the weakest link in the chain.

After this work, the approver is derived from the session server-side and `by` is **removed from the request body entirely** — not validated, removed. If it is not in the payload it cannot be forged. Same reasoning that made `ApprovalToken` branded.

## Architecture

### Authentication

Session cookie plus a server-side session table.

```
POST /auth/register  { email, password }  -> creates user, opens session
POST /auth/login     { email, password }  -> Set-Cookie: rp_session=<id>
POST /auth/logout                         -> deletes the session row
GET  /auth/me                             -> { user } or 401
```

Cookie is `HttpOnly; Secure; SameSite=Lax; Path=/`. Revocation is instant — delete the row. `requireAuth` middleware guards every `/incidents/*`, `/runs/*`, `/approvals/*`, and `/audit/*` route, resolving the session to a user on `c.var.user`.

Passwords use **PBKDF2 via Web Crypto (SubtleCrypto)** — bcrypt and argon2 are unavailable on Workers. Per-user random salt, 210,000 iterations, SHA-256, constant-time comparison. Registration rejects weak passwords at the boundary with Zod.

### Storage seam

The `Store` interface moves to its own module and grows. Two implementations ship:

```
src/domain/store.ts        the interface only — the seam
src/store/d1.ts            createD1Store(db)
src/store/memory.ts        createMemoryStore()
src/store/conformance.ts   one suite, run against BOTH adapters
```

The conformance suite is the point. An interface with one implementation is an untested claim about portability. Running identical tests against two adapters is what proves the seam holds — and it makes most tests fast, since they no longer need D1. Adding Postgres later means writing `createPgStore` and passing the same suite.

### Data model

| Table | Purpose |
|---|---|
| `users` | id, email (unique), password_hash, salt, created_at |
| `sessions` | id, user_id, created_at, expires_at |
| `incidents` | **new first-class entity** — id, title, service, signals, status, created_by, created_at |
| `runs` | gains `created_by`, `incident_id` FK |
| `packets`, `actions`, `gates`, `audit_log` | unchanged |

Incidents become rows rather than a string embedded in a run. Without that there is nothing to list, and "not a proper app" is largely that there is nothing to list.

**Visibility:** any authenticated user sees every incident and run. Incident response is a team activity; per-user isolation would be wrong here. Attribution comes from who approved, recorded in `gates` and `audit_log`.

### Screens

Left sidebar, persistent across the console:

| Route | Screen | Contents |
|---|---|---|
| `/login`, `/register` | Auth | public, no shell |
| `/app` | Overview | counts awaiting approval, active incidents, recent activity feed |
| `/app/incidents` | Incidents | list with status filter, "New incident" |
| `/app/incidents/new` | Create | service + signals, matched runbook preview before starting |
| `/app/runs/:id` | Run detail | **tabbed** — see below |
| `/app/runbooks` | Runbooks | available runbooks, their `allowedSources` scope and steps |
| `/app/history` | History | past runs, their decisions and who made them |
| `/app/audit` | Audit | the append-only trail, filterable by run |

**Run detail tabs** — this is where the existing `RunbookPreview` panels live:

- **Evidence** — the packet's cards, grouped by source, each expandable to its raw payload. A banner when `failures` is non-empty.
- **Diagnostics** — sandbox output (fixture for now, honestly labelled as such)
- **Approval** — risk score, proposed action, the gate with Approve/Reject
- **Audit** — this run's entries in order

Next.js middleware guards `/app/*` server-side and redirects to `/login`. No flash of protected content. The marketing landing page at `/` is untouched.

### Merge-gate defects folded in (Phase 0)

The predecessor slice's final review found defects that this work would otherwise build on top of. Two are dashboard-correctness issues in their own right.

- **C1** — concurrent approvals both execute. Fix: claim the run with a conditional `UPDATE ... WHERE state = 'awaiting_approval'` before minting a token; zero rows changed means 409.
- **C2** — `getAction` casts instead of parsing, so a persisted `{kind:"rollback", isStateChanging:false}` row reaches `executeReadOnly` with no token check. Fix: `createAction(JSON.parse(...))` re-derives the flag. Same for `getGate` (M9).
- **I1** — `collectEvidence`'s `failures` array is dropped at the route. The console must show it.
- **I2** — domain guard errors surface as 500 instead of 400.
- **I3** — the "no approval without evidence" rule is enforced **only in the browser**. It moves to the server.

## Non-goals

Email verification, password reset, OAuth, roles and permissions, real sandbox execution, a computed risk model, replay export. Each is real work; none is needed to make this a proper console.

**Rate limiting on `/auth/login` is the first thing to add before this is ever internet-facing.** It is not in scope here and that is a deliberate, recorded gap.

## Testing

- Conformance suite runs against both store adapters.
- Auth: registration rejects duplicates and weak passwords; login rejects wrong passwords; sessions expire; `requireAuth` returns 401 without a cookie; logout revokes immediately.
- The server-side evidence gate: approving a gate whose packet has zero cards returns 4xx, tested at the route, not the component.
- C1 gets a genuine concurrency test — two approvals in the same tick, asserting exactly one execution.
- Component tests for the shell, sidebar active state, and each screen's loading/empty/error states.
