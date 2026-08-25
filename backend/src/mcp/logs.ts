import { z } from "zod";
import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";
import { CollectorError, type CollectContext, type EvidenceSource } from "./source";
import defaultLogFixtures from "../../../testing/fixtures/checkout-incident/logs.json";

const SOURCE_KIND: EvidenceSourceKind = "logs";

export const logFixtureSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  level: z.enum(["error", "warn", "info"]),
  message: z.string().min(1),
  occurrenceCount: z.number().int().positive(),
  kind: z.enum(["timeout", "other"]),
  timestamp: z.iso.datetime()
});
export type LogFixture = z.infer<typeof logFixtureSchema>;

function parseFixtures(fixtures: readonly unknown[]): LogFixture[] {
  return fixtures.map((raw, index) => {
    const result = logFixtureSchema.safeParse(raw);
    if (!result.success) {
      throw new CollectorError(SOURCE_KIND, `logs fixture at index ${index} is malformed: ${result.error.message}`);
    }
    return result.data;
  });
}

function toEntryCard(entry: LogFixture, ctx: CollectContext): EvidenceCard {
  return {
    id: `${ctx.incidentId}-logs-${entry.id}`,
    source: SOURCE_KIND,
    claim: `${entry.occurrenceCount} occurrences of "${entry.message}" on ${entry.service}`,
    raw: entry,
    collectedAt: ctx.now(),
    confidence: entry.kind === "timeout" ? "high" : "medium"
  };
}

/**
 * Rolls the individual log lines up into one claim about total failed
 * requests for the incident's service — the number the runbook actually
 * cites when deciding whether to act. Only timeout-kind entries for the
 * incident's service count toward the total; unrelated warnings do not
 * inflate it.
 */
function toSummaryCard(entries: readonly LogFixture[], ctx: CollectContext): EvidenceCard | null {
  const matching = entries.filter((entry) => entry.service === ctx.service && entry.kind === "timeout");
  if (matching.length === 0) return null;

  const total = matching.reduce((sum, entry) => sum + entry.occurrenceCount, 0);
  return {
    id: `${ctx.incidentId}-logs-summary`,
    source: SOURCE_KIND,
    claim: `${total} requests to ${ctx.service} failed with timeout errors`,
    raw: { matchingEntryIds: matching.map((entry) => entry.id), total },
    collectedAt: ctx.now(),
    confidence: "high"
  };
}

export function createLogSource(fixtures: readonly unknown[] = defaultLogFixtures): EvidenceSource {
  return {
    kind: SOURCE_KIND,
    async collect(ctx: CollectContext): Promise<EvidenceCard[]> {
      const parsed = parseFixtures(fixtures);
      const entryCards = parsed.map((entry) => toEntryCard(entry, ctx));
      const summaryCard = toSummaryCard(parsed, ctx);
      return summaryCard ? [...entryCards, summaryCard] : entryCards;
    }
  };
}
