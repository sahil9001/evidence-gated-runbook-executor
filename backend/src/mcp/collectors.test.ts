import { describe, it, expect } from "vitest";
import { evidenceCardSchema } from "../domain/evidence";
import { CollectorError, type CollectContext } from "./source";
import { createLogSource, type LogFixture } from "./logs";
import { createMetricSource, type MetricFixture } from "./metrics";
import { createDeploySource, type DeployFixture } from "./deploys";
import { ALL_SOURCES } from "./index";
import { createSandboxSource, parseDiagnosticOutput, type SandboxFixture } from "./sandbox";
import { loadRunbook } from "../domain/runbook";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

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

  it("never emits an entry card for a log line belonging to a different service", async () => {
    const cards = await createLogSource([
      validLog(),
      validLog({ id: "log-other", service: "other-service", message: "unrelated failure" })
    ]).collect(ctx);
    expect(cards.some((c) => c.id.includes("log-other"))).toBe(false);
    expect(cards.some((c) => c.claim.includes("other-service"))).toBe(false);
    expect(cards.some((c) => JSON.stringify(c.raw).includes("other-service"))).toBe(false);
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

  it("never emits an entry card for a metric point belonging to a different service", async () => {
    const cards = await createMetricSource([
      validMetric(),
      validMetric({ id: "m-other", service: "other-service", value: 9999 })
    ]).collect(ctx);
    expect(cards.some((c) => c.id.includes("m-other"))).toBe(false);
    expect(cards.some((c) => c.claim.includes("other-service"))).toBe(false);
    expect(cards.some((c) => JSON.stringify(c.raw).includes("other-service"))).toBe(false);
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

  it("never emits an entry card for a deploy belonging to a different service", async () => {
    const cards = await createDeploySource([
      validDeploy(),
      validDeploy({ id: "d-other", service: "other-service", commit: "deadbee", risky: true })
    ]).collect(ctx);
    expect(cards.some((c) => c.id.includes("d-other"))).toBe(false);
    expect(cards.some((c) => JSON.stringify(c.raw).includes("other-service"))).toBe(false);
  });
});

describe("ALL_SOURCES", () => {
  it("contains exactly one source per kind: logs, metrics, deploys, sandbox", () => {
    expect(ALL_SOURCES.map((s) => s.kind).sort()).toEqual(["deploys", "logs", "metrics", "sandbox"]);
  });

  it("covers every source the shipped runbook authorises", async () => {
    // The gap this collector closed: `checkout-failure` has always listed
    // `sandbox` in allowedSources with nothing to collect it, so every packet
    // was permanently missing a promised source. A runbook that authorises a
    // source no collector provides is a contract the system cannot keep.
    const runbook = loadRunbook(checkoutFailureRaw);
    const collectable = new Set(ALL_SOURCES.map((source) => source.kind));

    for (const allowed of runbook.allowedSources) {
      expect(collectable.has(allowed)).toBe(true);
    }
  });

  it("every source's default collect() run passes evidenceCardSchema", async () => {
    for (const source of ALL_SOURCES) {
      const cards = await source.collect(ctx);
      for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
    }
  });
});

const validSandbox = (over: Partial<SandboxFixture> = {}): SandboxFixture => ({
  id: "sb-x",
  service: "payment-service",
  runbookId: "checkout-failure",
  recordedAt: "2026-08-25T02:04:00.000Z",
  exitCode: 0,
  stdout: "timeout_ms=3000\nfailed_requests=47\nlikely_commit=8f31c2b\nrecommendation=rollback\n",
  ...over
});

describe("createSandboxSource", () => {
  it("emits a reproduction card and a separate recommendation card", async () => {
    const cards = await createSandboxSource([validSandbox()]).collect(ctx);

    expect(cards).toHaveLength(2);
    expect(cards[0]?.claim).toMatch(/reproduced the payment-service timeout/i);
    expect(cards[0]?.claim).toMatch(/47 failed requests against a 3000ms threshold/i);
    // Split on purpose: a reviewer can accept the measurement and still
    // disagree with what it implies.
    expect(cards[1]?.claim).toMatch(/points at 8f31c2b and recommends rollback/i);
    for (const card of cards) expect(() => evidenceCardSchema.parse(card)).not.toThrow();
  });

  it("never presents a recommendation as authorisation", async () => {
    const cards = await createSandboxSource([validSandbox()]).collect(ctx);

    expect(cards[1]?.claim).toMatch(/still gated on approval/i);
    expect((cards[1]?.raw as { requiresApproval: boolean }).requiresApproval).toBe(true);
  });

  it("reports 'no candidate' honestly rather than inventing one", async () => {
    const cards = await createSandboxSource([
      validSandbox({
        stdout: "timeout_ms=3000\nfailed_requests=47\nlikely_commit=unknown\nrecommendation=none\n"
      })
    ]).collect(ctx);

    expect(cards[1]?.claim).toMatch(/found no rollback candidate/i);
    expect(cards[1]?.confidence).toBe("low");
  });

  it("scopes recordings to the incident's service", async () => {
    const cards = await createSandboxSource([validSandbox({ service: "billing-service" })]).collect(ctx);

    expect(cards).toEqual([]);
  });

  it("refuses to trust output from a diagnostic that did not exit cleanly", async () => {
    await expect(createSandboxSource([validSandbox({ exitCode: 2 })]).collect(ctx)).rejects.toThrow(
      /exited 2/i
    );
  });

  it("rejects a malformed recording rather than attaching an unreadable card", async () => {
    await expect(createSandboxSource([{ id: "sb-bad" }]).collect(ctx)).rejects.toThrow(
      CollectorError
    );
  });
});

describe("parseDiagnosticOutput", () => {
  it("parses the four key=value lines the runbook promises", () => {
    expect(
      parseDiagnosticOutput(
        "timeout_ms=3000\nfailed_requests=47\nlikely_commit=8f31c2b\nrecommendation=rollback\n",
        "sb-x"
      )
    ).toEqual({
      timeout_ms: 3000,
      failed_requests: 47,
      likely_commit: "8f31c2b",
      recommendation: "rollback"
    });
  });

  it("names every missing key rather than failing on the first", () => {
    expect(() => parseDiagnosticOutput("timeout_ms=3000\n", "sb-x")).toThrow(
      /failed_requests, likely_commit, recommendation/
    );
  });

  it("rejects a line that is not key=value", () => {
    expect(() => parseDiagnosticOutput("Traceback (most recent call last):", "sb-x")).toThrow(
      /not key=value/i
    );
  });

  it("rejects a recommendation outside the contract's enum", () => {
    expect(() =>
      parseDiagnosticOutput(
        "timeout_ms=3000\nfailed_requests=47\nlikely_commit=8f31c2b\nrecommendation=just_do_it\n",
        "sb-x"
      )
    ).toThrow(/does not match the runbook/i);
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(
      parseDiagnosticOutput(
        "\n  timeout_ms = 3000  \n\nfailed_requests=47\nlikely_commit=8f31c2b\nrecommendation=rollback\n\n",
        "sb-x"
      ).timeout_ms
    ).toBe(3000);
  });
});
