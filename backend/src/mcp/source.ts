import type { EvidenceCard, EvidenceSourceKind } from "../domain/evidence";

/**
 * Everything a collector needs to gather evidence for one incident. `now`
 * is injected rather than read from the system clock so collectors stay
 * pure and their output is deterministic in tests.
 */
export type CollectContext = {
  incidentId: string;
  service: string;
  /**
   * The runbook this collection is running under. Collectors whose records
   * declare which runbook produced them (the sandbox recordings do) must
   * match on it as well as on service: the packet is labelled with this
   * runbook's id, so attaching a record made under a different one would
   * present unrelated output as this runbook's evidence.
   */
  runbookId: string;
  now: () => string;
};

/**
 * A source of evidence cards. Fixture-backed implementations in this slice
 * satisfy the same async, throwing shape a real HTTP-backed implementation
 * would need — pagination, rate limits, and outages are all failure modes
 * `collect` must be able to surface via `CollectorError`.
 */
export interface EvidenceSource {
  readonly kind: EvidenceSourceKind;
  collect(ctx: CollectContext): Promise<EvidenceCard[]>;
}

/**
 * Thrown when a collector cannot produce evidence — a malformed fixture
 * today, a failed HTTP call or exhausted retry budget once collectors talk
 * to real systems. Always names the offending source's kind so a caller
 * juggling multiple collectors can tell which one failed without parsing
 * the message.
 */
export class CollectorError extends Error {
  readonly kind: EvidenceSourceKind;

  constructor(kind: EvidenceSourceKind, message: string, options?: { cause?: unknown }) {
    super(`[${kind}] ${message}`, options);
    this.name = "CollectorError";
    this.kind = kind;
  }
}
