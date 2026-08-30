import { buildPacket, evidenceCardSchema, type EvidenceCard, type EvidencePacket, type EvidenceSourceKind } from "./evidence";
import type { Runbook } from "./runbook";
import { CollectorError, type CollectContext, type EvidenceSource } from "../mcp/source";

/**
 * Thrown when `collectEvidence` is asked to run a source whose kind is not
 * in the runbook's `allowedSources`. The runbook's allowed-sources list is
 * a scope constraint, not a hint: this error is thrown before any collector
 * runs, so an unauthorized source's `collect()` is never invoked.
 */
export class ScopeViolationError extends Error {
  readonly attempted: EvidenceSourceKind;
  readonly allowed: EvidenceSourceKind[];

  constructor(attempted: EvidenceSourceKind, allowed: readonly EvidenceSourceKind[]) {
    super(`Evidence source "${attempted}" is outside this runbook's allowedSources: [${allowed.join(", ")}]`);
    this.name = "ScopeViolationError";
    this.attempted = attempted;
    this.allowed = [...allowed];
  }
}

function assertInScope(sources: readonly EvidenceSource[], allowed: readonly EvidenceSourceKind[]): void {
  for (const source of sources) {
    if (!allowed.includes(source.kind)) {
      throw new ScopeViolationError(source.kind, allowed);
    }
  }
}

/**
 * Always attributes a collector failure to the collector that actually
 * threw. An incoming `CollectorError` is trusted only when its own `kind`
 * already matches — otherwise (a collector-authored error mislabelled with
 * someone else's kind, or a validation failure raised by
 * `validateCollectorCards`, whose `kind` is always trustworthy already) it
 * is re-wrapped under the correct `kind`, preserving the original as
 * `cause` so nothing is lost.
 */
function toCollectorError(reason: unknown, kind: EvidenceSourceKind): CollectorError {
  if (reason instanceof CollectorError) {
    if (reason.kind === kind) return reason;
    return new CollectorError(kind, reason.message, { cause: reason });
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  return new CollectorError(kind, message, { cause: reason });
}

/**
 * Validates one collector's cards before they are allowed into the packet:
 * every card must satisfy `evidenceCardSchema`, and every card's `source`
 * must equal the collector's own declared `kind`. Either violation throws a
 * `CollectorError` for that source, which `collectEvidence`'s
 * `Promise.allSettled` turns into a per-source failure — dropping only that
 * collector's cards — rather than a schema error at whole-packet build time
 * that would abort the entire call.
 *
 * `assertInScope` constrains which collectors are allowed to RUN; this
 * constrains what a collector that DID run is allowed to claim it produced,
 * so a collector cannot smuggle cards labelled with a source outside the
 * runbook's scope past the check that only runs once, up front.
 */
function validateCollectorCards(cards: readonly EvidenceCard[], kind: EvidenceSourceKind): EvidenceCard[] {
  for (const card of cards) {
    const parsed = evidenceCardSchema.safeParse(card);
    if (!parsed.success) {
      throw new CollectorError(kind, `produced a card that fails evidenceCardSchema: ${parsed.error.message}`);
    }
    if (parsed.data.source !== kind) {
      throw new CollectorError(
        kind,
        `produced a card labelled source "${parsed.data.source}", but this collector's kind is "${kind}"`
      );
    }
  }
  return [...cards];
}

/**
 * Collects evidence for an incident, strictly within the bounds the
 * runbook authorizes.
 *
 * Scope is checked synchronously against every requested source before any
 * `collect()` call is made — an unauthorized source aborts the whole
 * request up front rather than being skipped mid-run. Authorized sources
 * then run concurrently, and one collector failing does not abort the
 * others: the resulting packet holds every card that could be gathered,
 * and `failures` names what could not, so the operator sees the gaps
 * instead of a silently incomplete packet.
 *
 * Each collector's own output is validated as it comes back
 * (`validateCollectorCards`): a card that fails `evidenceCardSchema`, or
 * that claims a `source` other than the collector's own `kind`, downgrades
 * that source to a failure — its cards are dropped and it is added to
 * `failures` — instead of either aborting the whole call (the schema error
 * used to surface only at whole-packet build time) or letting a
 * mislabelled card into the packet under a source it didn't come from.
 */
export async function collectEvidence(input: {
  runbook: Runbook;
  sources: readonly EvidenceSource[];
  incidentId: string;
  service: string;
  packetId: string;
  now: () => string;
}): Promise<{ packet: EvidencePacket; failures: CollectorError[] }> {
  assertInScope(input.sources, input.runbook.allowedSources);

  const ctx: CollectContext = {
    incidentId: input.incidentId,
    service: input.service,
    runbookId: input.runbook.id,
    now: input.now
  };

  const settled = await Promise.allSettled(
    input.sources.map(async (source) => {
      try {
        const cards = await source.collect(ctx);
        return validateCollectorCards(cards, source.kind);
      } catch (error) {
        throw toCollectorError(error, source.kind);
      }
    })
  );

  const cards: EvidenceCard[] = [];
  const failures: CollectorError[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      cards.push(...result.value);
    } else {
      failures.push(result.reason as CollectorError);
    }
  }

  const packet = buildPacket({
    id: input.packetId,
    incidentId: input.incidentId,
    runbookId: input.runbook.id,
    cards,
    builtAt: input.now()
  });

  return { packet, failures };
}
