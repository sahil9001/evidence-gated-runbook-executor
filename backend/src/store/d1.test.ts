import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import { createD1Store } from "./d1";
import { runStoreConformance } from "./conformance";
import type { RunRow } from "../domain/store";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

runStoreConformance("D1", () => createD1Store(env.DB));

const T0 = "2026-08-25T02:00:00.000Z";

const makeRun = (id: string): RunRow => ({
  id,
  incidentId: "inc-1",
  runbookId: "checkout-failure",
  service: "payment-service",
  state: "collecting",
  createdAt: T0,
  updatedAt: T0
});

/**
 * D1-specific defence-in-depth tests: they bypass the `Store` API entirely
 * to write a row that could never be produced through `saveAction` /
 * `saveGate`, simulating a corrupted or tampered `TEXT` column. The memory
 * adapter has no equivalent bypass — it never serializes to an untyped
 * blob — so these can't be expressed as adapter-agnostic conformance tests.
 * See the doc comment on `runStoreConformance` for the full rationale.
 */
describe("createD1Store — defence-in-depth against corrupted rows", () => {
  it("re-derives isStateChanging on read, ignoring a corrupted stored value (C2)", async () => {
    // Bypass saveAction entirely: write an actions row where a rollback
    // (which must always be state-changing) was persisted with
    // isStateChanging: false. If getAction merely cast the JSON back to
    // Action, this flag would survive and a rollback would route to the
    // read-only, token-free executor.
    const store = createD1Store(env.DB);
    const run = makeRun("run-11");
    await store.createRun(run);
    const corrupted = {
      id: "action-corrupt-1",
      kind: "rollback",
      target: "payment-service",
      params: { commit: "8f31c2b" },
      reversible: true,
      description: "Roll back payment-service to 8f31c2b",
      isStateChanging: false
    };
    await env.DB.prepare(`INSERT INTO actions (id, run_id, data) VALUES (?, ?, ?)`)
      .bind(corrupted.id, run.id, JSON.stringify(corrupted))
      .run();

    const loaded = await store.getAction("action-corrupt-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.isStateChanging).toBe(true);
  });

  it("fails loudly on a corrupt expiresAt instead of producing an immortal gate (M9)", async () => {
    // Bypass saveGate entirely: write a locked gate whose expiresAt is not a
    // valid date. A cast (`as ApprovalGate`) would let this through
    // silently, and isExpired's Date.parse(...) on garbage yields NaN, so
    // `now >= NaN` is always false — the gate would never expire.
    // Zod-validation on read must reject this row instead.
    const store = createD1Store(env.DB);
    const run = makeRun("run-12");
    await store.createRun(run);
    const corrupted = {
      id: "gate-corrupt-1",
      actionId: "action-1",
      createdAt: T0,
      expiresAt: "not-a-date",
      state: "locked"
    };
    await env.DB.prepare(`INSERT INTO gates (id, run_id, data) VALUES (?, ?, ?)`)
      .bind(corrupted.id, run.id, JSON.stringify(corrupted))
      .run();

    await expect(store.getGate("gate-corrupt-1")).rejects.toThrow();
  });
});
