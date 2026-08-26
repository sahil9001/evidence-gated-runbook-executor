"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Confidence, EvidenceCard, EvidencePacket, EvidenceSourceKind, RunFailure } from "../../../../../lib/types";
import { formatTimestamp } from "../shared";

const SOURCE_ORDER: readonly EvidenceSourceKind[] = ["logs", "metrics", "deploys", "sandbox"];
const SOURCE_LABELS: Readonly<Record<EvidenceSourceKind, string>> = {
  logs: "Logs",
  metrics: "Metrics",
  deploys: "Deploys",
  sandbox: "Sandbox"
};

interface FailuresBannerProps {
  readonly failures: readonly RunFailure[];
}

/**
 * The most important detail on this tab: a packet missing one of its
 * runbook-allowed sources looks perfectly well-formed otherwise (confidence
 * doesn't move for a source that never contributed a card), so this is the
 * only signal that tells an operator the evidence in front of them is
 * partial rather than complete.
 */
function FailuresBanner({ failures }: FailuresBannerProps) {
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" strokeWidth={2} aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-rose-800">
          This packet is incomplete — {failures.length} evidence {failures.length === 1 ? "source" : "sources"} never
          arrived.
        </p>
        <ul className="mt-2 space-y-1 text-xs text-rose-700">
          {failures.map((failure) => (
            <li key={failure.source}>
              <span className="font-semibold">{failure.source}:</span> {failure.message}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface EvidenceCardRowProps {
  readonly card: EvidenceCard;
}

function EvidenceCardRow({ card }: EvidenceCardRowProps) {
  const [expanded, setExpanded] = useState(false);
  const rawId = `raw-${card.id}`;

  return (
    <li className="rounded-2xl border border-neutral-100 bg-white p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={rawId}
        className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <div>
          <p className="text-sm font-semibold text-ink">{card.claim}</p>
          <p className="mt-1 text-xs text-neutral-500">
            Confidence: {card.confidence} · Collected {formatTimestamp(card.collectedAt)}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-signal">
          {expanded ? "Hide raw" : "Show raw"}
        </span>
      </button>
      {expanded ? (
        <pre
          id={rawId}
          className="mt-3 overflow-x-auto rounded-xl bg-panel p-3 text-[11px] leading-relaxed text-neutral-700"
        >
          {JSON.stringify(card.raw, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

interface SourceGroupProps {
  readonly source: EvidenceSourceKind;
  readonly cards: readonly EvidenceCard[];
}

function SourceGroup({ source, cards }: SourceGroupProps) {
  if (cards.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{SOURCE_LABELS[source]}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {cards.map((card) => (
          <EvidenceCardRow key={card.id} card={card} />
        ))}
      </ul>
    </div>
  );
}

interface EvidenceTabProps {
  readonly packet: EvidencePacket | null;
  readonly failures: readonly RunFailure[];
  readonly confidence: Confidence | null;
}

export function EvidenceTab({ packet, failures, confidence }: EvidenceTabProps) {
  const cards = packet?.cards ?? [];

  return (
    <div className="flex flex-col gap-4">
      <FailuresBanner failures={failures} />

      <section className="rounded-2xl bg-white p-5">
        <p className="text-sm font-semibold text-signal">Packet summary</p>
        <p className="mt-1 text-sm text-neutral-700">
          {packet?.summary ?? "No evidence has been collected for this run yet."}
        </p>
        <p className="mt-2 text-xs font-medium text-neutral-500">Confidence: {confidence ?? "not available"}</p>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-2xl bg-panel px-4 py-6 text-center text-sm font-medium text-neutral-500">
          No evidence cards yet.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {SOURCE_ORDER.map((source) => (
            <SourceGroup key={source} source={source} cards={cards.filter((card) => card.source === source)} />
          ))}
        </div>
      )}
    </div>
  );
}
