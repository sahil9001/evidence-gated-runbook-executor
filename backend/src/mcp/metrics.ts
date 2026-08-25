import { z } from "zod";
import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";
import { CollectorError, type CollectContext, type EvidenceSource } from "./source";
import defaultMetricFixtures from "../../../testing/fixtures/checkout-incident/metrics.json";

const SOURCE_KIND: EvidenceSourceKind = "metrics";
const P95_LATENCY_METRIC = "latency_p95_ms";
const P95_THRESHOLD_MS = 3000;

export const metricFixtureSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  metric: z.string().min(1),
  timestamp: z.iso.datetime(),
  value: z.number().nonnegative()
});
export type MetricFixture = z.infer<typeof metricFixtureSchema>;

function parseFixtures(fixtures: readonly unknown[]): MetricFixture[] {
  return fixtures.map((raw, index) => {
    const result = metricFixtureSchema.safeParse(raw);
    if (!result.success) {
      throw new CollectorError(SOURCE_KIND, `metrics fixture at index ${index} is malformed: ${result.error.message}`);
    }
    return result.data;
  });
}

function toPointCard(point: MetricFixture, ctx: CollectContext): EvidenceCard {
  return {
    id: `${ctx.incidentId}-metrics-${point.id}`,
    source: SOURCE_KIND,
    claim: `${point.metric} on ${point.service} was ${point.value}ms at ${point.timestamp}`,
    raw: point,
    collectedAt: ctx.now(),
    confidence: "medium"
  };
}

/**
 * Finds the first p95 latency reading for the incident's service that
 * crosses the alerting threshold, and the peak reached afterward. Points
 * are sorted chronologically first so fixture ordering never matters.
 */
function toThresholdCard(points: readonly MetricFixture[], ctx: CollectContext): EvidenceCard | null {
  const series = [...points]
    .filter((point) => point.service === ctx.service && point.metric === P95_LATENCY_METRIC)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const crossing = series.find((point) => point.value >= P95_THRESHOLD_MS);
  if (!crossing) return null;

  const peak = series.reduce((max, point) => (point.value > max.value ? point : max), crossing);
  return {
    id: `${ctx.incidentId}-metrics-p95-threshold`,
    source: SOURCE_KIND,
    claim: `p95 latency on ${ctx.service} crossed the ${P95_THRESHOLD_MS}ms threshold at ${crossing.timestamp} (${crossing.value}ms), peaking at ${peak.value}ms`,
    raw: { crossing, peak },
    collectedAt: ctx.now(),
    confidence: "high"
  };
}

export function createMetricSource(fixtures: readonly unknown[] = defaultMetricFixtures): EvidenceSource {
  return {
    kind: SOURCE_KIND,
    async collect(ctx: CollectContext): Promise<EvidenceCard[]> {
      const parsed = parseFixtures(fixtures);
      const pointCards = parsed.map((point) => toPointCard(point, ctx));
      const thresholdCard = toThresholdCard(parsed, ctx);
      return thresholdCard ? [...pointCards, thresholdCard] : pointCards;
    }
  };
}
