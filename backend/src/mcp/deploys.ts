import { z } from "zod";
import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";
import { CollectorError, type CollectContext, type EvidenceSource } from "./source";
import defaultDeployFixtures from "../../../testing/fixtures/checkout-incident/deploys.json";

const SOURCE_KIND: EvidenceSourceKind = "deploys";

export const deployFixtureSchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/, "commit must be a lowercase hex SHA"),
  deployedAt: z.iso.datetime(),
  author: z.string().min(1),
  message: z.string().min(1),
  risky: z.boolean()
});
export type DeployFixture = z.infer<typeof deployFixtureSchema>;

function parseFixtures(fixtures: readonly unknown[]): DeployFixture[] {
  return fixtures.map((raw, index) => {
    const result = deployFixtureSchema.safeParse(raw);
    if (!result.success) {
      throw new CollectorError(SOURCE_KIND, `deploys fixture at index ${index} is malformed: ${result.error.message}`);
    }
    return result.data;
  });
}

function toEntryCard(entry: DeployFixture, ctx: CollectContext): EvidenceCard {
  return {
    id: `${ctx.incidentId}-deploys-${entry.id}`,
    source: SOURCE_KIND,
    claim: `${entry.commit} deployed to ${entry.service} at ${entry.deployedAt} by ${entry.author}: "${entry.message}"`,
    raw: entry,
    collectedAt: ctx.now(),
    confidence: "medium"
  };
}

/**
 * Identifies the most recent deploy flagged risky for the incident's
 * service — the prime rollback suspect. Deliberately ignores deploys that
 * are merely more recent but not risky, since a safe deploy shipped after
 * the risky one doesn't clear it as a suspect.
 */
function toSuspectCard(entries: readonly DeployFixture[], ctx: CollectContext): EvidenceCard | null {
  const risky = entries
    .filter((entry) => entry.service === ctx.service && entry.risky)
    .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));

  const mostRecentRisky = risky[0];
  if (!mostRecentRisky) return null;

  return {
    id: `${ctx.incidentId}-deploys-suspect`,
    source: SOURCE_KIND,
    claim: `Most recent risky deploy to ${ctx.service} is ${mostRecentRisky.commit} ("${mostRecentRisky.message}") by ${mostRecentRisky.author} at ${mostRecentRisky.deployedAt}`,
    raw: mostRecentRisky,
    collectedAt: ctx.now(),
    confidence: "high"
  };
}

export function createDeploySource(fixtures: readonly unknown[] = defaultDeployFixtures): EvidenceSource {
  return {
    kind: SOURCE_KIND,
    async collect(ctx: CollectContext): Promise<EvidenceCard[]> {
      const parsed = parseFixtures(fixtures);
      const scoped = parsed.filter((entry) => entry.service === ctx.service);
      const entryCards = scoped.map((entry) => toEntryCard(entry, ctx));
      const suspectCard = toSuspectCard(scoped, ctx);
      return suspectCard ? [...entryCards, suspectCard] : entryCards;
    }
  };
}
