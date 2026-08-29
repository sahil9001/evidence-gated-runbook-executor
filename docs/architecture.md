# RunProof Architecture

How the pieces fit, and where each safety property is actually enforced.

This document describes what is in the repository today. Where a diagram shows
something that is deliberately *not* wired up, it says so — see
[Architectural limits](#architectural-limits) and the "What is NOT built"
section of the [README](../README.md).

**Reading order:** [system context](#system-context) → [request pipeline](#request-pipeline)
→ [backend layers](#backend-layers) → the two flows
([operator](#the-operator-flow-http), [agent](#the-agent-flow-mcp)) →
[state machines](#state-machines) → [data model](#data-model).

---

## System context

Two independent clients drive RunProof, and they enter through two different
doors. Nothing in the middle box executes anything.

```mermaid
flowchart LR
    subgraph clients["Clients"]
        operator["Operator<br/>browser"]
        harness["TrueForge harness<br/>runs the agent turn"]
    end

    subgraph frontend["frontend/ — Next.js"]
        landing["Landing page<br/>/ (public)"]
        console["Operator console<br/>/app/* (session-guarded)"]
    end

    subgraph worker["backend/ — Cloudflare Worker (Hono)"]
        consoleapi["Console API<br/>/auth /incidents /runs<br/>/approvals /audit /runbooks /overview"]
        mcp["MCP endpoint<br/>/mcp"]
        domain["Domain layer<br/>runbook · evidence · action · gate · executor"]
    end

    subgraph data["State and inputs"]
        d1[("D1<br/>runs · packets · actions<br/>gates · audit_log<br/>users · sessions · incidents")]
        runbooks["testing/runbooks/*.json<br/>compiled in at build time"]
        fixtures["testing/fixtures/*.json<br/>logs · metrics · deploys"]
    end

    sandbox["TrueForge sandbox<br/>local fallback or Daytona"]

    operator --> landing
    operator --> console
    console -->|"fetch, cookie session"| consoleapi
    harness -->|"MCP over Streamable HTTP"| mcp
    consoleapi --> domain
    mcp --> domain
    domain --> runbooks
    domain --> fixtures
    consoleapi --> d1
    harness -->|"runs the diagnostic script<br/>RunProof only hands back text"| sandbox

    classDef danger stroke-dasharray: 5 5
    class sandbox danger
```

Three things this diagram is meant to make obvious:

- **RunProof has no execution surface.** It is a Worker: no shell, no
  filesystem, no subprocess. `get_diagnostic_script` returns script *text*;
  the sandbox that runs it belongs to TrueForge.
- **The MCP door and the console door are separate.** They share the domain
  layer, not the request pipeline — different auth, different CORS treatment,
  different threat model.
- **Only the console API touches D1.** The MCP tool handlers are stateless and
  fixture-backed; nothing an agent calls today persists anything.

---

## Request pipeline

`backend/src/index.ts` mounts middleware by path prefix rather than per route,
so a new route under an existing prefix inherits every guard automatically.

```mermaid
flowchart TD
    req["Incoming request"] --> route{"Path"}

    route -->|"/health"| health["200 · no CORS, no auth"]

    route -->|"/mcp"| origin{"Origin header<br/>allowed?"}
    origin -->|"no"| deny403["403"]
    origin -->|"yes, or absent<br/>(server-side fetch)"| session["MCP session lookup<br/>idle TTL + capacity cap"]
    session --> mcpserver["Fresh McpServer per request<br/>src/mcp/server.ts"]

    route -->|"console API prefixes"| cors{"consoleCors<br/>origin allow-list<br/>credentials: true"}
    cors -->|"rejected"| denycors["No CORS headers<br/>browser blocks"]
    cors -->|"allowed"| ct{"State-changing method?"}
    ct -->|"GET / HEAD"| authcheck
    ct -->|"POST/PUT/PATCH/DELETE"| ctype{"Content-Type<br/>application/json?"}
    ctype -->|"no"| deny415["415 unsupported_media_type"]
    ctype -->|"yes"| authcheck{"Prefix requires<br/>a session?"}
    authcheck -->|"/auth/* — public"| authroutes["register · login · logout"]
    authcheck -->|"everything else"| requireauth{"requireAuth<br/>resolve rp_session cookie"}
    requireauth -->|"missing / expired"| deny401["401 unauthenticated"]
    requireauth -->|"resolved"| handler["Route handler<br/>c.var.user is the caller"]
```

Notes that are easy to get wrong when reading the code:

- **The `Content-Type` guard is the CSRF barrier**, not body parsing.
  `c.req.json()` ignores the header entirely, and `POST /auth/logout` reads no
  body at all — both were reachable cross-site before the guard was mounted.
  `SameSite=Lax` on the session cookie is the other, independent barrier.
- **`consoleCors` is never mounted on `/mcp` or `/health`.** `/mcp`'s only
  caller is a server-side fetch that sends no `Origin`; it validates `Origin`
  itself against a separate, wider allow-list (any localhost port).
- **`requireAuth` is a prefix middleware, not a per-route check**, so
  `/incidents/*`, `/runs/*`, `/approvals/*`, `/audit/*`, `/runbooks/*` and
  `/overview/*` cannot grow a route that forgets it.

---

## Backend layers

Routes own I/O and the clock. The domain layer is pure. The store is an
interface with two implementations, so every persistence rule is testable
without D1.

```mermaid
flowchart TB
    subgraph transport["Transport — src/routes, src/mcp"]
        r_auth["auth.ts"]
        r_inc["incidents.ts"]
        r_run["run.ts"]
        r_app["approvals.ts"]
        r_read["runs · packet · audit<br/>runbooks · overview"]
        r_mcp["mcp.ts<br/>Origin + session + transport"]
        m_srv["mcp/server.ts<br/>6 tool registrations"]
        m_tool["mcp/toolHandlers.ts<br/>scope enforcement"]
    end

    subgraph domainlayer["Domain — src/domain (pure, no I/O, injected clock)"]
        d_rb["runbook.ts<br/>loadRunbook · matchRunbook"]
        d_pb["packet-builder.ts<br/>collectEvidence + ScopeViolationError"]
        d_ev["evidence.ts<br/>buildPacket · packetConfidence"]
        d_ac["action.ts<br/>createAction · isStateChanging"]
        d_ap["approval.ts<br/>createGate · approveGate · ApprovalToken"]
        d_ex["executor.ts<br/>executeReadOnly · executeStateChanging"]
    end

    subgraph collectors["Collectors — src/mcp/*.ts"]
        c_log["logs"]
        c_met["metrics"]
        c_dep["deploys"]
    end

    subgraph storage["Persistence — src/domain/store.ts (interface)"]
        s_d1["store/d1.ts<br/>D1 + db.batch()"]
        s_mem["store/memory.ts<br/>tests"]
        s_conf["store/conformance.ts<br/>one suite, both adapters"]
    end

    subgraph authlayer["Auth — src/auth"]
        a_pw["password.ts<br/>PBKDF2-SHA256"]
        a_se["session.ts<br/>opaque id, 30d TTL"]
        a_mw["middleware.ts<br/>requireAuth"]
    end

    r_run --> d_rb
    r_run --> d_pb
    r_run --> d_ac
    r_run --> d_ap
    r_app --> d_ap
    r_app --> d_ex
    d_pb --> d_ev
    d_pb --> collectors
    d_ex --> d_ap
    m_srv --> m_tool
    m_tool --> d_rb
    m_tool --> collectors
    m_tool --> d_ac
    m_tool --> d_ap
    r_mcp --> m_srv
    r_auth --> authlayer
    a_mw --> storage
    r_run --> storage
    r_app --> storage
    r_inc --> storage
    r_read --> storage
    s_conf -.-> s_d1
    s_conf -.-> s_mem
```

The dependency rule worth preserving: **arrows point inward, and the domain
layer has none pointing out.** `approval.ts` and `executor.ts` never touch a
store, a request, or the wall clock — every timestamp is stamped at the route
boundary and passed in. That is what makes the safety tests deterministic.

---

## The operator flow (HTTP)

The console's path from an incident to an executed action. The important line
is the one that *doesn't* happen: `POST /incidents/:id/run` collects evidence
and locks a gate, and its response has no `execution` field at all.

```mermaid
sequenceDiagram
    autonumber
    participant O as Operator
    participant C as Console (/app)
    participant A as Worker API
    participant D as Domain
    participant S as D1

    O->>C: file incident (title, service, signals)
    C->>A: POST /incidents
    A->>S: createIncident
    A-->>C: incident row

    O->>C: start run
    C->>A: POST /incidents/:id/run
    A->>S: getIncident
    Note over A: the incident row is the only authority<br/>for service + signals — never the body
    A->>D: matchRunbook(RUNBOOKS, incident)
    alt no runbook matches
        D-->>A: null
        A-->>C: 404 no_matching_runbook
    else matched
        A->>D: collectEvidence(runbook, sources)
        Note over D: assertInScope runs BEFORE any collector —<br/>a source outside allowedSources aborts the call
        D->>D: collectors run concurrently<br/>one failure degrades, never aborts
        D-->>A: packet + failures[]
        A->>D: createAction + createGate (locked)
        A->>S: createRunWithArtifacts (one atomic batch)
        Note over S: run + packet + action + gate + audit<br/>all land, or none do
        A-->>C: run, packet, action, LOCKED gate, failures
    end

    O->>C: review evidence, then approve
    C->>A: POST /approvals/:id/approve
    A->>S: getGate, getRun, getAction, getPacketByRun
    alt packet has zero cards
        A-->>C: 409 insufficient_evidence
    else gate already decided or expired
        A-->>C: 409
    else
        A->>D: approveGate(gate, action, {by, at})
        D-->>A: ApprovedGate + ApprovalToken
        A->>S: decideGate (atomic claim — only one racer wins)
        A->>D: executeStateChanging(action, token)
        Note over D: token re-verified at execution:<br/>WeakSet identity + action fingerprint
        D-->>A: ExecutionResult (simulated)
        A->>S: updateRunState "executed" + audit entries
        A-->>C: gate, execution, runState
    end
```

Four enforcement points on that path, each in exactly one place:

| Property | Enforced by | Failure mode |
|---|---|---|
| Evidence stays inside the runbook's scope | `assertInScope` in `packet-builder.ts` | `403 scope_violation` |
| A run is born whole, or not at all | `Store#createRunWithArtifacts` (`db.batch()`) | nothing written |
| No approval without evidence | `getPacketByRun` check in `approvals.ts` | `409 insufficient_evidence` |
| One decision per gate, ever | `Store#decideGate` conditional write | `409 gate_already_decided` |

### Why the approval token cannot be forged

`approveGate` is the only mint, and the check at execution time is identity-
based, not shape-based.

```mermaid
flowchart LR
    mint["approveGate()<br/>the only mint"] -->|"issuedTokens.add(token)"| ws[("module-private<br/>WeakSet")]
    mint --> tok["ApprovalToken<br/>+ actionFingerprint"]
    forged["Hand-built object<br/>cast as ApprovalToken"] --> check
    tok --> check{"tokenAuthorizes()"}
    ws -.->|"identity lookup"| check
    check -->|"not in WeakSet"| reject1["rejected"]
    check -->|"actionId mismatch"| reject2["rejected"]
    check -->|"fingerprint mismatch<br/>same id, different params"| reject3["rejected"]
    check -->|"all three pass"| exec["executeStateChanging<br/>proceeds"]
```

The TypeScript `unique symbol` brand on `ApprovalToken` is erased at runtime
and stops nothing on its own — the `WeakSet` is the real mechanism. The direct
consequence: **tokens are in-process only and must never be serialized.** A
token that round-trips through JSON legitimately loses its identity and is
rejected. Persist the *gate* (plain data); never the token.

---

## The agent flow (MCP)

What TrueForge drives. The tool annotations are what make the human checkpoint
fire — RunProof declares intent, TrueForge enforces the pause.

```mermaid
sequenceDiagram
    autonumber
    participant H as TrueForge
    participant M as /mcp
    participant T as toolHandlers
    participant X as Sandbox
    participant P as Human

    H->>M: initialize + tools/list
    M-->>H: 6 tools with annotations
    Note over H: readOnlyHint: true → never gated<br/>destructiveHint: true → matches @destructive

    H->>M: get_runbook(service, signals)
    M->>T: matchRunbook
    T-->>H: runbook incl. allowedSources

    H->>M: collect_logs / collect_metrics / collect_deploys
    T->>T: authorizeSource — refuses if the matched<br/>runbook does not list that source
    T-->>H: evidence cards

    H->>M: get_diagnostic_script
    T-->>H: script TEXT only
    H->>X: run the script
    X-->>H: stdout compared to expectedOutput

    H->>M: propose_rollback  (destructiveHint: true)
    Note over H,P: TrueForge pauses the turn here —<br/>ToolApprovalRequiredEvent
    P-->>H: allow / deny
    alt allowed
        H->>M: the call proceeds
        T->>T: requireMatchedRunbook +<br/>assertRunbookAuthorizesParams
        T-->>H: a LOCKED gate, in memory
        Note over T: executes nothing, and does not<br/>persist the gate — see limits below
    end
```

`assertRunbookAuthorizesParams` is worth calling out: matching a runbook is not
enough, because a caller could keep the match and swap the params. Every key
the runbook prescribes must compare equal under `stableStringify` — the same
serializer the token fingerprint uses, so the two checks cannot drift on what
"the same value" means. Keys the runbook does not prescribe (`reason`, free-form
operator context) stay unconstrained.

---

## State machines

A run and its gate move together, but they are separate rows with separate
invariants.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> awaiting_approval: POST /incidents/:id/run<br/>evidence collected, gate locked
    awaiting_approval --> approved: decideGate (atomic)
    awaiting_approval --> rejected: decideGate (atomic)
    approved --> executed: executeStateChanging + updateRunState
    executed --> [*]
    rejected --> [*]
    note right of awaiting_approval
        "collecting" exists in the type
        but no route assigns it today:
        a run is created already
        awaiting approval.
    end note
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> locked: createGate(ttl 15 min)
    locked --> approved: approveGate + decideGate
    locked --> rejected: rejectGate + decideGate
    locked --> expired: now > expiresAt
    expired --> [*]: 409 gate_expired
    approved --> [*]
    rejected --> [*]
    note right of locked
        Decided exactly once.
        decideGate is a conditional write:
        two racers, one winner, and the
        loser mutates nothing.
    end note
```

---

## Data model

Bodies that are always read whole (`packets`, `actions`, `gates`, incident
`signals`) are stored as opaque JSON and re-validated with their Zod schema on
the way out, rather than decomposed into columns.

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ incidents : "created_by"
    incidents ||--o{ runs : "incident_id"
    runs ||--o{ packets : "run_id"
    runs ||--|| actions : "run_id"
    runs ||--|| gates : "run_id (same id as run)"
    runs ||--o{ audit_log : "run_id"

    users {
        TEXT id PK
        TEXT email UK
        TEXT password_hash "PBKDF2-SHA256"
        TEXT salt
    }
    sessions {
        TEXT id PK "opaque, HttpOnly cookie"
        TEXT user_id FK
        TEXT expires_at
    }
    incidents {
        TEXT id PK
        TEXT service
        TEXT signals "JSON array"
        TEXT status
        TEXT created_by
    }
    runs {
        TEXT id PK
        TEXT incident_id
        TEXT runbook_id
        TEXT state "collecting|awaiting_approval|approved|rejected|executed"
        TEXT created_by "from the session, never the body"
    }
    packets {
        TEXT id PK
        TEXT run_id
        TEXT data "JSON EvidencePacket"
        TEXT built_at
    }
    actions {
        TEXT id PK
        TEXT run_id
        TEXT data "JSON Action"
    }
    gates {
        TEXT id PK
        TEXT run_id
        TEXT data "JSON discriminated union"
    }
    audit_log {
        TEXT id PK "append-only; PK blocks overwrite"
        TEXT run_id
        TEXT at
        TEXT kind
        TEXT detail
    }
```

The action and gate deliberately **share the run's id**. Separate tables mean no
key collision, and it lets `/approvals/:id` find the run — and therefore the
mutable state it must claim — from the gate id alone.

`audit_log` is append-only, and the `PRIMARY KEY` on `id` is the enforcement:
a second insert with the same id fails rather than silently overwriting. No
`UPDATE` or `DELETE` may ever target that table.

---

## Frontend

```mermaid
flowchart TD
    visitor["Request"] --> mw{"middleware.ts<br/>matcher: /app/*"}
    mw -->|"path not matched"| public["/ landing<br/>(auth)/login · /register"]
    mw -->|"no rp_session cookie"| login["redirect /login?next=..."]
    mw -->|"cookie present"| app["/app/* renders"]

    app --> overview["/app — overview tiles<br/>+ recent activity"]
    app --> incidents["/app/incidents · /new · /:id"]
    app --> runs["/app/runs/:id"]
    app --> books["/app/runbooks"]
    app --> history["/app/history"]
    app --> audit["/app/audit"]

    runs --> tabs["Evidence · Diagnostics<br/>Approval · Audit"]
    tabs --> decide["approve / reject<br/>POST /approvals/:id/*"]

    subgraph client["src/lib"]
        api["api.ts — request()<br/>credentials: include"]
        auth["auth.ts — login/register/me"]
    end

    overview & incidents & runs & books & history & audit --> api
    api -->|"401 unauthenticated"| login
    api -->|"401 invalid_credentials"| form["stays on the form"]
```

The middleware checks only that the cookie is **present** — deliberately. It
exists to stop a flash of protected UI, not to authorize. A present-but-invalid
cookie sails through it and is caught one layer down by `requireAuth`, whose
`401 unauthenticated` the API client turns into a redirect. Keying that redirect
on `error.code` rather than the bare status matters: a failed login is also a
401, and must not bounce the user out of the form they are typing in.

---

## Architectural limits

Known and deliberate, listed here so a diagram above is not read as a promise:

- **The two approval gates are not one pipeline.** `propose_rollback` mints a
  locked gate in memory and returns it in the tool result; it is never written
  to the store, so it cannot be resolved through `/approvals/:id`. An
  agent-proposed rollback and an operator-run one are two flows over the same
  domain machinery today.
- **Execution is simulated.** `executeStateChanging` returns a descriptive
  string. No infrastructure API is called, before or after approval.
- **The MCP session map is process-local** (`src/routes/mcp.ts`). `wrangler dev`
  runs a single isolate, so this is latent locally; a horizontally scaled
  deployment needs a Durable Object per session.
- **Runbooks and evidence are compiled-in fixtures.** `RUNBOOKS` /
  `ALL_RUNBOOKS` are a static import of one JSON file, and the collectors read
  fixture snapshots. The `Runbook`, `EvidenceSource` and `Store` contracts are
  what a real deployment would swap implementations behind.
- **The HTTP run path collects `logs`, `metrics` and `deploys` only.** The
  shipped runbook also authorizes `sandbox`, but sandbox evidence enters only
  through the agent flow, where TrueForge runs the script.
- **No roles.** Every authenticated user can approve anything.

---

## Where to look next

| Question | File |
|---|---|
| What a runbook may authorize | [`docs/runbook-format.md`](runbook-format.md) |
| The full safety argument | [`docs/writeup.md`](writeup.md) |
| Driving it from TrueForge | [`docs/trueforge-setup.md`](trueforge-setup.md) |
| Deploying it | [`docs/cloudflare-deployment.md`](cloudflare-deployment.md) |
| What is left to build | [`docs/roadmap.md`](roadmap.md) |
