# Implementation Status — Approval Gate Vertical Slice

**This file is the handoff record between agents. Read it before starting work; update it when you stop.**

- **Plan:** [`docs/superpowers/plans/2026-08-25-approval-gate-vertical-slice.md`](superpowers/plans/2026-08-25-approval-gate-vertical-slice.md)
- **Spec:** [`docs/roadmap.md`](roadmap.md)
- **Started:** 2026-08-25
- **Last updated:** 2026-08-25 — T1, T2, T3 ✅ complete; T4 in progress

## Protocol for Agents

1. **Before starting a task:** read this file top to bottom, then read your task in the plan. Check that every task in your `Depends on` column is `✅ done`.
2. **When you claim a task:** set its status to `🔨 in progress` and put your agent name in `Agent`.
3. **When you finish:** set status to `✅ done`, fill in `Verified by` with the **actual command output you saw** (e.g. `14 tests passed`), and append a Handoff Log entry.
4. **If you get blocked:** set status to `🚧 blocked`, and write what blocked you in the Handoff Log. Do not leave a task silently unfinished.
5. **Never mark a task done without running its verification command.** "It should work" is not a status.

Status values: `⬜ not started` · `🔨 in progress` · `✅ done` · `🚧 blocked` · `⏭️ skipped`

---

## Task Table

| # | Task | Wave | Depends on | Status | Agent | Verified by |
|---|---|---|---|---|---|---|
| T1 | Backend scaffold (Hono + Vitest + wrangler + D1 binding) | 1 | — | ✅ done | impl-t1 | `npm test` 2/2 passed; cold `typecheck` exit 0 after deleting generated types |
| T2 | Evidence domain types (`EvidenceCard`, `EvidencePacket`) | 2 | T1 | ✅ done | impl-t2 | suite 28/28; weakest-card test proven to fail against a last-card-wins bug |
| T3 | Action model + non-forgeable `ApprovalToken` | 2 | T1 | ✅ done | impl-t3 | brand verified: outside module cannot mint a token (TS2741); 17 tests incl. full state machine |
| T4 | Runbook schema, loader, matcher + `checkout-failure.json` | 3 | T2, T3 | 🔨 in progress | impl-t4 | — |
| T5 | Fixture-backed evidence collectors + fixtures | 3 | T2 | ⬜ not started | — | — |
| T6 | Packet builder with scope enforcement | 4 | T4, T5 | ⬜ not started | — | — |
| T7 | D1 migration + repository layer | 3 | T2, T3 | ⬜ not started | — | — |
| T8 | Token-gated executor + safety bypass suite | 4 | T3 | ⬜ not started | — | — |
| T9 | API routes (`run`, `packet`, `approve`, `reject`) | 5 | T6, T8 | ⬜ not started | — | — |
| T10 | Frontend typed API client + frontend Vitest | 6 | T9 | ⬜ not started | — | — |
| T11 | `/app` dashboard route wired to live data | 6 | T10 | ⬜ not started | — | — |
| T12 | End-to-end verification + docs | 7 | T11 | ⬜ not started | — | — |

**Progress: 3 / 12 complete.**

## Wave Schedule

Waves record the dependency graph. **Execution is sequential**, one implementer at a
time — every task commits into the same worktree and all of them write this file, so
concurrent agents would interleave each other's staged files. See the pre-flight
ruling in the ledger.

| Wave | Tasks | Dependency-parallel |
|---|---|---|
| 1 | T1 | no — everything depends on it |
| 2 | T2, T3 | yes |
| 3 | T4, T5, T7 | yes |
| 4 | T6, T8 | yes |
| 5 | T9 | no |
| 6 | T10, T11 | sequential (T11 needs T10's client) |
| 7 | T12 | no |

---

## Locked Decisions

Settled with the project owner on 2026-08-25. Do not relitigate these mid-implementation; if one turns out to be wrong, record it in the Handoff Log and stop.

| ID | Decision | Choice |
|---|---|---|
| D1 | Backend runtime | Separate Cloudflare Worker in `backend/`, Hono 4.13 |
| D2 | Persistence | Cloudflare D1, binding `DB`, database `runproof-db` |
| D3 | Sandbox execution | **Deferred** — fixture only, not in this slice |
| D4 | Evidence sources | Fixture-backed behind the `EvidenceSource` interface |
| D5 | Auth | ~~**None** — `by` is free text~~ **Superseded 2026-08-28** by PRs #7/#8/#10: session auth, `approvedBy` derived from the session. See the Handoff Log entry below |
| D6 | Scope | Vertical slice only (roadmap Part 5) |

Additional decisions made while writing the plan:

| Decision | Rationale |
|---|---|
| `compatibility_date` is **2026-08-15** in `backend/`, 2026-08-24 in `frontend/` | The workerd shipped with vitest-pool-workers 0.22.0 refuses to start a Worker dated later. Lowering the date beats pinning a prerelease miniflare through npm `overrides`. The frontend has no local Workers test runtime, so nothing constrains it |
| `defineWorkersConfig` does **not** exist | `@cloudflare/vitest-pool-workers@0.22.0` exports only `.`, `./types`, `./codemods/…`. Use the `cloudflareTest` plugin form. `readD1Migrations` is a **root** export — Task 7 needs this |
| Runbooks and fixtures are **JSON, not YAML** | Workers have no filesystem; JSON imports natively via `import … with { type: "json" }` and avoids bundling a YAML parser |
| `ApprovalToken` is a **branded type** | Makes "execute without approval" a compile error rather than a runtime check. The brand symbol is not exported, so `approveGate` is the only mint |
| **No** `execute(action, token?)` wrapper | Two functions with different arities is what makes the bypass a type error. Adding a convenience wrapper would silently destroy the guarantee |
| Frontend types are a **structural mirror**, not a shared import | Separate Workers, separate builds. `frontend/src/lib/types.ts` names which backend module each type shadows so drift shows up in review |
| Execution is **simulated** | Returns a descriptive string. Real side effects need a production-access decision that has not been made |

---

## Verification Commands

```bash
# backend
cd backend && npm test && npm run typecheck

# the safety suite specifically — this is the one that matters
cd backend && npx vitest run ../testing/tests/safety/

# frontend
cd frontend && npm test && npm run typecheck && npm run lint && npm run build

# full local run
cd backend && npm run dev      # :8787
cd frontend && npm run dev     # :3000  → http://localhost:3000/app
```

---

## Handoff Log

Append newest at the bottom. One entry per task completion, block, or decision change.

### 2026-08-25 — T1 complete — impl-t1

Backend scaffold landed across three commits: `c01f75b` (scaffold), `8d6db39` (fix round 1), `41aacea` (fix round 2). Verified: `npm test` 2/2, cold `npm run typecheck` exit 0.

Two plan defects found and corrected — **read these before touching backend config**:
- `defineWorkersConfig` does not exist in `@cloudflare/vitest-pool-workers@0.22.0`. Exports are `.`, `./types`, `./codemods/vitest-v3-to-v4` only. Use the `cloudflareTest` plugin form. **`readD1Migrations` is a root export** — T7 needs this.
- Backend `compatibility_date` is **2026-08-15**, not 2026-08-24. The shipped workerd refuses to start on a later date. Do not "fix" this by raising it or by pinning miniflare through npm `overrides`.

`"pretypecheck": "wrangler types"` makes typecheck self-sufficient on a clean checkout — `worker-configuration.d.ts` is gitignored and generated. `npm test` does NOT need the same hook; vitest never reads that file.

### 2026-08-25 — orchestrator — plan written

Locked D1/D2/D6 with the project owner. Wrote the 12-task plan and this status file. No code exists yet; `backend/`, `testing/runbooks/`, `testing/fixtures/`, and `testing/tests/` are still `.gitkeep` placeholders.

Verified package versions against npm before writing them into the plan: hono 4.13.4, vitest 4.1.11, `@cloudflare/vitest-pool-workers` 0.22.0, wrangler 4.125.0, zod 4.4.3. Local Node is v25.5.0.

Next agent: start T1. It is the only wave-1 task and everything else is blocked on it.

### 2026-08-28 — D5 superseded — session auth shipped

D5 said "Auth: **None** — `by` is free text. Not production-safe." That is no
longer what the code does, so per the rule above this decision change is
recorded here rather than left to be discovered from the diff.

What replaced it, in order:
- **PR #7** added the session layer: `backend/src/auth/` (PBKDF2 password
  hashing, session issue/resolve/revoke), a `requireAuth` middleware, and an
  `HttpOnly` session cookie.
- **PR #8** made the approver derive from that session —
  `routes/approvals.ts` reads `c.var.user.email` and ignores any approver the
  client sends, which is what makes `approvedBy` non-forgeable rather than
  merely present.
- **PR #10** added the console's sign-in surface (`/login`, `/register`, and
  the `/app/*` session guard).

D5's *reasoning* still stands for what it covered — the slice was never meant
to ship a hardened identity system, and it hasn't. Still absent: rate limiting
on login, lockout, password reset, email verification, roles (every
authenticated user can approve anything), and multi-tenancy. The README's
"What is NOT built" section is the maintained list; keep it in sync rather than
duplicating it here.

One constraint worth carrying forward, because it is invisible until a deploy
fails: the session cookie is `SameSite=Lax`, so the console must be served from
the same registrable domain as the API. A cross-site split needs
`SameSite=None` plus a CSRF defence — `docs/cloudflare-deployment.md` has the
detail.

Verified on `main` at `6e724fd`: backend `npm test` 491/491, frontend
`npm test` 174/174, both typechecks clean, frontend lint clean.
