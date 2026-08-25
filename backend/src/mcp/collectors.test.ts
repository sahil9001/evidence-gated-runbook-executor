import { describe, it, expect } from "vitest";
import { evidenceCardSchema } from "../domain/evidence";
import { CollectorError, type CollectContext } from "./source";
import { createLogSource, type LogFixture } from "./logs";
import { createMetricSource, type MetricFixture } from "./metrics";
import { createDeploySource, type DeployFixture } from "./deploys";
import { ALL_SOURCES } from "./index";

const FIXED_NOW = "2026-08-25T02:00:00.000Z";

const ctx: CollectContext = {
  incidentId: "inc-checkout-1",
  service: "payment-service",
  now: () => FIXED_NOW
};

const validLog = (over: Partial<LogFixture> = {}): LogFixture => ({
  id: "log-x",
  service: "payment-service",
  level: "error",
  message: "connect ETIMEDOUT upstream payment-gateway",
  occurrenceCount: 10,
  kind: "timeout",
  timestamp: "2026-08-25T01:58:00.000Z",
  ...over
});

const validMetric = (over: Partial<MetricFixture> = {}): MetricFixture => ({
  id: "m-x",
  service: "payment-service",
  metric: "latency_p95_ms",
  timestamp: "2026-08-25T01:58:00.000Z",
  value: 3200,
  ...over
});

const validDeploy = (over: Partial<DeployFixture> = {}): DeployFixture => ({
  id: "d-x",
  service: "payment-service",
  commit: "8f31c2b",
  deployedAt: "2026-08-25T01:50:00.000Z",
  author: "sam.t",
  message: "Tighten upstream connection pool limits",
  risky: true,
  ...over
});

describe("createLogSource", () => {
  it("returns cards whose source is 'logs'", async () => {
    const cards = await createLogSource([validLog()]).collect(ctx);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.source).toBe("logs");
  });

  it("returns cards that all pass evidenceCardSchema", async () => {
    const cards = await createLogSource([validLog(), validLog({ id: "log-y", kind: "other" })]).collect(ctx);
    for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
  });

  it("stamps collectedAt from the injected now(), never a real clock", async () => {
    const distantPast = "1999-01-01T00:00:00.000Z";
    const cards = await createLogSource([validLog()]).collect({ ...ctx, now: () => distantPast });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.collectedAt).toBe(distantPast);
  });

  it("yields [] for an empty fixture array and never throws", async () => {
    const cards = await createLogSource([]).collect(ctx);
    expect(cards).toEqual([]);
  });

  it("throws CollectorError naming the source when a fixture is malformed", async () => {
    const malformed = [{ id: "bad", occurrenceCount: "not-a-number" } as unknown as LogFixture];
    await expect(createLogSource(malformed).collect(ctx)).rejects.toThrow(CollectorError);
    try {
      await createLogSource(malformed).collect(ctx);
      expect.unreachable("expected CollectorError");
    } catch (error) {
      expect(error).toBeInstanceOf(CollectorError);
      expect((error as CollectorError).kind).toBe("logs");
    }
  });

  it("finds the 47 failed requests the dashboard reports, excluding unrelated warn entries", async () => {
    const cards = await createLogSource().collect(ctx);
    expect(cards.some((c) => c.claim.includes("47"))).toBe(true);
  });

  it("does not just sum every entry regardless of kind (the fixture includes a 6-count non-timeout entry that must be excluded)", async () => {
    const cards = await createLogSource().collect(ctx);
    expect(cards.some((c) => c.claim.includes("53"))).toBe(false);
  });
});

describe("createMetricSource", () => {
  it("returns cards whose source is 'metrics'", async () => {
    const cards = await createMetricSource([validMetric()]).collect(ctx);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.source).toBe("metrics");
  });

  it("returns cards that all pass evidenceCardSchema", async () => {
    const cards = await createMetricSource([validMetric(), validMetric({ id: "m-y", value: 200 })]).collect(ctx);
    for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
  });

  it("stamps collectedAt from the injected now(), never a real clock", async () => {
    const distantPast = "1999-01-01T00:00:00.000Z";
    const cards = await createMetricSource([validMetric()]).collect({ ...ctx, now: () => distantPast });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.collectedAt).toBe(distantPast);
  });

  it("yields [] for an empty fixture array and never throws", async () => {
    const cards = await createMetricSource([]).collect(ctx);
    expect(cards).toEqual([]);
  });

  it("throws CollectorError naming the source when a fixture is malformed", async () => {
    const malformed = [{ id: "bad", value: "not-a-number" } as unknown as MetricFixture];
    await expect(createMetricSource(malformed).collect(ctx)).rejects.toThrow(CollectorError);
    try {
      await createMetricSource(malformed).collect(ctx);
      expect.unreachable("expected CollectorError");
    } catch (error) {
      expect(error).toBeInstanceOf(CollectorError);
      expect((error as CollectorError).kind).toBe("metrics");
    }
  });

  it("produces a card referencing the p95 threshold crossing", async () => {
    const cards = await createMetricSource().collect(ctx);
    expect(cards.some((c) => c.claim.includes("p95") && c.claim.includes("3000"))).toBe(true);
  });

  it("identifies the first crossing point (3120ms), not just the peak (3480ms)", async () => {
    const cards = await createMetricSource().collect(ctx);
    expect(cards.some((c) => c.claim.includes("3120"))).toBe(true);
  });
});

describe("createDeploySource", () => {
  it("returns cards whose source is 'deploys'", async () => {
    const cards = await createDeploySource([validDeploy()]).collect(ctx);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.source).toBe("deploys");
  });

  it("returns cards that all pass evidenceCardSchema", async () => {
    const cards = await createDeploySource([validDeploy(), validDeploy({ id: "d-y", risky: false })]).collect(ctx);
    for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
  });

  it("stamps collectedAt from the injected now(), never a real clock", async () => {
    const distantPast = "1999-01-01T00:00:00.000Z";
    const cards = await createDeploySource([validDeploy()]).collect({ ...ctx, now: () => distantPast });
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.collectedAt).toBe(distantPast);
  });

  it("yields [] for an empty fixture array and never throws", async () => {
    const cards = await createDeploySource([]).collect(ctx);
    expect(cards).toEqual([]);
  });

  it("throws CollectorError naming the source when a fixture is malformed", async () => {
    const malformed = [{ id: "bad", commit: 42 } as unknown as DeployFixture];
    await expect(createDeploySource(malformed).collect(ctx)).rejects.toThrow(CollectorError);
    try {
      await createDeploySource(malformed).collect(ctx);
      expect.unreachable("expected CollectorError");
    } catch (error) {
      expect(error).toBeInstanceOf(CollectorError);
      expect((error as CollectorError).kind).toBe("deploys");
    }
  });

  it("identifies 8f31c2b as the suspect commit", async () => {
    const cards = await createDeploySource().collect(ctx);
    expect(cards.some((c) => c.claim.includes("8f31c2b"))).toBe(true);
  });

  it("picks the most recent RISKY deploy, not just the most recent deploy overall (1204abf is later but not risky)", async () => {
    const cards = await createDeploySource().collect(ctx);
    const summary = cards.find((c) => c.claim.includes("Most recent risky"));
    expect(summary).toBeDefined();
    expect(summary?.claim.includes("1204abf")).toBe(false);
  });
});

describe("ALL_SOURCES", () => {
  it("contains exactly one source per kind: logs, metrics, deploys", () => {
    expect(ALL_SOURCES.map((s) => s.kind).sort()).toEqual(["deploys", "logs", "metrics"]);
  });

  it("every source's default collect() run passes evidenceCardSchema", async () => {
    for (const source of ALL_SOURCES) {
      const cards = await source.collect(ctx);
      for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
    }
  });
});
