import { buildPacket, type EvidenceCard, type EvidencePacket, type EvidenceSourceKind } from "./evidence";
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

function toCollectorError(reason: unknown, kind: EvidenceSourceKind): CollectorError {
  if (reason instanceof CollectorError) return reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  return new CollectorError(kind, message, { cause: reason });
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

  const ctx: CollectContext = { incidentId: input.incidentId, service: input.service, now: input.now };

  const settled = await Promise.allSettled(
    input.sources.map(async (source) => {
      try {
        return await source.collect(ctx);
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
