import { describe, it, expect, beforeAll } from "vitest";
import type { Store, RunRow, AuditEntry, IncidentRow, UserRow, SessionRow } from "../domain/store";
import { evidencePacketSchema, type EvidencePacket } from "../domain/evidence";
import { createAction, type Action } from "../domain/action";
import { createGate, approveGate, rejectGate } from "../domain/approval";

const T0 = "2026-08-25T02:00:00.000Z";
const T5 = "2026-08-25T02:05:00.000Z";

const makeRun = (id: string, overrides: Partial<RunRow> = {}): RunRow => ({
  id,
  incidentId: "inc-1",
  runbookId: "checkout-failure",
  service: "payment-service",
  state: "collecting",
  createdAt: T0,
  updatedAt: T0,
  createdBy: "sahil@example.com",
  ...overrides
});

const makePacket = (id: string, incidentId: string, builtAt: string = T0): EvidencePacket =>
  evidencePacketSchema.parse({
    id,
    incidentId,
    runbookId: "checkout-failure",
    cards: [
      {
        id: "card-1",
        source: "logs",
        claim: "5xx spike observed",
        raw: { count: 42, nested: { ok: true } },
        collectedAt: T0,
        confidence: "high"
      }
    ],
    summary: "1 evidence card from 1 source: logs",
    builtAt
  });

const makeAction = (id: string): Action =>
  createAction({
    id,
    kind: "rollback",
    target: "payment-service",
    params: { commit: "8f31c2b" },
    reversible: true,
    description: "Roll back payment-service to 8f31c2b"
  });

/**
 * The full behavioural contract of `Store`, run identically against every
 * adapter. Both `store/d1.test.ts` and `store/memory.test.ts` invoke this
 * with their own `makeStore` — a test failing for one adapter but not the
 * other means the seam leaks, and the fix belongs in the adapter, not here.
 *
 * NOT included here: tests that bypass the `Store` API to write a corrupted
 * or malformed on-disk row directly (the defence-in-depth tests in
 * `store/d1.test.ts`). Those exercise a D1-specific vulnerability — a raw
 * TEXT/JSON blob that can be edited independently of the domain's type
 * guarantees — that the memory adapter cannot exhibit, because it never
 * serializes to an untyped blob in the first place. Ordinary round-tripping
 * behaviour (including the re-derive/re-validate-on-read defence itself)
 * is still required of both adapters and is covered below.
 */
export function runStoreConformance(name: string, makeStore: () => Promise<Store> | Store): void {
  describe(`${name} store conformance`, () => {
    let store: Store;

    beforeAll(async () => {
      store = await makeStore();
    });

    describe("runs", () => {
      it("round-trips a run", async () => {
        const run = makeRun("run-1");
        await store.createRun(run);
        expect(await store.getRun("run-1")).toEqual(run);
      });

      it("returns null for a missing run", async () => {
        expect(await store.getRun("does-not-exist")).toBeNull();
      });

      it("updates run state and leaves other fields untouched", async () => {
        const run = makeRun("run-2");
        await store.createRun(run);

        await store.updateRunState("run-2", "awaiting_approval", T5);
        const loaded = await store.getRun("run-2");

        expect(loaded).toEqual({ ...run, state: "awaiting_approval", updatedAt: T5 });
      });

      it("mutating a returned run does not affect the stored value", async () => {
        const run = makeRun("run-mutate-guard");
        await store.createRun(run);

        const loaded = await store.getRun("run-mutate-guard");
        expect(loaded).not.toBeNull();
        if (loaded !== null) loaded.service = "tampered";

        expect((await store.getRun("run-mutate-guard"))?.service).toBe("payment-service");
      });

      it("conditional updateRunState wins exactly once for a matching expectedState", async () => {
        const run = makeRun("run-claim");
        await store.createRun(run);
        await store.updateRunState("run-claim", "awaiting_approval", T0);

        const won = await store.updateRunState("run-claim", "approved", T5, "awaiting_approval");
        expect(won).toBe(true);
        expect((await store.getRun("run-claim"))?.state).toBe("approved");
      });

      it("conditional updateRunState loses when the current state no longer matches expectedState", async () => {
        const run = makeRun("run-claim-2");
        await store.createRun(run);
        await store.updateRunState("run-claim-2", "awaiting_approval", T0);
        await store.updateRunState("run-claim-2", "approved", T5, "awaiting_approval");

        // Same expected state, second call: the run has already moved on.
        const lost = await store.updateRunState("run-claim-2", "approved", "2026-08-25T02:10:00.000Z", "awaiting_approval");
        expect(lost).toBe(false);
        expect((await store.getRun("run-claim-2"))?.updatedAt).toBe(T5);
      });

      it("conditional updateRunState loses against a nonexistent run", async () => {
        const lost = await store.updateRunState("run-does-not-exist", "approved", T5, "awaiting_approval");
        expect(lost).toBe(false);
      });

      it("supports a null createdBy for an unattributed run", async () => {
        const run = makeRun("run-created-by-null", { createdBy: null });
        await store.createRun(run);
        expect((await store.getRun("run-created-by-null"))?.createdBy).toBeNull();
      });

      // `runs.id` is a PRIMARY KEY (migrations/0001_init.sql): D1 rejects a
      // second INSERT with the same id via the schema constraint. The
      // memory adapter must reject it too instead of `Map.set` silently
      // overwriting the first run. Exact error type/message is adapter
      // specific (D1's native SQLite error vs. `StoreConflictError`), so
      // this — and every other duplicate-write test below — asserts only
      // the shared shape: the write rejects.
      it("rejects creating a run with a duplicate id instead of overwriting it", async () => {
        const run = makeRun("run-dup-1");
        await store.createRun(run);
        await expect(store.createRun(makeRun("run-dup-1", { service: "other-service" }))).rejects.toThrow();
        expect((await store.getRun("run-dup-1"))?.service).toBe("payment-service");
      });
    });

    describe("listRuns / listRunsByIncident", () => {
      it("lists runs newest-first and filters by state and limit", async () => {
        await store.createRun(makeRun("run-list-a", { incidentId: "inc-list", createdAt: "2026-08-25T03:00:00.000Z", updatedAt: "2026-08-25T03:00:00.000Z", state: "collecting" }));
        await store.createRun(makeRun("run-list-b", { incidentId: "inc-list", createdAt: "2026-08-25T03:05:00.000Z", updatedAt: "2026-08-25T03:05:00.000Z", state: "executed" }));
        await store.createRun(makeRun("run-list-c", { incidentId: "inc-list-other", createdAt: "2026-08-25T03:10:00.000Z", updatedAt: "2026-08-25T03:10:00.000Z", state: "executed" }));

        const executedOnly = await store.listRuns({ state: "executed" });
        const executedIds = executedOnly.map((r) => r.id);
        expect(executedIds.indexOf("run-list-c")).toBeLessThan(executedIds.indexOf("run-list-b"));
        expect(executedIds).toContain("run-list-b");
        expect(executedIds).toContain("run-list-c");
        expect(executedIds).not.toContain("run-list-a");

        const limited = await store.listRuns({ limit: 1 });
        expect(limited).toHaveLength(1);
      });

      it("lists only runs for the given incident, newest-first", async () => {
        await store.createRun(makeRun("run-inc-a", { incidentId: "inc-runs-by-incident", createdAt: "2026-08-25T04:00:00.000Z", updatedAt: "2026-08-25T04:00:00.000Z" }));
        await store.createRun(makeRun("run-inc-b", { incidentId: "inc-runs-by-incident", createdAt: "2026-08-25T04:05:00.000Z", updatedAt: "2026-08-25T04:05:00.000Z" }));
        await store.createRun(makeRun("run-inc-other", { incidentId: "inc-runs-by-incident-2", createdAt: "2026-08-25T04:10:00.000Z", updatedAt: "2026-08-25T04:10:00.000Z" }));

        const loaded = await store.listRunsByIncident("inc-runs-by-incident");
        expect(loaded.map((r) => r.id)).toEqual(["run-inc-b", "run-inc-a"]);
      });
    });

    describe("packets", () => {
      it("round-trips a packet, surviving evidencePacketSchema.parse", async () => {
        const run = makeRun("run-3");
        await store.createRun(run);
        const packet = makePacket("packet-1", run.incidentId);

        await store.savePacket(packet, run.id);
        const loaded = await store.getPacketByIncident(run.incidentId);

        expect(loaded).not.toBeNull();
        expect(evidencePacketSchema.parse(loaded)).toEqual(packet);
      });

      it("returns null for a packet with no matching incident", async () => {
        expect(await store.getPacketByIncident("no-such-incident")).toBeNull();
      });

      it("returns the packet with the latest builtAt, not the first one saved", async () => {
        const run = makeRun("run-m1", { incidentId: "inc-m1" });
        await store.createRun(run);

        // Saved out of chronological order, and with ids that would sort
        // the wrong way — ordering by id would return whichever packet had
        // the lexicographically-first UUID, not the newest one.
        const older = makePacket("zzz-older-by-id", "inc-m1", "2026-08-25T05:00:00.000Z");
        const newer = makePacket("aaa-newer-by-id", "inc-m1", "2026-08-25T06:00:00.000Z");
        await store.savePacket(older, run.id);
        await store.savePacket(newer, run.id);

        const loaded = await store.getPacketByIncident("inc-m1");
        expect(loaded?.id).toBe("aaa-newer-by-id");
      });

      // `packets.id` is a PRIMARY KEY; `savePacket` is a plain INSERT in
      // the D1 adapter (no upsert), so a duplicate id fails there too.
      it("rejects saving a packet with a duplicate id", async () => {
        const run = makeRun("run-packet-dup", { incidentId: "inc-packet-dup" });
        await store.createRun(run);
        await store.savePacket(makePacket("packet-dup-1", run.incidentId), run.id);

        await expect(store.savePacket(makePacket("packet-dup-1", run.incidentId), run.id)).rejects.toThrow();
      });
    });

    describe("actions", () => {
      it("round-trips an action", async () => {
        const run = makeRun("run-4");
        await store.createRun(run);
        const action = makeAction("action-1");

        await store.saveAction(action, run.id);
        expect(await store.getAction("action-1")).toEqual(action);
      });

      it("returns null for a missing action", async () => {
        expect(await store.getAction("no-such-action")).toBeNull();
      });

      // `actions.id` is a PRIMARY KEY; `saveAction` is a plain INSERT in
      // the D1 adapter (no upsert), so a duplicate id fails there too.
      it("rejects saving an action with a duplicate id", async () => {
        const run = makeRun("run-action-dup");
        await store.createRun(run);
        await store.saveAction(makeAction("action-dup-1"), run.id);

        await expect(store.saveAction(makeAction("action-dup-1"), run.id)).rejects.toThrow();
      });
    });

    describe("gates", () => {
      it("round-trips a locked gate", async () => {
        const run = makeRun("run-5");
        await store.createRun(run);
        const gate = createGate({ id: "gate-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });

        await store.saveGate(gate, run.id);
        const loaded = await store.getGate("gate-1");

        expect(loaded).toEqual(gate);
        expect(loaded?.state).toBe("locked");
      });

      it("round-trips an approved gate with decidedBy/decidedAt intact", async () => {
        const run = makeRun("run-6");
        await store.createRun(run);
        const locked = createGate({ id: "gate-2", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5, reason: "looks good" });

        await store.saveGate(approved, run.id);
        const loaded = await store.getGate("gate-2");

        expect(loaded).toEqual(approved);
        expect(loaded?.state).toBe("approved");
        if (loaded?.state !== "approved") throw new Error("expected approved gate");
        expect(loaded.decidedBy).toBe("sahil");
        expect(loaded.decidedAt).toBe(T5);
      });

      it("upserts a gate: approving after the locked row was saved replaces it in place", async () => {
        const run = makeRun("run-10");
        await store.createRun(run);
        const locked = createGate({ id: "gate-3", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });

        const wonLock = await store.saveGate(locked, run.id);
        expect(wonLock).toBe(true);
        expect((await store.getGate("gate-3"))?.state).toBe("locked");

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const wonApprove = await store.saveGate(approved, run.id);
        expect(wonApprove).toBe(true);

        const loaded = await store.getGate("gate-3");
        expect(loaded).toEqual(approved);
        if (loaded?.state !== "approved") throw new Error("expected approved gate");
        expect(loaded.decidedBy).toBe("sahil");
      });

      it("returns null for a missing gate", async () => {
        expect(await store.getGate("no-such-gate")).toBeNull();
      });

      it("does not overwrite an already-decided gate with a second, conflicting decision", async () => {
        const run = makeRun("run-gate-conflict");
        await store.createRun(run);
        const locked = createGate({ id: "gate-conflict-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5, reason: "looks good" });
        const wonFirst = await store.saveGate(approved, run.id);
        expect(wonFirst).toBe(true);

        // A second, conflicting decision over the now-decided gate.
        const rejected = rejectGate(locked, { by: "someone-else", at: T5, reason: "actually, no" });
        const wonSecond = await store.saveGate(rejected, run.id);
        expect(wonSecond).toBe(false);

        const loaded = await store.getGate("gate-conflict-1");
        expect(loaded).toEqual(approved);
      });

      it("does not let a stale locked gate revert an already-decided gate", async () => {
        const run = makeRun("run-gate-stale");
        await store.createRun(run);
        const locked = createGate({ id: "gate-stale-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        await store.saveGate(approved, run.id);

        // A caller that still holds the stale, pre-decision locked value.
        const wonStale = await store.saveGate(locked, run.id);
        expect(wonStale).toBe(false);

        const loaded = await store.getGate("gate-stale-1");
        expect(loaded).toEqual(approved);
      });

      // A locked gate binds one specific action/run — the identity and
      // binding fields (actionId, createdAt, expiresAt, run association)
      // must never change out from under a decision. `saveGate` may only
      // ever *advance the decision* on the exact same gate, never rebind it
      // to a different action, timestamps, or run while still deciding it.
      it("advances a locked gate to approved with the SAME binding", async () => {
        const run = makeRun("run-gate-bind-ok");
        await store.createRun(run);
        const locked = createGate({ id: "gate-bind-ok-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const won = await store.saveGate(approved, run.id);
        expect(won).toBe(true);
        expect((await store.getGate("gate-bind-ok-1"))?.state).toBe("approved");
      });

      it("advances a locked gate to rejected with the SAME binding", async () => {
        const run = makeRun("run-gate-bind-ok-2");
        await store.createRun(run);
        const locked = createGate({ id: "gate-bind-ok-2", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const rejected = rejectGate(locked, { by: "sahil", at: T5, reason: "no" });
        const won = await store.saveGate(rejected, run.id);
        expect(won).toBe(true);
        expect((await store.getGate("gate-bind-ok-2"))?.state).toBe("rejected");
      });

      it("refuses a same-id gate write with a DIFFERENT actionId, leaving the original intact", async () => {
        const run = makeRun("run-gate-bind-action");
        await store.createRun(run);
        const locked = createGate({ id: "gate-bind-action-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const rebound = { ...locked, actionId: "action-EVIL" };
        const won = await store.saveGate(rebound, run.id);
        expect(won).toBe(false);

        const loaded = await store.getGate("gate-bind-action-1");
        expect(loaded).toEqual(locked);
      });

      it("refuses a same-id gate write with a DIFFERENT createdAt, leaving the original intact", async () => {
        const run = makeRun("run-gate-bind-created");
        await store.createRun(run);
        const locked = createGate({ id: "gate-bind-created-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const rebound = { ...locked, createdAt: T5 };
        const won = await store.saveGate(rebound, run.id);
        expect(won).toBe(false);

        const loaded = await store.getGate("gate-bind-created-1");
        expect(loaded).toEqual(locked);
      });

      it("refuses a same-id gate write with a DIFFERENT expiresAt, leaving the original intact", async () => {
        const run = makeRun("run-gate-bind-expires");
        await store.createRun(run);
        const locked = createGate({ id: "gate-bind-expires-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const rebound = { ...locked, expiresAt: "2026-08-25T09:00:00.000Z" };
        const won = await store.saveGate(rebound, run.id);
        expect(won).toBe(false);

        const loaded = await store.getGate("gate-bind-expires-1");
        expect(loaded).toEqual(locked);
      });

      it("refuses a same-id gate write with a DIFFERENT run association, leaving the original intact", async () => {
        const run = makeRun("run-gate-bind-run-a");
        await store.createRun(run);
        const otherRun = makeRun("run-gate-bind-run-b", { incidentId: "inc-other" });
        await store.createRun(otherRun);

        const locked = createGate({ id: "gate-bind-run-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        // Same gate value, but claimed against a different run.
        const won = await store.saveGate(locked, otherRun.id);
        expect(won).toBe(false);

        const loaded = await store.getGate("gate-bind-run-1");
        expect(loaded).toEqual(locked);
      });
    });

    describe("audit log", () => {
      it("rejects a duplicate audit id instead of overwriting", async () => {
        const run = makeRun("run-7");
        await store.createRun(run);
        const entry: AuditEntry = { id: "audit-1", runId: run.id, at: T0, kind: "run_created", detail: "created" };

        await store.appendAudit(entry);
        await expect(store.appendAudit({ ...entry, detail: "overwritten" })).rejects.toThrow();

        const [loaded] = await store.listAudit(run.id);
        expect(loaded?.detail).toBe("created");
      });

      it("lists audit entries for one run in `at` order", async () => {
        const run = makeRun("run-8");
        await store.createRun(run);
        const other = makeRun("run-9");
        await store.createRun(other);

        const entries: AuditEntry[] = [
          { id: "audit-run8-b", runId: run.id, at: "2026-08-25T02:10:00.000Z", kind: "gate_approved", detail: "b" },
          { id: "audit-run8-a", runId: run.id, at: "2026-08-25T02:00:00.000Z", kind: "run_created", detail: "a" },
          { id: "audit-run8-c", runId: run.id, at: "2026-08-25T02:20:00.000Z", kind: "action_executed", detail: "c" },
          { id: "audit-run9-x", runId: other.id, at: "2026-08-25T02:05:00.000Z", kind: "run_created", detail: "x" }
        ];
        for (const entry of entries) {
          await store.appendAudit(entry);
        }

        const loaded = await store.listAudit(run.id);
        expect(loaded.map((e) => e.id)).toEqual(["audit-run8-a", "audit-run8-b", "audit-run8-c"]);
      });
    });

    describe("listRecentAudit", () => {
      it("returns the most recent entries across every run, newest first, capped at limit", async () => {
        const run = makeRun("run-recent-audit-1", { incidentId: "inc-recent-audit" });
        await store.createRun(run);
        const other = makeRun("run-recent-audit-2", { incidentId: "inc-recent-audit" });
        await store.createRun(other);

        // Timestamps are deliberately far later than every other test's
        // audit fixtures in this suite (all 2026-08-25T02:xx/07:xx) so this
        // test's `limit`-based slice can't accidentally include one of
        // theirs and vice versa.
        const entries: AuditEntry[] = [
          { id: "audit-recent-a", runId: run.id, at: "2026-08-25T09:00:00.000Z", kind: "run_created", detail: "a" },
          { id: "audit-recent-b", runId: other.id, at: "2026-08-25T09:05:00.000Z", kind: "run_created", detail: "b" },
          { id: "audit-recent-c", runId: run.id, at: "2026-08-25T09:10:00.000Z", kind: "gate_approved", detail: "c" }
        ];
        for (const entry of entries) {
          await store.appendAudit(entry);
        }

        const loaded = await store.listRecentAudit(2);
        expect(loaded.map((e) => e.id)).toEqual(["audit-recent-c", "audit-recent-b"]);
      });
    });

    describe("incidents", () => {
      const makeIncident = (id: string, overrides: Partial<IncidentRow> = {}): IncidentRow => ({
        id,
        title: "Checkout failures spiking",
        service: "payment-service",
        signals: ["timeout", "error_rate"],
        status: "open",
        createdBy: "sahil@example.com",
        createdAt: T0,
        ...overrides
      });

      it("round-trips an incident, including the signals array", async () => {
        const incident = makeIncident("inc-store-1");
        await store.createIncident(incident);
        expect(await store.getIncident("inc-store-1")).toEqual(incident);
      });

      it("returns null for a missing incident", async () => {
        expect(await store.getIncident("no-such-incident")).toBeNull();
      });

      it("lists incidents newest-first and filters by status", async () => {
        await store.createIncident(makeIncident("inc-store-open", { status: "open", createdAt: "2026-08-25T07:00:00.000Z" }));
        await store.createIncident(makeIncident("inc-store-resolved", { status: "resolved", createdAt: "2026-08-25T07:05:00.000Z" }));

        const openOnly = await store.listIncidents({ status: "open" });
        expect(openOnly.map((i) => i.id)).toContain("inc-store-open");
        expect(openOnly.map((i) => i.id)).not.toContain("inc-store-resolved");

        const all = await store.listIncidents();
        const allIds = all.map((i) => i.id);
        expect(allIds.indexOf("inc-store-resolved")).toBeLessThan(allIds.indexOf("inc-store-open"));
      });

      // `incidents.id` is a PRIMARY KEY.
      it("rejects creating an incident with a duplicate id", async () => {
        await store.createIncident(makeIncident("inc-dup-1"));
        await expect(store.createIncident(makeIncident("inc-dup-1", { title: "different title" }))).rejects.toThrow();
      });
    });

    describe("users", () => {
      const makeUser = (id: string, email: string): UserRow => ({
        id,
        email,
        passwordHash: "hash",
        salt: "salt",
        createdAt: T0
      });

      it("round-trips a user by id and by email", async () => {
        const user = makeUser("user-1", "operator@example.com");
        await store.createUser(user);

        expect(await store.getUserById("user-1")).toEqual(user);
        expect(await store.getUserByEmail("operator@example.com")).toEqual(user);
      });

      it("returns null for a missing user, by id or by email", async () => {
        expect(await store.getUserById("no-such-user")).toBeNull();
        expect(await store.getUserByEmail("nobody@example.com")).toBeNull();
      });

      // `users.id` is a PRIMARY KEY.
      it("rejects creating a user with a duplicate id", async () => {
        await store.createUser(makeUser("user-dup-1", "dup1@example.com"));
        await expect(store.createUser(makeUser("user-dup-1", "dup1-other@example.com"))).rejects.toThrow();
      });

      // `users.email` is UNIQUE (migrations/0002_auth_and_incidents.sql).
      it("rejects creating a user with a duplicate email under a different id", async () => {
        await store.createUser(makeUser("user-dup-2", "dup2@example.com"));
        await expect(store.createUser(makeUser("user-dup-3", "dup2@example.com"))).rejects.toThrow();
      });

      // Regression coverage for the exact bug reported: recreating a user
      // id with a different email must not leave the *old* email's index
      // entry resolving to a row whose email no longer matches it — the
      // rejected write must not have touched anything.
      it("leaves the email index untouched when a duplicate-id create is rejected", async () => {
        await store.createUser(makeUser("user-dup-4", "original@example.com"));
        await expect(store.createUser(makeUser("user-dup-4", "changed@example.com"))).rejects.toThrow();

        const byOriginalEmail = await store.getUserByEmail("original@example.com");
        expect(byOriginalEmail?.id).toBe("user-dup-4");
        expect(byOriginalEmail?.email).toBe("original@example.com");
        expect(await store.getUserByEmail("changed@example.com")).toBeNull();
      });
    });

    describe("sessions", () => {
      const makeSession = (id: string, overrides: Partial<SessionRow> = {}): SessionRow => ({
        id,
        userId: "user-1",
        createdAt: T0,
        expiresAt: "2026-09-25T02:00:00.000Z",
        ...overrides
      });

      it("round-trips a session", async () => {
        const session = makeSession("session-1");
        await store.createSession(session);
        expect(await store.getSession("session-1")).toEqual(session);
      });

      it("returns null for a missing session", async () => {
        expect(await store.getSession("no-such-session")).toBeNull();
      });

      it("deleteSession revokes it immediately", async () => {
        const session = makeSession("session-2");
        await store.createSession(session);
        await store.deleteSession("session-2");
        expect(await store.getSession("session-2")).toBeNull();
      });

      // `sessions.id` is a PRIMARY KEY.
      it("rejects creating a session with a duplicate id", async () => {
        await store.createSession(makeSession("session-dup-1"));
        await expect(store.createSession(makeSession("session-dup-1", { userId: "user-2" }))).rejects.toThrow();
      });

      it("deleteExpiredSessions removes only sessions expired as of the given time", async () => {
        await store.createSession(makeSession("session-expired", { expiresAt: "2026-08-25T02:00:00.000Z" }));
        await store.createSession(makeSession("session-live", { expiresAt: "2026-09-25T02:00:00.000Z" }));

        await store.deleteExpiredSessions("2026-08-25T02:00:01.000Z");

        expect(await store.getSession("session-expired")).toBeNull();
        expect(await store.getSession("session-live")).not.toBeNull();
      });
    });
  });
}
