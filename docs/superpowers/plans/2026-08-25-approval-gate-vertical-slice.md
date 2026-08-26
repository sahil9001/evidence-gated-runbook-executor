# Approval Gate Vertical Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Live status lives in [`docs/IMPLEMENTATION-STATUS.md`](../../IMPLEMENTATION-STATUS.md).** Read it before starting any task and update it when you finish. It is the handoff record between agents.

**Goal:** Take one real incident from alert to approved action — real evidence collected from fixtures, a real locked approval gate, a real operator decision — surfaced through the dashboard component that already exists.

**Architecture:** A standalone Hono Worker in `backend/` exposes three endpoints over a D1-backed store. Domain logic is pure and framework-free in `backend/src/domain/`; evidence collectors sit behind one `EvidenceSource` interface in `backend/src/mcp/` and read from committed fixtures. The safety property — a state-changing action cannot execute without an approval — is enforced in the type system via a non-forgeable `ApprovalToken`, not by a runtime `if`. The frontend's existing `RunbookPreview` component is lifted to a `/app` route and fed by fetch instead of literal arrays.

**Tech Stack:** Hono 4.13, Cloudflare Workers, D1, Zod 4.4, Vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.22, Wrangler 4.125, Next.js 16 / React 19 (existing).

**Spec:** [`docs/roadmap.md`](../../roadmap.md) — Parts 1–3 for the idea and locked decisions, Part 4 Phases 0–7 for scope, Part 5 for the slice definition.

## Global Constraints

- Node 22+ (local dev is on v25.5.0). Cloudflare builds pin `NODE_VERSION=22`.
- `compatibility_flags: ["nodejs_compat"]` on every Worker. `compatibility_date` is **2026-08-15** for `backend/` (the local workerd will not start on a later date) and stays **2026-08-24** for `frontend/`.
- Runbooks and fixtures are **JSON, not YAML** — Workers have no filesystem, so both are bundled via native `import ... with { type: "json" }`. This avoids shipping a YAML parser into the Worker bundle.
- Every domain module is pure: no `fetch`, no bindings, no `Date.now()` called internally. Clocks and IO are injected. This is what makes the domain unit-testable without a Worker runtime.
- All validation is Zod at the boundary. Types are inferred from schemas via `z.infer`, never hand-declared alongside a schema.
- No mutation. Domain functions return new objects. (Repo standard, `coding-style.md`.)
- Coverage target 80% on `backend/src/domain/**`. The safety suite is exempt from being "enough" — it must be exhaustive regardless of coverage numbers.
- Commit after every task. Conventional commits (`feat:`, `test:`, `fix:`, `chore:`).
- Do **not** run `wrangler deploy` or `wrangler d1 create --remote` in any task. Local D1 only (`--local`). Deployment is a human step.

## File Structure

```text
backend/
├── package.json                       hono, zod, vitest, wrangler
├── tsconfig.json
├── vitest.config.ts                   cloudflareTest plugin
├── wrangler.jsonc                     name: runproof-api, D1 binding DB
├── migrations/
│   └── 0001_init.sql                  runs, packets, gates tables
└── src/
    ├── index.ts                       Hono app entry, route mounting
    ├── domain/
    │   ├── evidence.ts                EvidenceCard, EvidencePacket
    │   ├── action.ts                  Action, isStateChanging
    │   ├── approval.ts                ApprovalGate state machine, ApprovalToken
    │   ├── runbook.ts                 Runbook schema + loader + matcher
    │   ├── packet-builder.ts          orchestration + scope enforcement
    │   ├── executor.ts                token-gated execution
    │   └── store.ts                   D1 repository
    ├── mcp/
    │   ├── source.ts                  EvidenceSource interface
    │   ├── logs.ts
    │   ├── metrics.ts
    │   └── deploys.ts
    └── routes/
        ├── run.ts                     POST /incidents/:id/run
        ├── packet.ts                  GET  /incidents/:id/packet
        └── approvals.ts               POST /approvals/:id/approve|reject

testing/
├── runbooks/checkout-failure.json
└── fixtures/checkout-incident/{logs,metrics,deploys}.json

frontend/src/
├── lib/api.ts                         typed client
└── app/
    ├── page.tsx                       landing (unchanged)
    └── app/page.tsx                   dashboard route
```

## Task Dependency Graph

Tasks in the same wave touch disjoint files and can run in parallel.

```text
Wave 1   T1 scaffold
            │
Wave 2   ┌──┴──┐
         T2     T3            evidence types │ action+approval types
         │      │
Wave 3   ├──────┼──────┐
         T4     T5     T7     runbook │ collectors │ D1 store
         │      │      │
Wave 4   └──┬───┘      │
            T6         T8     packet builder │ executor
            └────┬─────┘
Wave 5           T9           API routes
                 │
Wave 6      ┌────┴────┐
            T10      T11      api client │ dashboard route
            └────┬────┘
Wave 7          T12           end-to-end verification
```

---

### Task 1: Backend Scaffold

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/wrangler.jsonc`, `backend/vitest.config.ts`, `backend/.gitignore`
- Create: `backend/src/index.ts`
- Test: `backend/src/index.test.ts`
- Delete: `backend/.gitkeep`, `backend/src/.gitkeep`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a Hono `app` default-exported from `src/index.ts`; `Env` type with `DB: D1Database`; `apiError(code, message, details?)` returning `{ ok: false, error: { code, message, details? } }`; working `npm test` and `npm run typecheck` in `backend/`

> **No lint in `backend/`.** The frontend has ESLint; the backend relies on strict TypeScript plus tests. Adding ESLint here would expand every later task's verification for no correctness gain in this slice. Tracked as a follow-on beside the CI gap.

- [ ] **Step 1: Create the package**

```bash
cd backend && rm -f .gitkeep src/.gitkeep
```

`backend/package.json`:
```json
{
  "name": "runproof-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "pretypecheck": "wrangler types",
    "typecheck": "tsc --noEmit",
    "cf-typegen": "wrangler types",
    "db:migrate": "wrangler d1 migrations apply runproof-db --local",
    "deploy": "wrangler deploy"
  },
  "dependencies": {
    "hono": "^4.13.4",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.22.0",
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "vitest": "^4.1.11",
    "wrangler": "^4.125.0"
  }
}
```

`backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

`backend/wrangler.jsonc`:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "runproof-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-15",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "runproof-db",
      "database_id": "local-dev-placeholder",
      "migrations_dir": "./migrations"
    }
  ]
}
```

> `database_id` is a placeholder because this plan never touches remote D1. A human runs `wrangler d1 create runproof-db` and pastes the real id before the first deploy.

`backend/vitest.config.ts`:

> **Verified against the installed package:** `@cloudflare/vitest-pool-workers@0.22.0`
> exports only `.`, `./types`, and `./codemods/vitest-v3-to-v4`. There is **no
> `./config` subpath** and no `defineWorkersConfig`. Use the `cloudflareTest`
> plugin form below.

```typescript
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { d1Databases: ["DB"] }
    })
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/domain/**"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
});
```

> `compatibility_date` is **2026-08-15**, not 2026-08-24. The workerd shipped with
> this vitest-pool-workers release refuses to start a Worker dated later, and
> lowering the date is cleaner than pinning a prerelease miniflare through
> `overrides`. The frontend Worker keeps 2026-08-24 — it has no local Workers test
> runtime, so nothing constrains it.

`backend/.gitignore`:
```text
node_modules/
.wrangler/
worker-configuration.d.ts
coverage/
```

- [ ] **Step 2: Write the failing test**

`backend/src/index.test.ts`:
```typescript
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "./index";

describe("health", () => {
  it("returns ok with a service name", async () => {
    const request = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "runproof-api" });
  });

  it("returns a structured 404 for unknown routes", async () => {
    const request = new Request("http://localhost/nope");
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd backend && npm install && npm test
```
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 4: Implement**

`backend/src/index.ts`:
```typescript
import { Hono } from "hono";

export type Env = {
  DB: D1Database;
};

export type ApiError = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export function apiError(code: string, message: string, details?: unknown): ApiError {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", service: "runproof-api" }));

app.notFound((c) => c.json(apiError("not_found", "Route not found"), 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json(apiError("internal_error", "Unexpected server error"), 500);
});

export default app;
```

- [ ] **Step 5: Verify green**

```bash
cd backend && npm test && npm run typecheck
```
Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/ && git commit -m "feat: scaffold runproof-api worker with hono and vitest"
```

---

### Task 2: Evidence Domain Types

**Files:**
- Create: `backend/src/domain/evidence.ts`
- Test: `backend/src/domain/evidence.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces:
  - `EvidenceSourceKind = "logs" | "metrics" | "deploys" | "sandbox"`
  - `evidenceCardSchema` / `type EvidenceCard = { id: string; source: EvidenceSourceKind; claim: string; raw: unknown; collectedAt: string; confidence: "high" | "medium" | "low" }`
  - `evidencePacketSchema` / `type EvidencePacket = { id: string; incidentId: string; runbookId: string; cards: EvidenceCard[]; summary: string; builtAt: string }`
  - `buildPacket(input: { id, incidentId, runbookId, cards, builtAt }): EvidencePacket` — derives `summary`
  - `packetConfidence(packet: EvidencePacket): "high" | "medium" | "low"` — lowest card confidence wins; `"low"` for an empty packet

- [ ] **Step 1: Write the failing test**

`backend/src/domain/evidence.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { evidenceCardSchema, buildPacket, packetConfidence, type EvidenceCard } from "./evidence";

const card = (over: Partial<EvidenceCard> = {}): EvidenceCard => ({
  id: "card-1",
  source: "logs",
  claim: "47 requests timed out on payment-service",
  raw: { lines: ["timeout"] },
  collectedAt: "2026-08-25T02:00:00.000Z",
  confidence: "high",
  ...over
});

describe("evidenceCardSchema", () => {
  it("accepts a well-formed card", () => {
    expect(evidenceCardSchema.parse(card())).toEqual(card());
  });

  it("rejects an unknown source", () => {
    expect(() => evidenceCardSchema.parse(card({ source: "guesswork" as never }))).toThrow();
  });

  it("rejects an empty claim, because a card with no claim proves nothing", () => {
    expect(() => evidenceCardSchema.parse(card({ claim: "" }))).toThrow();
  });
});

describe("buildPacket", () => {
  it("summarises how many cards came from how many sources", () => {
    const packet = buildPacket({
      id: "packet-1",
      incidentId: "inc-1",
      runbookId: "checkout-failure",
      cards: [card(), card({ id: "card-2", source: "deploys" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });

    expect(packet.summary).toBe("2 evidence cards from 2 sources: deploys, logs");
    expect(packet.cards).toHaveLength(2);
  });

  it("does not mutate the cards array it was given", () => {
    const cards = [card()];
    const packet = buildPacket({
      id: "packet-1", incidentId: "inc-1", runbookId: "checkout-failure",
      cards, builtAt: "2026-08-25T02:01:00.000Z"
    });
    packet.cards.push(card({ id: "card-9" }));
    expect(cards).toHaveLength(1);
  });

  it("describes an empty packet honestly", () => {
    const packet = buildPacket({
      id: "packet-1", incidentId: "inc-1", runbookId: "checkout-failure",
      cards: [], builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packet.summary).toBe("No evidence collected");
  });
});

describe("packetConfidence", () => {
  it("is only as strong as the weakest card", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r",
      cards: [card({ confidence: "high" }), card({ id: "c2", confidence: "low" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packetConfidence(packet)).toBe("low");
  });

  it("treats an empty packet as low confidence, never high", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r", cards: [],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packetConfidence(packet)).toBe("low");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd backend && npx vitest run src/domain/evidence.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`backend/src/domain/evidence.ts`:
```typescript
import { z } from "zod";

export const evidenceSourceKindSchema = z.enum(["logs", "metrics", "deploys", "sandbox"]);
export type EvidenceSourceKind = z.infer<typeof evidenceSourceKindSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const evidenceCardSchema = z.object({
  id: z.string().min(1),
  source: evidenceSourceKindSchema,
  claim: z.string().min(1),
  raw: z.unknown(),
  collectedAt: z.iso.datetime(),
  confidence: confidenceSchema
});
export type EvidenceCard = z.infer<typeof evidenceCardSchema>;

export const evidencePacketSchema = z.object({
  id: z.string().min(1),
  incidentId: z.string().min(1),
  runbookId: z.string().min(1),
  cards: z.array(evidenceCardSchema),
  summary: z.string(),
  builtAt: z.iso.datetime()
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function summarise(cards: readonly EvidenceCard[]): string {
  if (cards.length === 0) return "No evidence collected";
  const sources = [...new Set(cards.map((c) => c.source))].sort();
  const noun = cards.length === 1 ? "card" : "cards";
  const srcNoun = sources.length === 1 ? "source" : "sources";
  return `${cards.length} evidence ${noun} from ${sources.length} ${srcNoun}: ${sources.join(", ")}`;
}

export function buildPacket(input: {
  id: string;
  incidentId: string;
  runbookId: string;
  cards: readonly EvidenceCard[];
  builtAt: string;
}): EvidencePacket {
  return evidencePacketSchema.parse({
    id: input.id,
    incidentId: input.incidentId,
    runbookId: input.runbookId,
    cards: [...input.cards],
    summary: summarise(input.cards),
    builtAt: input.builtAt
  });
}

export function packetConfidence(packet: EvidencePacket): Confidence {
  if (packet.cards.length === 0) return "low";
  return packet.cards.reduce<Confidence>(
    (weakest, card) => (CONFIDENCE_RANK[card.confidence] < CONFIDENCE_RANK[weakest] ? card.confidence : weakest),
    "high"
  );
}
```

- [ ] **Step 4: Verify green**

```bash
cd backend && npx vitest run src/domain/evidence.test.ts && npm run typecheck
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/evidence.ts backend/src/domain/evidence.test.ts
git commit -m "feat: add evidence card and packet domain types"
```

---

### Task 3: Action and Approval Gate — the Safety Core

> **This is the most important task in the plan.** Everything else is plumbing around the property this task establishes: a state-changing action cannot be executed without an approval. Enforce it in the type system so that bypassing it requires an explicit `as any` — a reviewable act of sabotage rather than an accident.

**Files:**
- Create: `backend/src/domain/action.ts`, `backend/src/domain/approval.ts`
- Test: `backend/src/domain/action.test.ts`, `backend/src/domain/approval.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces:
  - `actionKindSchema`, `STATE_CHANGING_KINDS`
  - `type ReadOnlyAction = { id: string; kind: ActionKind; target: string; params: Record<string, unknown>; isStateChanging: false; reversible: boolean; description: string }`
  - `type StateChangingAction` — identical but `isStateChanging: true`
  - `type Action = ReadOnlyAction | StateChangingAction` (discriminated on `isStateChanging`)
  - `createAction(input): Action` — sets `isStateChanging` from `STATE_CHANGING_KINDS`, never from caller input
  - `isStateChanging(action): action is StateChangingAction` (type guard)
  - `type ApprovalToken` — **branded, non-constructible outside `approval.ts`**
  - `type GateState = "locked" | "approved" | "rejected"`, `type ApprovalGate`
  - `createGate({ id, actionId, createdAt, ttlMs }): ApprovalGate`
  - `approveGate(gate, { by, at, reason? }): { gate: ApprovalGate; token: ApprovalToken }`
  - `rejectGate(gate, { by, at, reason }): ApprovalGate`
  - `isExpired(gate, nowIso): boolean`
  - `tokenAuthorizes(token, action): boolean`

- [ ] **Step 1: Write the failing tests**

`backend/src/domain/action.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createAction, isStateChanging } from "./action";

describe("createAction", () => {
  it("marks a rollback as state-changing", () => {
    const action = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { commit: "8f31c2b" }, reversible: true,
      description: "Roll back payment-service to 8f31c2b"
    });
    expect(action.isStateChanging).toBe(true);
    expect(isStateChanging(action)).toBe(true);
  });

  it("marks reading logs as not state-changing", () => {
    const action = createAction({
      id: "a2", kind: "read_logs", target: "payment-service",
      params: {}, reversible: true, description: "Read logs"
    });
    expect(action.isStateChanging).toBe(false);
  });

  it("ignores a caller trying to declare a rollback harmless", () => {
    const action = createAction({
      id: "a3", kind: "rollback", target: "payment-service",
      params: {}, reversible: true, description: "Sneaky",
      isStateChanging: false
    } as never);
    expect(action.isStateChanging).toBe(true);
  });
});
```

`backend/src/domain/approval.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createAction } from "./action";
import { createGate, approveGate, rejectGate, isExpired, tokenAuthorizes } from "./approval";

const T0 = "2026-08-25T02:00:00.000Z";
const T5 = "2026-08-25T02:05:00.000Z";
const T30 = "2026-08-25T02:30:00.000Z";
const TTL = 15 * 60 * 1000;

const gate = () => createGate({ id: "g1", actionId: "a1", createdAt: T0, ttlMs: TTL });
const action = () => createAction({
  id: "a1", kind: "rollback", target: "payment-service",
  params: {}, reversible: true, description: "Roll back"
});

describe("gate lifecycle", () => {
  it("starts locked", () => {
    expect(gate().state).toBe("locked");
  });

  it("approving yields an approved gate and a token", () => {
    const { gate: g, token } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(g.state).toBe("approved");
    expect(g.decidedBy).toBe("sahil");
    expect(token.actionId).toBe("a1");
  });

  it("rejecting records the reason and produces no token", () => {
    const g = rejectGate(gate(), { by: "sahil", at: T5, reason: "Evidence too thin" });
    expect(g.state).toBe("rejected");
    expect(g.reason).toBe("Evidence too thin");
  });

  it("does not mutate the gate it was given", () => {
    const original = gate();
    approveGate(original, { by: "sahil", at: T5 });
    expect(original.state).toBe("locked");
  });
});

describe("illegal transitions", () => {
  it("cannot approve twice", () => {
    const { gate: approved } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(() => approveGate(approved, { by: "other", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot approve a rejected gate", () => {
    const rejected = rejectGate(gate(), { by: "sahil", at: T5, reason: "no" });
    expect(() => approveGate(rejected, { by: "sahil", at: T5 })).toThrow(/already decided/i);
  });

  it("cannot reject an approved gate", () => {
    const { gate: approved } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(() => rejectGate(approved, { by: "sahil", at: T5, reason: "changed mind" })).toThrow(/already decided/i);
  });

  it("requires a reason to reject", () => {
    expect(() => rejectGate(gate(), { by: "sahil", at: T5, reason: "" })).toThrow(/reason/i);
  });
});

describe("expiry", () => {
  it("is not expired inside the window", () => {
    expect(isExpired(gate(), T5)).toBe(false);
  });

  it("is expired past the window", () => {
    expect(isExpired(gate(), T30)).toBe(true);
  });

  it("refuses to approve an expired gate — stale proof is not proof", () => {
    expect(() => approveGate(gate(), { by: "sahil", at: T30 })).toThrow(/expired/i);
  });
});

describe("token scope", () => {
  it("authorizes exactly the action it was minted for", () => {
    const { token } = approveGate(gate(), { by: "sahil", at: T5 });
    expect(tokenAuthorizes(token, action())).toBe(true);
  });

  it("does not authorize a different action", () => {
    const { token } = approveGate(gate(), { by: "sahil", at: T5 });
    const other = createAction({
      id: "a2", kind: "restart", target: "payment-service",
      params: {}, reversible: true, description: "Restart"
    });
    expect(tokenAuthorizes(token, other)).toBe(false);
  });

  it("cannot be forged by hand", () => {
    // @ts-expect-error ApprovalToken is branded and only approveGate can mint one.
    const forged: ApprovalToken = { gateId: "g1", actionId: "a1", approvedBy: "attacker", approvedAt: T5 };
    expect(forged).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and watch fail**

```bash
cd backend && npx vitest run src/domain/action.test.ts src/domain/approval.test.ts
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `action.ts`**

```typescript
import { z } from "zod";

export const actionKindSchema = z.enum([
  "rollback", "restart", "scale", "read_logs", "read_metrics", "run_diagnostic"
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const STATE_CHANGING_KINDS: readonly ActionKind[] = ["rollback", "restart", "scale"];

type ActionBase = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly reversible: boolean;
  readonly description: string;
};

export type ReadOnlyAction = ActionBase & { readonly isStateChanging: false };
export type StateChangingAction = ActionBase & { readonly isStateChanging: true };
export type Action = ReadOnlyAction | StateChangingAction;

const actionInputSchema = z.object({
  id: z.string().min(1),
  kind: actionKindSchema,
  target: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  reversible: z.boolean(),
  description: z.string().min(1)
});

/**
 * The `isStateChanging` flag is derived from the action kind and can never be
 * supplied by a caller. A runbook that claims a rollback is read-only is wrong,
 * and this function overrules it.
 */
export function createAction(input: unknown): Action {
  const parsed = actionInputSchema.parse(input);
  const stateChanging = STATE_CHANGING_KINDS.includes(parsed.kind);
  return stateChanging
    ? { ...parsed, isStateChanging: true }
    : { ...parsed, isStateChanging: false };
}

export function isStateChanging(action: Action): action is StateChangingAction {
  return action.isStateChanging;
}
```

- [ ] **Step 4: Implement `approval.ts`**

```typescript
import type { Action } from "./action";

declare const tokenBrand: unique symbol;

/**
 * Proof that a human approved a specific action. The brand symbol is not
 * exported, so no module outside this file can construct one — `approveGate` is
 * the only mint. This is the load-bearing safety property of RunProof.
 */
export type ApprovalToken = {
  readonly gateId: string;
  readonly actionId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly [tokenBrand]: true;
};

export type GateState = "locked" | "approved" | "rejected";

type GateBase = {
  readonly id: string;
  readonly actionId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

export type ApprovalGate =
  | (GateBase & { readonly state: "locked" })
  | (GateBase & { readonly state: "approved"; readonly decidedBy: string; readonly decidedAt: string; readonly reason?: string })
  | (GateBase & { readonly state: "rejected"; readonly decidedBy: string; readonly decidedAt: string; readonly reason: string });

export function createGate(input: {
  id: string; actionId: string; createdAt: string; ttlMs: number;
}): ApprovalGate {
  return {
    id: input.id,
    actionId: input.actionId,
    createdAt: input.createdAt,
    expiresAt: new Date(Date.parse(input.createdAt) + input.ttlMs).toISOString(),
    state: "locked"
  };
}

export function isExpired(gate: ApprovalGate, nowIso: string): boolean {
  return Date.parse(nowIso) >= Date.parse(gate.expiresAt);
}

function assertDecidable(gate: ApprovalGate, nowIso: string): void {
  if (gate.state !== "locked") {
    throw new Error(`Gate ${gate.id} was already decided (${gate.state})`);
  }
  if (isExpired(gate, nowIso)) {
    throw new Error(`Gate ${gate.id} expired at ${gate.expiresAt}`);
  }
}

export function approveGate(
  gate: ApprovalGate,
  decision: { by: string; at: string; reason?: string }
): { gate: ApprovalGate; token: ApprovalToken } {
  assertDecidable(gate, decision.at);
  if (decision.by.trim() === "") throw new Error("Approver identity is required");

  const approved: ApprovalGate = {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "approved", decidedBy: decision.by, decidedAt: decision.at,
    ...(decision.reason === undefined ? {} : { reason: decision.reason })
  };

  const token = {
    gateId: gate.id,
    actionId: gate.actionId,
    approvedBy: decision.by,
    approvedAt: decision.at
  } as ApprovalToken;

  return { gate: approved, token };
}

export function rejectGate(
  gate: ApprovalGate,
  decision: { by: string; at: string; reason: string }
): ApprovalGate {
  assertDecidable(gate, decision.at);
  if (decision.by.trim() === "") throw new Error("Approver identity is required");
  if (decision.reason.trim() === "") throw new Error("A rejection reason is required");

  return {
    id: gate.id, actionId: gate.actionId, createdAt: gate.createdAt, expiresAt: gate.expiresAt,
    state: "rejected", decidedBy: decision.by, decidedAt: decision.at, reason: decision.reason
  };
}

export function tokenAuthorizes(token: ApprovalToken, action: Action): boolean {
  return token.actionId === action.id;
}
```

- [ ] **Step 5: Verify green**

```bash
cd backend && npx vitest run src/domain/action.test.ts src/domain/approval.test.ts && npm run typecheck
```
Expected: all PASS, typecheck clean (the `@ts-expect-error` must be *used* — if typecheck complains the directive is unnecessary, the brand is broken and the safety property is gone).

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/action.ts backend/src/domain/approval.ts backend/src/domain/action.test.ts backend/src/domain/approval.test.ts
git commit -m "feat: add action model and non-forgeable approval token"
```

---

### Task 4: Runbook Format, Schema and Loader

**Files:**
- Create: `docs/runbook-format.md`, `backend/src/domain/runbook.ts`, `testing/runbooks/checkout-failure.json`
- Test: `backend/src/domain/runbook.test.ts`

**Interfaces:**
- Consumes: `EvidenceSourceKind` from `./evidence` (Task 2)
- Produces:
  - `runbookSchema` / `type Runbook = { id: string; title: string; trigger: { service: string; signals: string[] }; allowedSources: EvidenceSourceKind[]; steps: RunbookStep[]; proposedAction: RunbookAction }`
  - `type RunbookStep = { id: string; label: string; detail: string; source?: EvidenceSourceKind }`
  - `type RunbookAction = { kind: ActionKind; target: string; params: Record<string, unknown>; reversible: boolean; description: string }`
  - `loadRunbook(raw: unknown): Runbook` — throws `RunbookValidationError` with a readable path on failure
  - `matchRunbook(runbooks: Runbook[], incident: { service: string; signals: string[] }): Runbook | null` — highest signal-overlap wins; `null` when nothing matches or on a tie

- [ ] **Step 1: Write `docs/runbook-format.md`**

Document: the JSON shape, every field with its meaning, why JSON rather than YAML (Workers bundle imports, no parser dependency), the `allowedSources` scope contract, and a complete worked example. State explicitly that `allowedSources` is a **security boundary**: a collector absent from this list is refused at runtime by Task 6.

- [ ] **Step 2: Write the failing test**

`backend/src/domain/runbook.test.ts` must cover:
- a valid runbook parses and round-trips
- an unknown `allowedSources` entry throws
- an empty `steps` array throws (a runbook with no steps is not a runbook)
- `matchRunbook` picks the runbook sharing the most signals
- `matchRunbook` returns `null` for an unrelated service
- `matchRunbook` returns `null` on an exact tie, rather than picking arbitrarily

```typescript
it("returns null on a tie rather than guessing", () => {
  const a = { ...base, id: "a", trigger: { service: "checkout", signals: ["timeout"] } };
  const b = { ...base, id: "b", trigger: { service: "checkout", signals: ["timeout"] } };
  expect(matchRunbook([a, b], { service: "checkout", signals: ["timeout"] })).toBeNull();
});
```

- [ ] **Step 3: Run and watch fail**

```bash
cd backend && npx vitest run src/domain/runbook.test.ts
```

- [ ] **Step 4: Implement `runbook.ts` and author the runbook**

`testing/runbooks/checkout-failure.json` must describe the exact incident the frontend already shows: service `payment-service`, signals including `timeout` and `error_rate`, `allowedSources: ["logs", "metrics", "deploys"]`, four steps matching the UI's timeline labels (`Alert received`, `Evidence gathered`, `Sandbox check`, `Approval required`), and a `proposedAction` of kind `rollback` targeting `payment-service`.

- [ ] **Step 5: Verify green**

```bash
cd backend && npx vitest run src/domain/runbook.test.ts && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add docs/runbook-format.md backend/src/domain/runbook.ts backend/src/domain/runbook.test.ts testing/runbooks/
git commit -m "feat: add runbook schema, loader and checkout-failure runbook"
```

---

### Task 5: Evidence Collectors and Fixtures

**Files:**
- Create: `backend/src/mcp/source.ts`, `backend/src/mcp/logs.ts`, `backend/src/mcp/metrics.ts`, `backend/src/mcp/deploys.ts`
- Create: `testing/fixtures/checkout-incident/{logs,metrics,deploys}.json`
- Test: `backend/src/mcp/collectors.test.ts`
- Delete: `testing/fixtures/.gitkeep`

**Interfaces:**
- Consumes: `EvidenceCard`, `EvidenceSourceKind` from `../domain/evidence` (Task 2)
- Produces:
  - ```typescript
    export type CollectContext = { incidentId: string; service: string; now: () => string };
    export interface EvidenceSource {
      readonly kind: EvidenceSourceKind;
      collect(ctx: CollectContext): Promise<EvidenceCard[]>;
    }
    export class CollectorError extends Error {
      constructor(kind: EvidenceSourceKind, message: string, options?: { cause?: unknown });
      readonly kind: EvidenceSourceKind;
    }
    ```
  - `createLogSource(fixtures?: LogFixture[]): EvidenceSource`
  - `createMetricSource(fixtures?: MetricFixture[]): EvidenceSource`
  - `createDeploySource(fixtures?: DeployFixture[]): EvidenceSource`
  - `ALL_SOURCES: readonly EvidenceSource[]`

> Each factory takes optional fixture data so tests inject their own without touching disk. Default argument is the imported JSON fixture. The interface is async and can throw `CollectorError` because real log APIs paginate, rate-limit, and fail — the shape must survive swapping a fixture for HTTP without a redesign.

- [ ] **Step 1: Build the fixtures**

They must reproduce the scenario the UI depicts, so the numbers on screen come from data rather than literals:
- `logs.json` — timeout entries on `payment-service` totalling **47** failed requests
- `metrics.json` — a p95 latency series crossing **3000ms**
- `deploys.json` — a commit list whose most recent risky entry is **`8f31c2b`**

- [ ] **Step 2: Write the failing test**

`backend/src/mcp/collectors.test.ts` must cover, for each collector:
- returns cards whose `source` matches the collector `kind`
- every returned card passes `evidenceCardSchema`
- `collectedAt` comes from the injected `now()`, never from a real clock
- an empty fixture yields `[]` and never throws
- a malformed fixture throws `CollectorError` naming the source

Plus the scenario assertions:
```typescript
it("finds the 47 failed requests the dashboard reports", async () => {
  const cards = await createLogSource().collect(ctx);
  expect(cards.some((c) => c.claim.includes("47"))).toBe(true);
});

it("identifies 8f31c2b as the suspect commit", async () => {
  const cards = await createDeploySource().collect(ctx);
  expect(cards.some((c) => c.claim.includes("8f31c2b"))).toBe(true);
});
```

- [ ] **Step 3: Run and watch fail**

```bash
cd backend && npx vitest run src/mcp/collectors.test.ts
```

- [ ] **Step 4: Implement the interface and three collectors**

Import fixtures with `import logFixture from "../../../testing/fixtures/checkout-incident/logs.json" with { type: "json" };`. Confirm `resolveJsonModule` is on (Task 1 set it) and that the path resolves from `backend/src/mcp/`.

- [ ] **Step 5: Verify green**

```bash
cd backend && npx vitest run src/mcp/ && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/mcp/ testing/fixtures/ && git rm -f --ignore-unmatch testing/fixtures/.gitkeep
git commit -m "feat: add fixture-backed evidence collectors"
```

---

### Task 6: Packet Builder with Scope Enforcement

**Files:**
- Create: `backend/src/domain/packet-builder.ts`
- Test: `backend/src/domain/packet-builder.test.ts`

**Interfaces:**
- Consumes: `buildPacket`, `EvidencePacket` (Task 2); `Runbook` (Task 4); `EvidenceSource`, `CollectorError` (Task 5)
- Produces:
  - `class ScopeViolationError extends Error` — carries `.attempted: EvidenceSourceKind` and `.allowed: EvidenceSourceKind[]`
  - ```typescript
    export async function collectEvidence(input: {
      runbook: Runbook;
      sources: readonly EvidenceSource[];
      incidentId: string;
      service: string;
      packetId: string;
      now: () => string;
    }): Promise<{ packet: EvidencePacket; failures: CollectorError[] }>;
    ```

> `collectEvidence` runs only the sources named in `runbook.allowedSources`, **in parallel**, and never lets one failing collector abort the packet — failures are returned alongside a partial packet so the operator sees what could not be gathered. That is an evidence system telling the truth about its own gaps.

- [ ] **Step 1: Write the failing test — scope enforcement first**

```typescript
it("refuses a source the runbook did not authorize", async () => {
  const runbook = { ...checkoutRunbook, allowedSources: ["logs"] as const };
  const rogue: EvidenceSource = {
    kind: "sandbox",
    collect: async () => { throw new Error("should never run"); }
  };
  await expect(collectEvidence({
    runbook, sources: [rogue], incidentId: "i", service: "payment-service",
    packetId: "p", now: () => T0
  })).rejects.toThrow(ScopeViolationError);
});

it("never invokes an unauthorized collector", async () => {
  const spy = vi.fn();
  const rogue: EvidenceSource = { kind: "sandbox", collect: spy };
  await collectEvidence({ /* allowedSources: ["logs"], sources: [logSource] */ }).catch(() => {});
  expect(spy).not.toHaveBeenCalled();
});
```

Also cover: authorized sources all run; a failing collector yields a partial packet plus one entry in `failures`; collectors run in parallel (assert total elapsed is well under the sum of individual delays).

- [ ] **Step 2: Run and watch fail**

```bash
cd backend && npx vitest run src/domain/packet-builder.test.ts
```

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify green**

```bash
cd backend && npx vitest run src/domain/ && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/packet-builder.ts backend/src/domain/packet-builder.test.ts
git commit -m "feat: add packet builder with runbook scope enforcement"
```

---

### Task 7: D1 Schema and Repository

**Files:**
- Create: `backend/migrations/0001_init.sql`, `backend/src/domain/store.ts`
- Test: `backend/src/domain/store.test.ts`

**Interfaces:**
- Consumes: `EvidencePacket` (Task 2); `Action`, `ApprovalGate` (Task 3)
- Produces:
  - ```typescript
    export type RunRow = {
      id: string; incidentId: string; runbookId: string; service: string;
      state: "collecting" | "awaiting_approval" | "approved" | "rejected" | "executed";
      createdAt: string; updatedAt: string;
    };
    export interface Store {
      createRun(run: RunRow): Promise<void>;
      getRun(id: string): Promise<RunRow | null>;
      updateRunState(id: string, state: RunRow["state"], at: string): Promise<void>;
      savePacket(packet: EvidencePacket, runId: string): Promise<void>;
      getPacketByIncident(incidentId: string): Promise<EvidencePacket | null>;
      saveAction(action: Action, runId: string): Promise<void>;
      getAction(id: string): Promise<Action | null>;
      saveGate(gate: ApprovalGate, runId: string): Promise<void>;
      getGate(id: string): Promise<ApprovalGate | null>;
      appendAudit(entry: AuditEntry): Promise<void>;
      listAudit(runId: string): Promise<AuditEntry[]>;
    }
    export type AuditEntry = {
      id: string; runId: string; at: string; kind: string; detail: string;
    };
    export function createD1Store(db: D1Database): Store;
    ```

> The audit table is **append-only**: no `UPDATE` or `DELETE` statement may target it anywhere in the codebase. Tests assert that `appendAudit` twice with the same id fails rather than overwriting.

- [ ] **Step 1: Write the migration**

```bash
cd backend && npx wrangler d1 migrations create runproof-db init
```
Then fill `migrations/0001_init.sql` with `runs`, `packets`, `actions`, `gates`, and `audit_log` tables. Store packets and actions as validated JSON in a `TEXT` column — they are read whole, never queried by field. Index `packets(incident_id)` and `audit_log(run_id, at)`.

- [ ] **Step 2: Write the failing test**

Use the vitest-pool-workers D1 binding with migrations applied in a `beforeAll`:
```typescript
import { env, applyD1Migrations } from "cloudflare:test";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
```
Add `TEST_MIGRATIONS` to `vitest.config.ts` via `miniflare.bindings` using `readD1Migrations`, imported from the package **root** (`@cloudflare/vitest-pool-workers`) — verified: there is no `/config` subpath in 0.22.0. Cover: round-trip each entity; `getX` returns `null` for a missing id; a packet survives round-trip through `evidencePacketSchema.parse`; duplicate audit id rejects.

- [ ] **Step 3: Run and watch fail**

```bash
cd backend && npx vitest run src/domain/store.test.ts
```

- [ ] **Step 4: Implement `store.ts`**

Use prepared statements with bound parameters throughout — never string interpolation into SQL.

- [ ] **Step 5: Verify green**

```bash
cd backend && npm run db:migrate && npx vitest run src/domain/store.test.ts && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/ backend/src/domain/store.ts backend/src/domain/store.test.ts backend/vitest.config.ts
git commit -m "feat: add d1 schema and repository layer"
```

---

### Task 8: The Executor — Nothing Runs Without a Token

**Files:**
- Create: `backend/src/domain/executor.ts`
- Test: `backend/src/domain/executor.test.ts`, `testing/tests/safety/bypass.test.ts`

**Interfaces:**
- Consumes: `Action`, `ReadOnlyAction`, `StateChangingAction`, `isStateChanging` (Task 3); `ApprovalToken`, `tokenAuthorizes` (Task 3)
- Produces:
  - ```typescript
    export type ExecutionResult = {
      actionId: string; executed: boolean; dryRun: boolean;
      output: string; at: string;
    };
    export function executeReadOnly(action: ReadOnlyAction, opts: { now: () => string }): Promise<ExecutionResult>;
    export function executeStateChanging(
      action: StateChangingAction,
      token: ApprovalToken,
      opts: { now: () => string; dryRun?: boolean }
    ): Promise<ExecutionResult>;
    ```

> There is deliberately **no** `execute(action, token?)` convenience wrapper. Two functions with different arities is what makes "call it without approval" a type error rather than a runtime check. Do not add one.

- [ ] **Step 1: Write the safety suite first**

`testing/tests/safety/bypass.test.ts` — this file is the product's central assertion. It must prove:

```typescript
it("has no exported function that executes a state-changing action without a token", () => {
  // executeStateChanging requires exactly 2 positional args before opts
  expect(executeStateChanging.length).toBeGreaterThanOrEqual(2);
});

it("rejects a token minted for a different action", async () => {
  const { token } = approveGate(createGate({ id: "g", actionId: "other", createdAt: T0, ttlMs: TTL }), { by: "s", at: T0 });
  await expect(executeStateChanging(rollback, token, { now: () => T0 }))
    .rejects.toThrow(/does not authorize/i);
});

it("cannot be called with a hand-made token without defeating the type system", async () => {
  const forged = { gateId: "g", actionId: "a1", approvedBy: "attacker", approvedAt: T0 };
  // @ts-expect-error a plain object is not an ApprovalToken
  await executeStateChanging(rollback, forged, { now: () => T0 }).catch(() => {});
});

it("routes a state-changing action away from the read-only path", () => {
  // @ts-expect-error executeReadOnly does not accept a StateChangingAction
  executeReadOnly(rollback, { now: () => T0 });
});
```

Also assert `dryRun: true` produces `executed: false` and never reports side effects.

- [ ] **Step 2: Run and watch fail**

```bash
cd backend && npx vitest run ../testing/tests/safety/bypass.test.ts
```
Add `testing/tests/**` to the vitest `include` in `backend/vitest.config.ts`.

- [ ] **Step 3: Implement `executor.ts`**

`executeStateChanging` must re-check `tokenAuthorizes(token, action)` at runtime and throw if it fails. The type system stops honest mistakes; the runtime check stops a token being reused across actions.

For this slice, execution is simulated: return a descriptive `output` string. Wire real side effects only when a decision exists about what production access this system gets.

- [ ] **Step 4: Verify green**

```bash
cd backend && npm test && npm run typecheck
```
Expected: every test passes and typecheck is clean — meaning each `@ts-expect-error` above suppressed a real error.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/executor.ts backend/src/domain/executor.test.ts testing/tests/
git commit -m "feat: add token-gated executor with safety bypass suite"
```

---

### Task 9: API Routes

**Files:**
- Create: `backend/src/routes/run.ts`, `backend/src/routes/packet.ts`, `backend/src/routes/approvals.ts`
- Modify: `backend/src/index.ts` (mount routers, add CORS)
- Test: `backend/src/routes/routes.test.ts`
- Delete: `backend/src/routes/.gitkeep`

**Interfaces:**
- Consumes: `collectEvidence` (Task 6); `createD1Store` (Task 7); `executeStateChanging` (Task 8); `createGate`/`approveGate`/`rejectGate` (Task 3); `loadRunbook`/`matchRunbook` (Task 4); `ALL_SOURCES` (Task 5)
- Produces these endpoints, all responding `{ ok: true, data: … }` or the `ApiError` shape from Task 1:

| Method | Path | Body | Success |
|---|---|---|---|
| `POST` | `/incidents/:id/run` | `{ service, signals[] }` | `{ run, packet, action, gate }` |
| `GET` | `/incidents/:id/packet` | — | `{ packet, confidence }` |
| `POST` | `/approvals/:id/approve` | `{ by, reason? }` | `{ gate, execution }` |
| `POST` | `/approvals/:id/reject` | `{ by, reason }` | `{ gate }` |

- [ ] **Step 1: Write the failing integration test**

Cover the full happy path plus the failure modes that matter:
- `POST /incidents/:id/run` returns a packet with cards and a gate in state `locked`
- a run whose incident matches no runbook returns `404` with code `no_matching_runbook`
- `POST /approvals/:id/approve` moves the gate to `approved` **and** returns an execution result
- approving twice returns `409` with code `gate_already_decided`
- approving an expired gate returns `409` with code `gate_expired`
- rejecting without a reason returns `400` with code `validation_failed`
- rejecting leaves `execution` absent and the run state `rejected`
- a malformed body returns `400`, never `500`

```typescript
it("does not execute anything on the run endpoint", async () => {
  const res = await app.fetch(new Request("http://localhost/incidents/inc-1/run", {
    method: "POST",
    body: JSON.stringify({ service: "payment-service", signals: ["timeout"] }),
    headers: { "content-type": "application/json" }
  }), env, createExecutionContext());
  const body = await res.json();
  expect(body.data.gate.state).toBe("locked");
  expect(body.data).not.toHaveProperty("execution");
});
```

- [ ] **Step 2: Run and watch fail**

```bash
cd backend && npx vitest run src/routes/routes.test.ts
```

- [ ] **Step 3: Implement the routers**

Validate every body with Zod at the top of the handler and map failures to `apiError("validation_failed", …)` with a `400`. Map `ScopeViolationError` → `403 scope_violation`, gate-state errors → `409`, missing entities → `404`. Never let a domain error reach `app.onError` as a 500.

Mount in `src/index.ts`, and enable CORS for the frontend origin using Hono's `cors` middleware — the dashboard is served from a different Worker.

- [ ] **Step 4: Verify green**

```bash
cd backend && npm test && npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/ && git rm -f --ignore-unmatch backend/src/routes/.gitkeep backend/src/mcp/.gitkeep backend/src/domain/.gitkeep
git commit -m "feat: add run, packet and approval api routes"
```

---

### Task 10: Frontend API Client

**Files:**
- Create: `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`
- Modify: `frontend/.env.example` (create), `frontend/next.config.ts` if needed
- Test: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: the endpoint table from Task 9
- Produces:
  - `type RunResponse`, `type PacketResponse`, `type ApprovalResponse` — structural mirrors of the backend domain types
  - `startRun(incidentId, body): Promise<RunResponse>`
  - `getPacket(incidentId): Promise<PacketResponse>`
  - `approve(gateId, by, reason?): Promise<ApprovalResponse>`
  - `reject(gateId, by, reason): Promise<ApprovalResponse>`
  - `class ApiClientError extends Error` with `.code: string` and `.status: number`

> Types are duplicated structurally rather than imported across package boundaries — `frontend/` and `backend/` are separate Workers with separate builds. Keep `types.ts` a thin mirror and note at the top of the file which backend module each type shadows, so drift is visible in review.

- [ ] **Step 1: Add Vitest to the frontend**

Install `vitest` and `@vitejs/plugin-react`; add `"test": "vitest run"` to `frontend/package.json`. This closes the F1 gap for the frontend half.

- [ ] **Step 2: Write the failing test**

Mock `fetch`. Cover: a successful call unwraps `data`; a non-2xx response throws `ApiClientError` carrying the backend's `error.code`; a network failure throws `ApiClientError` with code `network_error`; the base URL comes from `NEXT_PUBLIC_API_URL`.

- [ ] **Step 3: Run and watch fail**

```bash
cd frontend && npx vitest run src/lib/api.test.ts
```

- [ ] **Step 4: Implement**

Base URL from `process.env.NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8787`. Write `frontend/.env.example` documenting it.

- [ ] **Step 5: Verify green**

```bash
cd frontend && npm test && npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/ frontend/package.json frontend/.env.example
git commit -m "feat: add typed api client for runproof-api"
```

---

### Task 11: Dashboard Route

**Files:**
- Create: `frontend/src/app/app/page.tsx`, `frontend/src/app/app/DashboardClient.tsx`
- Modify: `frontend/src/app/components/RunbookPreview.tsx` (accept props; keep a demo default), `frontend/src/app/components/Navbar.tsx` (link to `/app`)
- Test: `frontend/src/app/components/RunbookPreview.test.tsx`

**Interfaces:**
- Consumes: `startRun`, `getPacket`, `approve`, `reject`, `ApiClientError` (Task 10)
- Produces: a working `/app` route

> **Do not redesign this component.** It already renders the three panels the product needs — risk score with gauge, evidence trail, approval gate. The work is replacing the module-level `timeline` array and the literal `82` with props, then feeding them from the API. The landing page at `/` keeps rendering it with the existing demo data, unchanged.

- [ ] **Step 1: Make `RunbookPreview` prop-driven**

Extract the current literals into an exported `DEMO_PREVIEW` constant and give the component a `data?: RunbookPreviewData` prop defaulting to it. The landing page keeps working untouched; `/app` passes real data.

```typescript
export type RunbookPreviewData = {
  riskScore: number;
  riskLabel: "High" | "Medium" | "Low";
  incidentTitle: string;
  runbookId: string;
  timeline: Array<{ label: string; detail: string; state: "done" | "pending" }>;
  sandboxOutput: string;
  actionDescription: string;
  gateState: "locked" | "approved" | "rejected";
  onApprove?: () => void;
  onReject?: () => void;
  isDeciding?: boolean;
};
```

- [ ] **Step 2: Write the failing test**

Cover: renders the demo data by default; renders injected data when given; Approve and Review are **disabled** when `gateState !== "locked"`; clicking Approve fires `onApprove` exactly once; a decided gate shows the decision rather than live buttons.

- [ ] **Step 3: Run and watch fail**

```bash
cd frontend && npx vitest run src/app/components/RunbookPreview.test.tsx
```

- [ ] **Step 4: Implement the route**

`/app` is a client component that starts a run on mount for a seeded incident, renders `RunbookPreview` with live data, and wires Approve/Reject to the API. Required states, all visible:
- **loading** — skeleton while the run collects evidence
- **error** — `ApiClientError.code` rendered as human text, with a retry
- **empty** — "No evidence collected" when the packet has no cards, and Approve stays disabled
- **decided** — after approval, show the execution output; after rejection, show the reason

Keep `/` as the marketing landing page. Add an "Open dashboard" link in `Navbar.tsx`.

- [ ] **Step 5: Verify green**

```bash
cd frontend && npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/
git commit -m "feat: add live dashboard route backed by runproof-api"
```

---

### Task 12: End-to-End Verification and Documentation

**Files:**
- Modify: `README.md`, `docs/roadmap.md`, `docs/IMPLEMENTATION-STATUS.md`
- Create: `docs/local-development.md`

**Interfaces:**
- Consumes: everything
- Produces: a verified, documented, reproducible local run

- [ ] **Step 1: Run the whole suite from a clean state**

```bash
cd backend && npm ci && npm run db:migrate && npm test && npm run typecheck
cd ../frontend && npm ci && npm test && npm run typecheck && npm run lint && npm run build
```
Record the actual numbers — tests passed, coverage percentage. Do not claim a result you have not seen printed.

- [ ] **Step 2: Drive the real flow by hand**

```bash
cd backend && npm run dev   # terminal 1, :8787
cd frontend && npm run dev  # terminal 2, :3000
```
Open `http://localhost:3000/app`. Confirm with your own eyes: evidence cards appear, the gate reads locked, Approve is enabled, clicking it returns an execution result, and reloading shows the decision persisted in D1.

- [ ] **Step 3: Write `docs/local-development.md`**

Both servers, the D1 migration step, the `NEXT_PUBLIC_API_URL` variable, and the one-time `wrangler d1 create runproof-db` a human must run before any deploy.

- [ ] **Step 4: Update the roadmap**

Mark Phases 0–3 and 6–7 tasks complete in `docs/roadmap.md`. Move Part 3's decisions D1, D2, D6 from "open" to "resolved" with what was chosen. Leave Phases 4, 5, 8 open — they were explicitly out of this slice.

- [ ] **Step 5: Final status update and commit**

```bash
git add docs/ README.md
git commit -m "docs: record vertical slice completion and local dev setup"
```

---

## Self-Review

**Spec coverage.** Roadmap Phase 0 → T1, T10 (F1/F2; F3 CI is *not* covered — see gap below). Phase 1 → T2, T3 (D1.1 `Incident` and D1.7 `RunRecord` deliberately reduced to `RunRow` in T7 for this slice). Phase 2 → T4. Phase 3 → T5, T6. Phase 6 → T3, T8. Phase 7 → T9. Phase 9 → T10, T11. Phase 10 → T8 (safety suite), T12.

**Known gaps, accepted for this slice:**
- **Backend ESLint has no task.** `backend/` verifies with strict TypeScript and tests only. Add it with the CI workflow below, not inside this slice.
- **F3 (CI workflow) has no task.** It needs a repository decision about GitHub Actions vs Cloudflare build hooks, and there is nothing to gate until the suite exists. Add it immediately after T12.
- **T4's runbook matcher returns `null` on ties.** Correct and safe, but it means two overlapping runbooks silently produce a 404. Acceptable while three runbooks exist; revisit before there are thirty.
- **Execution in T8 is simulated.** No real rollback happens. This is intentional — wiring production credentials is a separate decision (roadmap D6) and out of scope.
- **No auth (roadmap D5).** `by` is a free-text field. This slice must not be pointed at a real production environment.

**Type consistency check.** `EvidenceCard`/`EvidencePacket` (T2) flow unchanged into T5, T6, T7. `Action` (T3) is consumed by T7, T8, T9 under the same name. `ApprovalToken` is minted only in T3 and consumed only in T8. `EvidenceSource` (T5) is consumed by T6 with the same `collect(ctx)` signature. `RunbookPreviewData` (T11) is produced only there. No signature drift found.
