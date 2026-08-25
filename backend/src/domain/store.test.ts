import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store, type RunRow, type AuditEntry } from "./store";
import { evidencePacketSchema, type EvidencePacket } from "./evidence";
import { createAction, type Action } from "./action";
import { createGate, approveGate } from "./approval";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const T0 = "2026-08-25T02:00:00.000Z";
const T5 = "2026-08-25T02:05:00.000Z";

const makeRun = (id: string): RunRow => ({
  id,
  incidentId: "inc-1",
  runbookId: "checkout-failure",
  service: "payment-service",
  state: "collecting",
  createdAt: T0,
  updatedAt: T0
});

const makePacket = (id: string, incidentId: string): EvidencePacket =>
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
    builtAt: T0
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

describe("createD1Store", () => {
  it("round-trips a run", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-1");

    await store.createRun(run);
    const loaded = await store.getRun("run-1");

    expect(loaded).toEqual(run);
  });

  it("returns null for a missing run", async () => {
    const store = createD1Store(env.DB);
    expect(await store.getRun("does-not-exist")).toBeNull();
  });

  it("updates run state and leaves other fields untouched", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-2");
    await store.createRun(run);

    await store.updateRunState("run-2", "awaiting_approval", T5);
    const loaded = await store.getRun("run-2");

    expect(loaded).toEqual({ ...run, state: "awaiting_approval", updatedAt: T5 });
  });

  it("round-trips a packet, surviving evidencePacketSchema.parse", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-3");
    await store.createRun(run);
    const packet = makePacket("packet-1", run.incidentId);

    await store.savePacket(packet, run.id);
    const loaded = await store.getPacketByIncident(run.incidentId);

    expect(loaded).not.toBeNull();
    expect(evidencePacketSchema.parse(loaded)).toEqual(packet);
  });

  it("returns null for a packet with no matching incident", async () => {
    const store = createD1Store(env.DB);
    expect(await store.getPacketByIncident("no-such-incident")).toBeNull();
  });

  it("round-trips an action", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-4");
    await store.createRun(run);
    const action = makeAction("action-1");

    await store.saveAction(action, run.id);
    const loaded = await store.getAction("action-1");

    expect(loaded).toEqual(action);
  });

  it("returns null for a missing action", async () => {
    const store = createD1Store(env.DB);
    expect(await store.getAction("no-such-action")).toBeNull();
  });

  it("round-trips a locked gate", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-5");
    await store.createRun(run);
    const gate = createGate({ id: "gate-1", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });

    await store.saveGate(gate, run.id);
    const loaded = await store.getGate("gate-1");

    expect(loaded).toEqual(gate);
    expect(loaded?.state).toBe("locked");
  });

  it("round-trips an approved gate with decidedBy/decidedAt intact", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-6");
    await store.createRun(run);
    const locked = createGate({ id: "gate-2", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });
    const { gate: approved } = approveGate(locked, { by: "sahil", at: T5, reason: "looks good" });

    await store.saveGate(approved, run.id);
    const loaded = await store.getGate("gate-2");

    expect(loaded).toEqual(approved);
    expect(loaded?.state).toBe("approved");
    if (loaded?.state !== "approved") throw new Error("expected approved gate");
    expect(loaded.decidedBy).toBe("sahil");
    expect(loaded.decidedAt).toBe(T5);
  });

  it("upserts a gate: approving after the locked row was saved replaces it in place", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-10");
    await store.createRun(run);
    const locked = createGate({ id: "gate-3", actionId: "action-1", createdAt: T0, ttlMs: 15 * 60 * 1000 });

    await store.saveGate(locked, run.id);
    expect((await store.getGate("gate-3"))?.state).toBe("locked");

    const { gate: approved } = approveGate(locked, { by: "sahil", at: T5 });
    await store.saveGate(approved, run.id);

    const loaded = await store.getGate("gate-3");
    expect(loaded).toEqual(approved);
    if (loaded?.state !== "approved") throw new Error("expected approved gate");
    expect(loaded.state).toBe("approved");
    expect(loaded.decidedBy).toBe("sahil");
  });

  it("returns null for a missing gate", async () => {
    const store = createD1Store(env.DB);
    expect(await store.getGate("no-such-gate")).toBeNull();
  });

  it("rejects a duplicate audit id instead of overwriting", async () => {
    const store = createD1Store(env.DB);
    const run = makeRun("run-7");
    await store.createRun(run);
    const entry: AuditEntry = { id: "audit-1", runId: run.id, at: T0, kind: "run_created", detail: "created" };

    await store.appendAudit(entry);

    await expect(
      store.appendAudit({ ...entry, detail: "overwritten" })
    ).rejects.toThrow();

    const [loaded] = await store.listAudit(run.id);
    expect(loaded?.detail).toBe("created");
  });

  it("lists audit entries for one run in `at` order", async () => {
    const store = createD1Store(env.DB);
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
