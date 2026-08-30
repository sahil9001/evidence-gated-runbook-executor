"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Inbox } from "lucide-react";
import { EmptyState, Eyebrow } from "@/app/app/components/console/Surface";
import { Meter } from "@/app/app/components/console/Indicators";
import { cn } from "@/lib/utils";
import type { Confidence, EvidenceCard, EvidencePacket, EvidenceSourceKind, RunFailure } from "@/lib/types";
import {
  CONFIDENCE_PERCENT,
  CONFIDENCE_TONE,
  SOURCE_ICONS,
  SOURCE_LABELS,
  SOURCE_ORDER,
  formatTimestamp
} from "../shared";

interface FailuresBannerProps {
  readonly failures: readonly RunFailure[];
}

/**
 * The most important detail on this tab: a packet missing one of its
 * runbook-allowed sources looks perfectly well-formed otherwise (confidence
 * doesn't move for a source that never contributed a card), so this is the
 * only signal that tells an operator the evidence in front of them is
 * partial rather than complete. It leads the tab as a full-bleed rule, not a
 * dismissible-looking box.
 */
function FailuresBanner({ failures }: FailuresBannerProps) {
  if (failures.length === 0) return null;
  return (
    <div role="alert" className="flex items-start gap-3 border-l-2 border-rose-500 bg-rose-50/70 py-4 pl-4 pr-5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" strokeWidth={2.2} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-rose-800">
          This packet is incomplete — {failures.length} evidence {failures.length === 1 ? "source" : "sources"} never
          arrived.
        </p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-rose-700">
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

/** Confidence is a three-level enum: three segments read it faster than the
 * word alone, and stay legible next to a dense claim. */
function ConfidenceBars({ level }: { level: Confidence }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const tone = level === "high" ? "bg-emerald-500" : level === "medium" ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="mt-1 flex shrink-0 items-end gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "w-1 rounded-full",
            index === 0 ? "h-2" : index === 1 ? "h-3" : "h-4",
            index < filled ? tone : "bg-sky-100"
          )}
        />
      ))}
    </span>
  );
}

interface EvidenceCardRowProps {
  readonly card: EvidenceCard;
}

function EvidenceCardRow({ card }: EvidenceCardRowProps) {
  const [expanded, setExpanded] = useState(false);
  const rawId = `raw-${card.id}`;

  return (
    <li className="border-t border-sky-100 first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={rawId}
        className="group flex w-full items-start gap-3 py-4 text-left transition-colors hover:bg-sky-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <ConfidenceBars level={card.confidence} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium leading-6 text-ink">{card.claim}</span>
          <span className="mt-1 block text-xs text-neutral-500">
            {card.confidence} confidence · Collected {formatTimestamp(card.collectedAt)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap pt-0.5 text-xs font-semibold text-signal">
          {expanded ? "Hide raw" : "Show raw"}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        </span>
      </button>
      {expanded ? (
        <pre
          id={rawId}
          className="mb-4 overflow-x-auto rounded-lg bg-sky-50/70 p-3 text-[11px] leading-relaxed text-neutral-700"
        >
          {JSON.stringify(card.raw, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

interface SourceGroupProps {
  readonly cards: readonly EvidenceCard[];
  readonly failure: RunFailure | undefined;
  readonly source: EvidenceSourceKind;
}

/** A source the runbook allowed but that returned nothing still gets a group:
 * an absent heading would quietly hide the hole in the packet. */
function SourceGroup({ cards, failure, source }: SourceGroupProps) {
  if (cards.length === 0 && failure === undefined) return null;
  const Icon = SOURCE_ICONS[source];
  const isEmpty = cards.length === 0;

  return (
    <section>
      <div className="flex items-center gap-2 border-b border-sky-100 pb-2">
        <Icon
          className={cn("h-4 w-4 shrink-0", isEmpty ? "text-rose-500" : "text-signal")}
          strokeWidth={2}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold text-ink">{SOURCE_LABELS[source]}</h3>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            isEmpty ? "text-rose-600" : "text-neutral-400"
          )}
        >
          {cards.length}
        </span>
      </div>
      {isEmpty ? (
        <p className="py-4 text-sm text-rose-700">Nothing arrived from this source — the packet is incomplete here.</p>
      ) : (
        <ul>
          {cards.map((card) => (
            <EvidenceCardRow key={card.id} card={card} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface EvidenceTabProps {
  readonly confidence: Confidence | null;
  readonly failures: readonly RunFailure[];
  readonly packet: EvidencePacket | null;
}

export function EvidenceTab({ confidence, failures, packet }: EvidenceTabProps) {
  const cards = packet?.cards ?? [];
  const reportingSources = new Set(cards.map((card) => card.source));

  return (
    <div className="flex flex-col gap-8">
      <FailuresBanner failures={failures} />

      <section className="grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:gap-10">
        <div>
          <Eyebrow>Packet summary</Eyebrow>
          <p className="mt-2 text-[15px] leading-6 text-ink">
            {packet?.summary ?? "No evidence has been collected for this run yet."}
          </p>
          <p className="mt-2 text-xs text-neutral-500 tabular-nums">
            {cards.length} {cards.length === 1 ? "card" : "cards"} · {reportingSources.size}{" "}
            {reportingSources.size === 1 ? "source" : "sources"} reporting
            {failures.length > 0 ? ` · ${failures.length} missing` : ""}
          </p>
        </div>
        <div className="sm:pt-1">
          <Meter
            label={<Eyebrow>Confidence</Eyebrow>}
            trailing={
              <span className="text-sm font-semibold text-ink">{confidence ?? "not available"}</span>
            }
            percent={confidence === null ? null : CONFIDENCE_PERCENT[confidence]}
            tone={confidence === null ? "neutral" : CONFIDENCE_TONE[confidence]}
          />
        </div>
      </section>

      {cards.length === 0 && failures.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No evidence cards yet"
          body="Nothing has been collected for this run. Cards appear here as each allowed source reports back."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {SOURCE_ORDER.map((source) => (
            <SourceGroup
              key={source}
              source={source}
              cards={cards.filter((card) => card.source === source)}
              failure={failures.find((failure) => failure.source === source)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
