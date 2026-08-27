import { describe, it, expect } from "vitest";
import { evidenceCardSchema, buildPacket, packetConfidence, missingSources, type EvidenceCard } from "./evidence";

const card = (over: Partial<EvidenceCard> = {}): EvidenceCard => ({
  id: "card-1",
  source: "logs",
  claim: "47 requests timed out on payment-service",
  raw: { lines: ["timeout"] },
  collectedAt: "2026-08-25T02:00:00.000Z",
  confidence: "high",
  ...over
});

describe("evidenceCardSchema", () => {
  it("accepts a well-formed card", () => {
    expect(evidenceCardSchema.parse(card())).toEqual(card());
  });

  it("rejects an unknown source", () => {
    expect(() => evidenceCardSchema.parse(card({ source: "guesswork" as never }))).toThrow();
  });

  it("rejects an empty claim, because a card with no claim proves nothing", () => {
    expect(() => evidenceCardSchema.parse(card({ claim: "" }))).toThrow();
  });
});

describe("buildPacket", () => {
  it("summarises how many cards came from how many sources", () => {
    const packet = buildPacket({
      id: "packet-1",
      incidentId: "inc-1",
      runbookId: "checkout-failure",
      cards: [card(), card({ id: "card-2", source: "deploys" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });

    expect(packet.summary).toBe("2 evidence cards from 2 sources: deploys, logs");
    expect(packet.cards).toHaveLength(2);
  });

  it("does not mutate the cards array it was given", () => {
    const cards = [card()];
    const packet = buildPacket({
      id: "packet-1", incidentId: "inc-1", runbookId: "checkout-failure",
      cards, builtAt: "2026-08-25T02:01:00.000Z"
    });
    packet.cards.push(card({ id: "card-9" }));
    expect(cards).toHaveLength(1);
  });

  it("describes an empty packet honestly", () => {
    const packet = buildPacket({
      id: "packet-1", incidentId: "inc-1", runbookId: "checkout-failure",
      cards: [], builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packet.summary).toBe("No evidence collected");
  });
});

describe("packetConfidence", () => {
  it("is only as strong as the weakest card", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r",
      cards: [card({ confidence: "high" }), card({ id: "c2", confidence: "low" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packetConfidence(packet)).toBe("low");
  });

  it("takes the weakest card regardless of its position", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r",
      cards: [card({ confidence: "low" }), card({ id: "c2", confidence: "high" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packetConfidence(packet)).toBe("low");
  });

  it("treats an empty packet as low confidence, never high", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r", cards: [],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(packetConfidence(packet)).toBe("low");
  });
});

describe("missingSources", () => {
  it("names an allowed source that produced no cards", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r",
      cards: [card({ source: "logs" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(missingSources(packet, ["logs", "metrics"])).toEqual(["metrics"]);
  });

  it("returns nothing when every allowed source has at least one card", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r",
      cards: [card({ source: "logs" }), card({ id: "c2", source: "metrics" })],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(missingSources(packet, ["logs", "metrics"])).toEqual([]);
  });

  it("returns every allowed source for an empty packet", () => {
    const packet = buildPacket({
      id: "p", incidentId: "i", runbookId: "r", cards: [],
      builtAt: "2026-08-25T02:01:00.000Z"
    });
    expect(missingSources(packet, ["logs", "deploys"])).toEqual(["logs", "deploys"]);
  });
});
