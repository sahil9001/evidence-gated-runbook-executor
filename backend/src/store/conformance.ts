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

    describe("createRunWithArtifacts", () => {
      it("atomically creates the run, packet, action, gate, and audit entries", async () => {
        const run = makeRun("run-atomic-1", { incidentId: "inc-atomic-1", state: "awaiting_approval" });
        const packet = makePacket("packet-atomic-1", "inc-atomic-1");
        const action = makeAction("action-atomic-1");
        const gate = createGate({ id: "run-atomic-1", actionId: action.id, createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const auditEntries: AuditEntry[] = [
          { id: "audit-atomic-1", runId: run.id, at: T0, kind: "run_created", detail: "created" }
        ];

        await store.createRunWithArtifacts({ run, packet, action, gate, auditEntries });

        expect(await store.getRun(run.id)).toEqual(run);
        expect(await store.getPacketByRun(run.id)).toEqual(packet);
        expect(await store.getAction(action.id)).toEqual(action);
        expect(await store.getGate(gate.id)).toEqual(gate);
        expect((await store.listAudit(run.id)).map((e) => e.id)).toEqual(["audit-atomic-1"]);
      });

      it("leaves NO partial run behind when one artifact collides with an existing row", async () => {
        // Seed a packet id that the next createRunWithArtifacts call will
        // collide on, so its INSERT fails partway through the batch.
        const collidingRun = makeRun("run-atomic-seed", { incidentId: "inc-atomic-2" });
        await store.createRun(collidingRun);
        await store.savePacket(makePacket("packet-atomic-collide", "inc-atomic-2"), collidingRun.id);

        const run = makeRun("run-atomic-2", { incidentId: "inc-atomic-2", state: "awaiting_approval" });
        const packet = makePacket("packet-atomic-collide", "inc-atomic-2"); // duplicate id
        const action = makeAction("action-atomic-2");
        const gate = createGate({ id: "run-atomic-2", actionId: action.id, createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const auditEntries: AuditEntry[] = [
          { id: "audit-atomic-2", runId: run.id, at: T0, kind: "run_created", detail: "created" }
        ];

        await expect(store.createRunWithArtifacts({ run, packet, action, gate, auditEntries })).rejects.toThrow();

        // Nothing from the failed attempt landed — not even the run row,
        // which a naive independent-writes implementation would have
        // created before reaching the colliding packet insert.
        expect(await store.getRun(run.id)).toBeNull();
        expect(await store.getAction(action.id)).toBeNull();
        expect(await store.getGate(gate.id)).toBeNull();
        expect(await store.listAudit(run.id)).toEqual([]);
      });

      it("a retry with fresh ids succeeds cleanly after a failed attempt", async () => {
        const collidingRun = makeRun("run-atomic-seed-2", { incidentId: "inc-atomic-3" });
        await store.createRun(collidingRun);
        await store.savePacket(makePacket("packet-atomic-collide-2", "inc-atomic-3"), collidingRun.id);

        const failedRun = makeRun("run-atomic-3", { incidentId: "inc-atomic-3", state: "awaiting_approval" });
        await expect(
          store.createRunWithArtifacts({
            run: failedRun,
            packet: makePacket("packet-atomic-collide-2", "inc-atomic-3"),
            action: makeAction("action-atomic-3"),
            gate: createGate({ id: "run-atomic-3", actionId: "action-atomic-3", createdAt: T0, ttlMs: 15 * 60 * 1000 }),
            auditEntries: [{ id: "audit-atomic-3", runId: failedRun.id, at: T0, kind: "run_created", detail: "created" }]
          })
        ).rejects.toThrow();

        // Retry with entirely fresh ids — not resuming the failed run id,
        // since retrying THIS endpoint always mints a new run id.
        const retryRun = makeRun("run-atomic-3-retry", { incidentId: "inc-atomic-3", state: "awaiting_approval" });
        const retryPacket = makePacket("packet-atomic-3-retry", "inc-atomic-3");
        const retryAction = makeAction("action-atomic-3-retry");
        const retryGate = createGate({
          id: "run-atomic-3-retry",
          actionId: retryAction.id,
          createdAt: T0,
          ttlMs: 15 * 60 * 1000
        });

        await store.createRunWithArtifacts({
          run: retryRun,
          packet: retryPacket,
          action: retryAction,
          gate: retryGate,
          auditEntries: [{ id: "audit-atomic-3-retry", runId: retryRun.id, at: T0, kind: "run_created", detail: "created" }]
        });

        expect(await store.getRun(retryRun.id)).toEqual(retryRun);
        expect(await store.getGate(retryGate.id)).toEqual(retryGate);
      });

      it("rejects a packet whose incidentId differs from the run's, writing NOTHING", async () => {
        const run = makeRun("run-atomic-bad-packet", { incidentId: "inc-atomic-bad-packet" });
        const packet = makePacket("packet-atomic-bad-packet", "inc-some-other-incident");
        const action = makeAction("action-atomic-bad-packet");
        const gate = createGate({ id: run.id, actionId: action.id, createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const auditEntries: AuditEntry[] = [
          { id: "audit-atomic-bad-packet", runId: run.id, at: T0, kind: "run_created", detail: "created" }
        ];

        await expect(store.createRunWithArtifacts({ run, packet, action, gate, auditEntries })).rejects.toThrow();

        expect(await store.getRun(run.id)).toBeNull();
        expect(await store.getAction(action.id)).toBeNull();
        expect(await store.getGate(gate.id)).toBeNull();
        expect(await store.listAudit(run.id)).toEqual([]);
      });

      it("rejects a gate whose actionId doesn't match the action's id, writing NOTHING", async () => {
        const run = makeRun("run-atomic-bad-gate", { incidentId: "inc-atomic-bad-gate" });
        const packet = makePacket("packet-atomic-bad-gate", "inc-atomic-bad-gate");
        const action = makeAction("action-atomic-bad-gate");
        const gate = createGate({ id: run.id, actionId: "action-does-not-match", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const auditEntries: AuditEntry[] = [
          { id: "audit-atomic-bad-gate", runId: run.id, at: T0, kind: "run_created", detail: "created" }
        ];

        await expect(store.createRunWithArtifacts({ run, packet, action, gate, auditEntries })).rejects.toThrow();

        expect(await store.getRun(run.id)).toBeNull();
        expect(await store.getPacketByRun(run.id)).toBeNull();
        expect(await store.getGate(gate.id)).toBeNull();
        expect(await store.listAudit(run.id)).toEqual([]);
      });

      it("rejects an audit entry naming a different run, writing NOTHING", async () => {
        const run = makeRun("run-atomic-bad-audit", { incidentId: "inc-atomic-bad-audit" });
        const packet = makePacket("packet-atomic-bad-audit", "inc-atomic-bad-audit");
        const action = makeAction("action-atomic-bad-audit");
        const gate = createGate({ id: run.id, actionId: action.id, createdAt: T0, ttlMs: 15 * 60 * 1000 });
        const auditEntries: AuditEntry[] = [
          { id: "audit-atomic-bad-audit", runId: "some-other-run-id", at: T0, kind: "run_created", detail: "created" }
        ];

        await expect(store.createRunWithArtifacts({ run, packet, action, gate, auditEntries })).rejects.toThrow();

        expect(await store.getRun(run.id)).toBeNull();
        expect(await store.getPacketByRun(run.id)).toBeNull();
        expect(await store.getAction(action.id)).toBeNull();
        expect(await store.getGate(gate.id)).toBeNull();
        expect(await store.listAudit("some-other-run-id")).toEqual([]);
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

    describe("getPacketByRun", () => {
      it("returns the packet for that specific run, not any other run's packet on the same incident", async () => {
        const incidentId = "inc-packet-by-run";
        const runA = makeRun("run-packet-by-run-a", { incidentId });
        const runB = makeRun("run-packet-by-run-b", { incidentId });
        await store.createRun(runA);
        await store.createRun(runB);

        // runA's packet has an EARLIER builtAt than runB's — if
        // getPacketByRun were implemented as "latest packet on the
        // incident" (the bug getPacketByIncident has for this use case),
        // runA's own lookup would incorrectly return runB's packet.
        const packetA = makePacket("packet-by-run-a", incidentId, T0);
        const packetB = makePacket("packet-by-run-b", incidentId, T5);
        await store.savePacket(packetA, runA.id);
        await store.savePacket(packetB, runB.id);

        expect((await store.getPacketByRun(runA.id))?.id).toBe("packet-by-run-a");
        expect((await store.getPacketByRun(runB.id))?.id).toBe("packet-by-run-b");
      });

      it("returns null for a run with no packet of its own", async () => {
        const run = makeRun("run-packet-by-run-none", { incidentId: "inc-packet-by-run-none" });
        await store.createRun(run);
        expect(await store.getPacketByRun(run.id)).toBeNull();
      });

      it("returns null for a nonexistent run id", async () => {
        expect(await store.getPacketByRun("run-does-not-exist")).toBeNull();
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

    describe("decideGate", () => {
      it("atomically transitions run to approved AND the gate to approved", async () => {
        const run = makeRun("run-decide-1", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const won = await store.decideGate(approved, run.id, T5);

        expect(won).toBe(true);
        expect((await store.getRun(run.id))?.state).toBe("approved");
        expect(await store.getGate(run.id)).toEqual(approved);
      });

      it("atomically transitions run to rejected AND the gate to rejected", async () => {
        const run = makeRun("run-decide-2", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const rejected = rejectGate(locked, { by: "sahil", at: T5, reason: "not confident" });
        const won = await store.decideGate(rejected, run.id, T5);

        expect(won).toBe(true);
        expect((await store.getRun(run.id))?.state).toBe("rejected");
        expect(await store.getGate(run.id)).toEqual(rejected);
      });

      it("refuses — leaving BOTH run and gate untouched — when the run is not awaiting_approval", async () => {
        const run = makeRun("run-decide-3", { state: "collecting" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const won = await store.decideGate(approved, run.id, T5);

        expect(won).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("collecting");
        expect((await store.getGate(run.id))?.state).toBe("locked");
      });

      it("refuses — leaving BOTH run and gate untouched — when the gate is already decided", async () => {
        const run = makeRun("run-decide-4", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);
        const { gate: firstApproval } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const firstWon = await store.decideGate(firstApproval, run.id, T5);
        expect(firstWon).toBe(true);

        // A second, conflicting decision attempt over the now-decided gate —
        // note the run is already "approved" too, so a naive implementation
        // that only checked the run's state (not the gate's) could wrongly
        // let this through.
        const secondAttempt = { ...firstApproval, decidedBy: "someone-else" };
        const secondWon = await store.decideGate(secondAttempt, run.id, T5);

        expect(secondWon).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("approved");
        expect(await store.getGate(run.id)).toEqual(firstApproval);
      });

      it("refuses — leaving BOTH run and gate untouched — when the decided gate's actionId doesn't match the stored gate's", async () => {
        const run = makeRun("run-decide-mismatch-action", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-real", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-real"), { by: "sahil", at: T5 });
        const mismatched = { ...approved, actionId: "action-different" };

        const won = await store.decideGate(mismatched, run.id, T5);

        expect(won).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("awaiting_approval");
        expect((await store.getGate(run.id))?.state).toBe("locked");
      });

      it("refuses — leaving BOTH run and gate untouched — when the decided gate's createdAt doesn't match the stored gate's", async () => {
        const run = makeRun("run-decide-mismatch-created", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-real", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-real"), { by: "sahil", at: T5 });
        const mismatched = { ...approved, createdAt: "2026-08-25T01:00:00.000Z" };

        const won = await store.decideGate(mismatched, run.id, T5);

        expect(won).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("awaiting_approval");
        expect((await store.getGate(run.id))?.state).toBe("locked");
      });

      it("refuses — leaving BOTH run and gate untouched — when the decided gate's expiresAt doesn't match the stored gate's", async () => {
        const run = makeRun("run-decide-mismatch-expires", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-real", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-real"), { by: "sahil", at: T5 });
        const mismatched = { ...approved, expiresAt: "2026-08-25T09:00:00.000Z" };

        const won = await store.decideGate(mismatched, run.id, T5);

        expect(won).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("awaiting_approval");
        expect((await store.getGate(run.id))?.state).toBe("locked");
      });

      it("refuses — leaving BOTH runs and the gate untouched — when the gate belongs to a different run", async () => {
        const runA = makeRun("run-decide-assoc-a", { state: "awaiting_approval" });
        await store.createRun(runA);
        const lockedA = createGate({ id: runA.id, actionId: "action-a", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(lockedA, runA.id);

        const runB = makeRun("run-decide-assoc-b", { state: "awaiting_approval" });
        await store.createRun(runB);

        const { gate: approvedA } = approveGate(lockedA, makeAction("action-a"), { by: "sahil", at: T5 });

        // Gate A's own decision, but decided against run B instead of run A.
        const won = await store.decideGate(approvedA, runB.id, T5);

        expect(won).toBe(false);
        expect((await store.getRun(runA.id))?.state).toBe("awaiting_approval");
        expect((await store.getRun(runB.id))?.state).toBe("awaiting_approval");
        expect((await store.getGate(runA.id))?.state).toBe("locked");
      });

      it("a retry after a refused mismatched decideGate succeeds with the correctly-bound gate", async () => {
        const run = makeRun("run-decide-retry-after-mismatch", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-retry", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-retry"), { by: "sahil", at: T5 });
        const mismatched = { ...approved, actionId: "action-wrong" };

        const refused = await store.decideGate(mismatched, run.id, T5);
        expect(refused).toBe(false);
        expect((await store.getRun(run.id))?.state).toBe("awaiting_approval");

        const retryWon = await store.decideGate(approved, run.id, T5);

        expect(retryWon).toBe(true);
        expect((await store.getRun(run.id))?.state).toBe("approved");
        expect((await store.getGate(run.id))?.state).toBe("approved");
      });

      it("under concurrent decideGate calls for the same gate, exactly one wins", async () => {
        const run = makeRun("run-decide-race", { state: "awaiting_approval" });
        await store.createRun(run);
        const locked = createGate({ id: run.id, actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
        await store.saveGate(locked, run.id);

        const { gate: approved } = approveGate(locked, makeAction("action-1"), { by: "sahil", at: T5 });
        const rejected = rejectGate(locked, { by: "someone-else", at: T5, reason: "racing" });

        const [approveWon, rejectWon] = await Promise.all([
          store.decideGate(approved, run.id, T5),
          store.decideGate(rejected, run.id, T5)
        ]);

        expect([approveWon, rejectWon].filter(Boolean)).toHaveLength(1);
        const finalRun = await store.getRun(run.id);
        const finalGate = await store.getGate(run.id);
        // Whichever won, run and gate must agree with each other — never a
        // run claimed as one decision while the gate records the other.
        expect(finalRun?.state).toBe(finalGate?.state);
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

    describe("createUserWithSession", () => {
      const makeUser = (id: string, email: string): UserRow => ({
        id,
        email,
        passwordHash: "hash",
        salt: "salt",
        createdAt: T0
      });

      const makeSessionFor = (id: string, userId: string): SessionRow => ({
        id,
        userId,
        createdAt: T0,
        expiresAt: "2026-09-25T02:00:00.000Z"
      });

      it("creates the user and its session as a single write", async () => {
        const user = makeUser("user-cus-1", "cus1@example.com");
        const session = makeSessionFor("session-cus-1", "user-cus-1");

        await store.createUserWithSession(user, session);

        expect(await store.getUserById("user-cus-1")).toEqual(user);
        expect(await store.getSession("session-cus-1")).toEqual(session);
      });

      // Simulates the exact failure Finding 3 is about: the session half of
      // the write collides (here, on a pre-existing session id) and must
      // fail. If the two writes were independent, the user row would be
      // left behind with no session — and a retry of registration would
      // report `email_taken` for an account nobody can ever reach. Atomic
      // writes rule that out: neither row lands, and a retry with a fresh
      // session succeeds cleanly.
      it("rejects when the session write collides, leaving no user row behind, and a retry succeeds", async () => {
        const priorOwner = makeUser("user-cus-collider", "collider@example.com");
        await store.createUser(priorOwner);
        await store.createSession(makeSessionFor("session-cus-collide", priorOwner.id));

        const user = makeUser("user-cus-2", "cus2@example.com");
        const collidingSession = makeSessionFor("session-cus-collide", user.id);

        await expect(store.createUserWithSession(user, collidingSession)).rejects.toThrow();

        expect(await store.getUserById("user-cus-2")).toBeNull();
        expect(await store.getUserByEmail("cus2@example.com")).toBeNull();

        // A retry with a fresh (non-colliding) session must succeed — no
        // phantom "email_taken" residue from the failed attempt above.
        const retrySession = makeSessionFor("session-cus-2-retry", user.id);
        await store.createUserWithSession(user, retrySession);

        expect(await store.getUserById("user-cus-2")).toEqual(user);
        expect(await store.getSession("session-cus-2-retry")).toEqual(retrySession);
      });

      it("rejects a duplicate email, leaving neither the user nor the session written", async () => {
        const original = makeUser("user-cus-3", "cus3-dup@example.com");
        await store.createUser(original);

        const duplicate = makeUser("user-cus-4", "cus3-dup@example.com");
        const session = makeSessionFor("session-cus-4", "user-cus-4");

        await expect(store.createUserWithSession(duplicate, session)).rejects.toThrow();

        expect(await store.getUserById("user-cus-4")).toBeNull();
        expect(await store.getSession("session-cus-4")).toBeNull();
        expect((await store.getUserByEmail("cus3-dup@example.com"))?.id).toBe("user-cus-3");
      });

      // Qodo finding: "session pairing is unenforced". Nothing checked that
      // the session named the user being created, so a caller passing a
      // session whose userId names a DIFFERENT, already-existing user got a
      // session that authenticates that other account — an auth-bypass
      // shape, not a data-integrity nit. This must never be reachable from
      // the register route (buildSession always pairs userId to the freshly
      // minted user id), but the store layer enforces it anyway so it stays
      // that way: a programming error here throws instead of silently
      // minting a working session for the wrong account.
      it("rejects when session.userId does not match the user being created, writing neither row", async () => {
        const otherUser = makeUser("user-cus-victim", "victim@example.com");
        await store.createUser(otherUser);

        const user = makeUser("user-cus-mismatch", "mismatch@example.com");
        const mismatchedSession = makeSessionFor("session-cus-mismatch", otherUser.id);

        await expect(store.createUserWithSession(user, mismatchedSession)).rejects.toThrow();

        expect(await store.getUserById("user-cus-mismatch")).toBeNull();
        expect(await store.getUserByEmail("mismatch@example.com")).toBeNull();
        expect(await store.getSession("session-cus-mismatch")).toBeNull();
      });

      // Same shape, but the named user doesn't exist at all — an unusable
      // session for nobody. D1's foreign key already rejects this; the
      // memory adapter must too (see the `createSession` FK-parity test
      // below for the direct case).
      it("rejects when session.userId names a user that does not exist, writing neither row", async () => {
        const user = makeUser("user-cus-ghost", "ghost@example.com");
        const session = makeSessionFor("session-cus-ghost", "user-does-not-exist");

        await expect(store.createUserWithSession(user, session)).rejects.toThrow();

        expect(await store.getUserById("user-cus-ghost")).toBeNull();
        expect(await store.getUserByEmail("ghost@example.com")).toBeNull();
        expect(await store.getSession("session-cus-ghost")).toBeNull();
      });

      it("still supports the normal paired case: session.userId equals the created user's id", async () => {
        const user = makeUser("user-cus-paired", "paired@example.com");
        const session = makeSessionFor("session-cus-paired", user.id);

        await store.createUserWithSession(user, session);

        expect(await store.getUserById("user-cus-paired")).toEqual(user);
        expect(await store.getSession("session-cus-paired")).toEqual(session);
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

      // `sessions.user_id REFERENCES users (id)` (migrations/0002). D1
      // rejects an INSERT naming a nonexistent user via this foreign key;
      // the memory adapter must reject it too instead of silently accepting
      // a session for a user that was never created.
      it("rejects creating a session that references a nonexistent user", async () => {
        await expect(store.createSession(makeSession("session-fk-ghost", { userId: "user-does-not-exist" }))).rejects.toThrow();
        expect(await store.getSession("session-fk-ghost")).toBeNull();
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
