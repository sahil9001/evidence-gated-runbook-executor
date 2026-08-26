# Operator Console — Implementation Status

**Handoff record between agents. Read before starting; update when you stop.**

- **Plan:** [`docs/superpowers/plans/2026-08-26-operator-console.md`](superpowers/plans/2026-08-26-operator-console.md)
- **Spec:** [`docs/superpowers/specs/2026-08-26-operator-console-design.md`](superpowers/specs/2026-08-26-operator-console-design.md)
- **Predecessor:** the 12-task vertical slice ([`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md)) — complete, defects folded into Phase 0 here
- **Started:** 2026-08-26

## Protocol

1. Read this file, then your task in the plan. Check your dependencies are `✅ done`.
2. Claiming a task: set `🔨 in progress` and your agent name.
3. Finishing: set `✅ done`, put the **actual command output you saw** in `Verified by`, append a Handoff Log entry.
4. Blocked: set `🚧 blocked` and write why in the log. Never leave a task silently unfinished.
5. Never mark done without running the verification. "It should work" is not a status.

## Task Table

| # | Task | Phase | Depends on | Status | Agent | Verified by |
|---|---|---|---|---|---|---|
| B1 | Atomic approval (C1) + parse-on-read (C2, M9) | 0 | — | ✅ done | impl-b1 | 117/117; race reproduced [200,200] then closed [200,409] |
| B2 | Surface `failures` (I1), server evidence gate (I3), error mapping (I2) | 0 | B1 | ✅ done | impl-b2 | 122/122 (117 baseline + 5 new); RED confirmed by stashing source fixes only |
| B3 | Store seam + memory adapter + conformance suite | 1 | B1 | ✅ done | impl-b3 | 167/167 (122 baseline − 15 moved + 58 conformance ×2-adapters + 2 D1-only); typecheck clean; `db:migrate` applied 0002 cleanly (9 commands) |
| B4 | Auth backend — PBKDF2, sessions, `requireAuth` | 1 | B3 | ✅ done | impl-b4 | 206/206 (167 baseline + 39 new: 6 password + 9 session + 4 middleware + 20 auth routes); typecheck clean; `db:migrate` — no migrations to apply (0002 already covers users/sessions) |
| B5 | Incidents entity + listing APIs | 1 | B4 | ⬜ not started | — | — |
| B6 | Frontend auth pages + route guard | 2 | B4 | ⬜ not started | — | — |
| B7 | App shell — sidebar + top bar | 2 | B6 | ⬜ not started | — | — |
| B8 | Overview screen | 3 | B5, B7 | ⬜ not started | — | — |
| B9 | Incidents list + create flow | 3 | B8 | ⬜ not started | — | — |
| B10 | Run detail with 4 tabs | 3 | B9 | ⬜ not started | — | — |
| B11 | Runbooks, History, Audit screens | 3 | B10 | ⬜ not started | — | — |
| B12 | End-to-end verification + docs | 4 | B11 | ⬜ not started | — | — |

**Progress: 4 / 12.**

## Invariants — do not "fix" these

| Rule | Why |
|---|---|
| `executor.ts` has two functions, **no `execute(action, token?)` wrapper** | The split makes bypassing approval a compile error. Verified: 3 bypass routes are TS2554/TS2345 |
| `audit_log` never gets `ON CONFLICT` | Its PRIMARY KEY rejection IS the append-only enforcement. `gates` is an upsert; audit is not |
| backend `compatibility_date` is 2026-08-15 | Local workerd refuses later dates. Frontend stays 2026-08-24 |
| No `defineWorkersConfig` / no `/config` subpath | Not in `@cloudflare/vitest-pool-workers@0.22.0`. Use `cloudflareTest`; `readD1Migrations` is a root export |
| Test bindings live in `src/test-env.d.ts` | `wrangler types` regenerates `worker-configuration.d.ts` and clobbers edits |
| `by` is NOT accepted in approve/reject bodies | The approver comes from `c.var.user.email` (the session `requireAuth` resolved). Absent from the payload = unforgeable |
| Domain layer is pure | No `Date.now()` inside; clocks inject at the route boundary |

## Handoff Log

### 2026-08-26 — impl-b4 — B4 done

`auth/password.ts`: PBKDF2-SHA256 via `crypto.subtle`, 210,000 iterations, 16-byte random salt, 32-byte derived key, both base64. Constant-time compare prefers the Workers-native `crypto.subtle.timingSafeEqual` (present in `worker-configuration.d.ts` and in miniflare's own runtime) when both inputs are the same length, else falls back to a hand-rolled XOR-accumulate loop over the full length — covers both "API missing" and "a tampered hash of a different length" without branching on where the mismatch is.

`auth/session.ts`: pure logic over `Store` — `createSession` (30-day `SESSION_TTL_MS` default, `crypto.randomUUID()` id, `expiresAt` from an injected `nowIso`), `resolveSession` (null for missing *or* expired, `>=` boundary matching `Store#deleteExpiredSessions`'s `<=`), `revokeSession` (idempotent `deleteSession`). No `Date.now()`/`new Date()` inside — same discipline as the rest of the domain layer, even though this lives under `src/auth/` rather than `src/domain/`.

`auth/middleware.ts`: `requireAuth` via `hono/factory`'s `createMiddleware`. No cookie, an unknown session, and an expired session all produce identical `401 unauthenticated` — the same "don't distinguish reasons" discipline B4's login endpoint uses for credentials. `toPublicUser` strips `passwordHash`/`salt` before anything downstream ever sees a `UserRow`.

`routes/auth.ts`: register (409 `email_taken` pre-checked *and* caught post-insert against D1's `UNIQUE` constraint on `users.email` — same TOCTOU shape B1 closed for approval claims, closed the same way; a concurrent-registration race test in `auth.test.ts` reproduces it, `Promise.all` style); login (401 `invalid_credentials`, byte-identical body for unknown-email and wrong-password, `verifyPassword` always runs — against a hardcoded dummy hash/salt when no user was found — so the unknown-email path costs the same 210k-iteration PBKDF2 derivation as the wrong-password path, closing the timing side of enumeration alongside the response-body side); logout (idempotent, works with no cookie); me (behind `requireAuth`).

`by` removed from `approveBodySchema`/`rejectBodySchema` in `approvals.ts` — not validated, *absent*, so a client-supplied `by` is silently stripped by Zod and never reaches `approveGate`/`rejectGate`. Approver is `c.var.user.email`. B1's atomic-claim ordering and B2's evidence-gate/validation ordering in that file are untouched — verified via diff, only the `by` source and comments changed. `index.ts` mounts `requireAuth` on `/incidents/*`, `/runs/*`, `/approvals/*`, `/audit/*`; `/auth/*` and `/health` stay public. `routes.test.ts` updated: one operator registered in `beforeAll`, its cookie attached by the `post`/`get` test helpers by default; new test confirms approving with no cookie is 401 and leaves no audit trace.

Backend 206/206 (167 baseline + 39 new), typecheck clean, `db:migrate` clean (no new migration needed — B3's `0002` already has `users`/`sessions`). Full report: `.superpowers/sdd/2026-08-26-operator-console/task-b4-report.md`. **Known gap, explicitly out of scope:** no rate limiting on `/auth/login` — first thing to add before this API is internet-facing. Next agent: B5 (incidents entity + listing APIs) — auth is fully wired, `c.var.user` is available on every protected route B5 adds.

### 2026-08-26 — impl-b3 — B3 done

Split the seam: `domain/store.ts` now holds only types (`RunRow`, `AuditEntry`, new `IncidentRow`/`UserRow`/`SessionRow`) and the `Store` interface — no D1, importable without a Worker runtime. `store/d1.ts` has `createD1Store`, moved verbatim (B1/B2's parse-on-read and `expectedState` logic untouched) plus the new methods. `store/memory.ts` has `createMemoryStore()` — plain `Map`s, `structuredClone` on every read/write so callers can never mutate internal state, explicit duplicate-id rejection in `appendAudit` (D1 gets this from `audit_log`'s PRIMARY KEY), and `getAction`/`getGate` re-derive/validate on read exactly like D1 (`createAction(...)`, `approvalGateSchema.parse(...)`) even though memory never round-trips through an untyped blob.

`store/conformance.ts` exports `runStoreConformance(name, makeStore)` — 29 tests covering every method, run once against each adapter (`store/d1.test.ts`, `store/memory.test.ts`) via the identical suite. Two tests could not be replicated for memory and stayed D1-only (documented in a doc comment on `runStoreConformance`): they bypass `Store` and hand-write a corrupted `TEXT` row directly via `env.DB.prepare(...)` (C2's tampered `isStateChanging`, M9's garbage `expiresAt`) — memory has no equivalent bypass since it never serializes to an untyped blob. Ordinary round-tripping through the re-derive/validate-on-read path is still required of both adapters and is covered in the shared suite.

M1 fixed: `getPacketByIncident` now orders `built_at DESC` (new column, backfilled going forward via `savePacket`) instead of the old `ORDER BY id`, which returned an arbitrary packet for any incident with more than one. Interface grew per the plan: `listIncidents`/`getIncident`/`createIncident`, `listRuns`/`listRunsByIncident`, `createUser`/`getUserByEmail`/`getUserById`, `createSession`/`getSession`/`deleteSession`/`deleteExpiredSessions` — implemented in both adapters, storage only, no hashing/routes/HTTP.

Migration `0002_auth_and_incidents.sql` (created via `wrangler d1 migrations create`) adds `users`, `sessions`, `incidents`, and nullable `runs.created_by` / `packets.built_at` via `ALTER TABLE` (D1/SQLite can't add a NOT NULL column without a default to an existing table). Applied locally cleanly (9 commands).

Backend 167/167 (122 baseline − 15 old store tests moved/superseded + 29 conformance tests × 2 adapters + 2 D1-only defence-in-depth tests), typecheck clean. Import sites (`routes/{approvals,packet,run}.ts`, `routes/routes.test.ts`) updated to `../store/d1`. Full report: `.superpowers/sdd/2026-08-26-operator-console/task-b3-report.md`. Next agent: B4 (auth backend) — `users`/`sessions` tables and Store methods are ready; B4 adds PBKDF2 hashing, session middleware, and routes on top.

### 2026-08-26 — impl-b2 — B2 done

I1: `run.ts`'s handler is now a `createRunRoutes(sources = ALL_SOURCES)` factory; response gains `failures`, one `evidence_partial` audit entry appended when non-empty. I3: approve handler loads the run's packet via `store.getPacketByIncident` and refuses 409 `insufficient_evidence` on zero cards, checked before the atomic claim. I2: new `ApprovalInputError` in `approval.ts` (pure, no HTTP concepts); route wraps `approveGate`/`rejectGate` and maps it to 400 `validation_failed`.

Reordering note: in both approve and reject, `approveGate`/`rejectGate` now run *before* B1's atomic claim, not after. They're pure (mint a token/gate object, touch nothing), so this costs nothing on a race's losing side, and it means a validation failure (I2) or evidence-gate refusal (I3) never claims the run first — avoiding a strand-the-run bug the same shape as I4 that the old ordering had for whitespace-only input. B1's claim mechanism itself (`updateRunState` + `expectedState`) is untouched.

Backend 122/122 (117 + 5 new), frontend 14/14, typecheck clean. Full report: `.superpowers/sdd/2026-08-26-operator-console/task-b2-report.md`. Next agent: B3 (store seam).

### 2026-08-26 — orchestrator — plan written

Spec and plan committed. Phase 0 folds in the five merge-gate defects from the predecessor slice's final review (`.superpowers/sdd/2026-08-25-approval-gate-vertical-slice/final-review.md`) rather than landing them separately — I1 and I3 are console-correctness bugs, not just backend hygiene.

Baseline: backend 114/114, frontend 14/14, both green. Next agent: start B1.
