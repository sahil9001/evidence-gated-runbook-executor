import { z } from "zod";

export const evidenceSourceKindSchema = z.enum(["logs", "metrics", "deploys", "sandbox"]);
export type EvidenceSourceKind = z.infer<typeof evidenceSourceKindSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const evidenceCardSchema = z.object({
  id: z.string().min(1),
  source: evidenceSourceKindSchema,
  claim: z.string().min(1),
  raw: z.unknown(),
  collectedAt: z.iso.datetime(),
  confidence: confidenceSchema
});
export type EvidenceCard = z.infer<typeof evidenceCardSchema>;

export const evidencePacketSchema = z.object({
  id: z.string().min(1),
  incidentId: z.string().min(1),
  runbookId: z.string().min(1),
  cards: z.array(evidenceCardSchema),
  summary: z.string(),
  builtAt: z.iso.datetime()
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function summarise(cards: readonly EvidenceCard[]): string {
  if (cards.length === 0) return "No evidence collected";
  const sources = [...new Set(cards.map((c) => c.source))].sort();
  const noun = cards.length === 1 ? "card" : "cards";
  const srcNoun = sources.length === 1 ? "source" : "sources";
  return `${cards.length} evidence ${noun} from ${sources.length} ${srcNoun}: ${sources.join(", ")}`;
}

export function buildPacket(input: {
  id: string;
  incidentId: string;
  runbookId: string;
  cards: readonly EvidenceCard[];
  builtAt: string;
}): EvidencePacket {
  return evidencePacketSchema.parse({
    id: input.id,
    incidentId: input.incidentId,
    runbookId: input.runbookId,
    cards: [...input.cards],
    summary: summarise(input.cards),
    builtAt: input.builtAt
  });
}

export function packetConfidence(packet: EvidencePacket): Confidence {
  if (packet.cards.length === 0) return "low";
  return packet.cards.reduce<Confidence>(
    (weakest, card) => (CONFIDENCE_RANK[card.confidence] < CONFIDENCE_RANK[weakest] ? card.confidence : weakest),
    "high"
  );
}

/**
 * Names every source in `allowedSources` that produced zero cards in this
 * packet. Backs a run-detail view's `failures` field: an operator deciding
 * whether to trust a gate needs to see which authorized sources never came
 * back, not just the cards that did.
 */
export function missingSources(
  packet: EvidencePacket,
  allowedSources: readonly EvidenceSourceKind[]
): EvidenceSourceKind[] {
  const present = new Set(packet.cards.map((c) => c.source));
  return allowedSources.filter((kind) => !present.has(kind));
}
