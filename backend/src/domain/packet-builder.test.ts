import { describe, it, expect, vi } from "vitest";
import { collectEvidence, ScopeViolationError } from "./packet-builder";
import { loadRunbook, type Runbook } from "./runbook";
import type { EvidenceCard, EvidenceSourceKind } from "./evidence";
import { CollectorError, type CollectContext, type EvidenceSource } from "../mcp/source";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

const T0 = "2026-08-25T02:00:00.000Z";

const checkoutRunbook: Runbook = loadRunbook(checkoutFailureRaw);

const withAllowedSources = (allowedSources: EvidenceSourceKind[]): Runbook => ({
  ...checkoutRunbook,
  allowedSources
});

const makeCard = (kind: EvidenceSourceKind, id: string, collectedAt: string): EvidenceCard => ({
  id,
  source: kind,
  claim: `${kind} claim from ${id}`,
  raw: {},
  collectedAt,
  confidence: "medium"
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const baseInput = {
  incidentId: "inc-checkout-1",
  service: "payment-service",
  packetId: "packet-1",
  now: () => T0
};

describe("collectEvidence — scope enforcement", () => {
  it("refuses a source the runbook did not authorize", async () => {
    const runbook = withAllowedSources(["logs"]);
    const rogue: EvidenceSource = {
      kind: "sandbox",
      collect: async () => {
        throw new Error("should never run");
      }
    };

    await expect(collectEvidence({ ...baseInput, runbook, sources: [rogue] })).rejects.toThrow(ScopeViolationError);
  });

  it("never invokes any collector's collect when an unauthorized source is present, including authorized ones in the same batch", async () => {
    const runbook = withAllowedSources(["logs"]);

    const rogueSpy = vi.fn(async () => {
      throw new Error("should never run");
    });
    const rogue: EvidenceSource = { kind: "sandbox", collect: rogueSpy };

    const logSpy = vi.fn(async (ctx: CollectContext) => [makeCard("logs", "log-1", ctx.now())]);
    const logSource: EvidenceSource = { kind: "logs", collect: logSpy };

    await collectEvidence({ ...baseInput, runbook, sources: [logSource, rogue] }).catch(() => {
      // scope violation is asserted separately; here we only care that nothing ran
    });

    expect(rogueSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("ScopeViolationError carries the attempted kind and the full allowed list", async () => {
    const runbook = withAllowedSources(["logs", "metrics"]);
    const rogue: EvidenceSource = { kind: "sandbox", collect: vi.fn() };

    try {
      await collectEvidence({ ...baseInput, runbook, sources: [rogue] });
      expect.unreachable("expected collectEvidence to throw ScopeViolationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeViolationError);
      const scopeError = error as ScopeViolationError;
      expect(scopeError.attempted).toBe("sandbox");
      expect(scopeError.allowed).toEqual(["logs", "metrics"]);
    }
  });
});

describe("collectEvidence — collection and partial results", () => {
  it("runs every authorized source and includes all their cards in the packet", async () => {
    const runbook = withAllowedSources(["logs", "metrics", "deploys"]);

    const logSource: EvidenceSource = { kind: "logs", collect: async (ctx) => [makeCard("logs", "log-1", ctx.now())] };
    const metricSource: EvidenceSource = {
      kind: "metrics",
      collect: async (ctx) => [makeCard("metrics", "metric-1", ctx.now())]
    };
    const deploySource: EvidenceSource = {
      kind: "deploys",
      collect: async (ctx) => [makeCard("deploys", "deploy-1", ctx.now())]
    };

    const { packet, failures } = await collectEvidence({
      ...baseInput,
      runbook,
      sources: [logSource, metricSource, deploySource]
    });

    expect(failures).toEqual([]);
    expect(packet.cards.map((card) => card.id).sort()).toEqual(["deploy-1", "log-1", "metric-1"]);
    expect(packet.id).toBe("packet-1");
    expect(packet.incidentId).toBe("inc-checkout-1");
    expect(packet.runbookId).toBe(runbook.id);
  });

  it("yields a partial packet plus one failures entry when one collector throws, without dropping the others' cards", async () => {
    const runbook = withAllowedSources(["logs", "metrics"]);

    const logSource: EvidenceSource = { kind: "logs", collect: async (ctx) => [makeCard("logs", "log-1", ctx.now())] };
    const failingMetric: EvidenceSource = {
      kind: "metrics",
      collect: async () => {
        throw new CollectorError("metrics", "upstream unavailable");
      }
    };

    const { packet, failures } = await collectEvidence({
      ...baseInput,
      runbook,
      sources: [logSource, failingMetric]
    });

    expect(packet.cards.map((card) => card.id)).toEqual(["log-1"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(CollectorError);
    expect(failures[0]?.kind).toBe("metrics");
  });

  it("wraps a non-CollectorError throw from a collector into a CollectorError naming that source's kind", async () => {
    const runbook = withAllowedSources(["logs"]);
    const explodingLog: EvidenceSource = {
      kind: "logs",
      collect: async () => {
        throw new Error("fixture file missing");
      }
    };

    const { packet, failures } = await collectEvidence({ ...baseInput, runbook, sources: [explodingLog] });

    expect(packet.cards).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(CollectorError);
    expect(failures[0]?.kind).toBe("logs");
  });

  it("runs collectors in parallel, not in series", async () => {
    const DELAY_MS = 50;
    const runbook = withAllowedSources(["logs", "metrics"]);

    const slowLog: EvidenceSource = {
      kind: "logs",
      collect: async (ctx) => {
        await delay(DELAY_MS);
        return [makeCard("logs", "log-1", ctx.now())];
      }
    };
    const slowMetric: EvidenceSource = {
      kind: "metrics",
      collect: async (ctx) => {
        await delay(DELAY_MS);
        return [makeCard("metrics", "metric-1", ctx.now())];
      }
    };

    const start = Date.now();
    await collectEvidence({ ...baseInput, runbook, sources: [slowLog, slowMetric] });
    const elapsed = Date.now() - start;

    // Serial execution would take ~2 * DELAY_MS; parallel stays close to one delay.
    expect(elapsed).toBeLessThan(DELAY_MS * 1.6);
  });

  it("stamps every card's collectedAt from the injected now(), never a real clock", async () => {
    const runbook = withAllowedSources(["logs"]);
    const FIXED = "2030-01-01T00:00:00.000Z";
    const logSource: EvidenceSource = { kind: "logs", collect: async (ctx) => [makeCard("logs", "log-1", ctx.now())] };

    const { packet } = await collectEvidence({ ...baseInput, runbook, sources: [logSource], now: () => FIXED });

    expect(packet.cards.length).toBeGreaterThan(0);
    for (const card of packet.cards) expect(card.collectedAt).toBe(FIXED);
  });
});

describe("collectEvidence — per-collector card validation", () => {
  it("treats a collector returning a malformed card as a failure for that source, yielding a partial packet and preserving the other collectors' cards", async () => {
    const runbook = withAllowedSources(["logs", "metrics"]);

    const logSource: EvidenceSource = { kind: "logs", collect: async (ctx) => [makeCard("logs", "log-1", ctx.now())] };
    const malformedMetric: EvidenceSource = {
      kind: "metrics",
      collect: async () =>
        [{ id: "", source: "metrics", claim: "bad card", raw: {}, collectedAt: "not-a-date", confidence: "high" }] as EvidenceCard[]
    };

    const { packet, failures } = await collectEvidence({ ...baseInput, runbook, sources: [logSource, malformedMetric] });

    expect(packet.cards.map((card) => card.id)).toEqual(["log-1"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(CollectorError);
    expect(failures[0]?.kind).toBe("metrics");
  });

  it("does not abort the whole call when one collector's card fails schema validation", async () => {
    const runbook = withAllowedSources(["logs"]);
    const malformedLog: EvidenceSource = {
      kind: "logs",
      collect: async () => [{ id: "log-bad", source: "logs", claim: "", raw: {}, collectedAt: "2026-08-25T02:00:00.000Z", confidence: "high" }] as EvidenceCard[]
    };

    // Before the fix, an invalid card slipped through per-collector and was
    // only ever caught by evidencePacketSchema.parse inside buildPacket,
    // which throws and aborts collectEvidence entirely instead of
    // producing the promised partial packet + failures.
    await expect(collectEvidence({ ...baseInput, runbook, sources: [malformedLog] })).resolves.toEqual(
      expect.objectContaining({ failures: expect.arrayContaining([expect.any(CollectorError)]) })
    );
  });

  it("rejects a collector's cards labelled with another source, reporting a failure and keeping them out of the packet", async () => {
    const runbook = withAllowedSources(["logs", "metrics"]);

    const logSource: EvidenceSource = { kind: "logs", collect: async (ctx) => [makeCard("logs", "log-1", ctx.now())] };
    // This collector is authorized as "metrics" but claims its cards came
    // from "deploys" — a source-mismatch, not a scope violation.
    const mislabeledMetric: EvidenceSource = {
      kind: "metrics",
      collect: async (ctx) => [makeCard("deploys", "sneaky-1", ctx.now())]
    };

    const { packet, failures } = await collectEvidence({ ...baseInput, runbook, sources: [logSource, mislabeledMetric] });

    expect(packet.cards.map((card) => card.id)).toEqual(["log-1"]);
    expect(packet.cards.some((card) => card.id === "sneaky-1")).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(CollectorError);
    expect(failures[0]?.kind).toBe("metrics");
  });
});

describe("collectEvidence — failure attribution", () => {
  it("attributes a re-thrown CollectorError to the collector that actually threw it, not the label it carried", async () => {
    const runbook = withAllowedSources(["logs", "metrics"]);
    const mislabeledError = new CollectorError("deploys", "upstream exploded");
    const logSource: EvidenceSource = {
      kind: "logs",
      collect: async () => {
        throw mislabeledError;
      }
    };
    const metricSource: EvidenceSource = { kind: "metrics", collect: async (ctx) => [makeCard("metrics", "metric-1", ctx.now())] };

    const { packet, failures } = await collectEvidence({ ...baseInput, runbook, sources: [logSource, metricSource] });

    expect(packet.cards.map((card) => card.id)).toEqual(["metric-1"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(CollectorError);
    expect(failures[0]?.kind).toBe("logs");
    expect(failures[0]?.cause).toBe(mislabeledError);
  });
});
