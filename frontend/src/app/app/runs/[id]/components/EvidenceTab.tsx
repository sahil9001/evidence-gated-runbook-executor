"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, History, Inbox } from "lucide-react";
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
  /** null when the run predates the evidence-gap measurement. */
  readonly evidenceGapCount: number | null;
  readonly failures: readonly RunFailure[];
}

/**
 * The most important detail on this tab: a packet missing one of its
 * runbook-allowed sources looks perfectly well-formed otherwise (confidence
 * doesn't move for a source that never contributed a card), so this is the
 * only signal that tells an operator the evidence in front of them is
 * partial rather than complete. It leads the tab as a full-bleed rule, not a
 * dismissible-looking box.
 *
 * Two different situations reach here and must not look the same:
 *
 * A run whose gap was measured (`evidenceGapCount` is a number) has a real,
 * current problem — a source the runbook authorises came back with nothing,
 * and that is worth alarming about.
 *
 * A run predating the measurement (`null`) has a gap only because it ran
 * before the collector that would have filled it existed. Nothing is wrong,
 * nothing can be done, and the gap is permanent. Showing settled history as
 * an active failure trains operators to ignore the banner — which costs the
 * real signal its meaning.
 */
function FailuresBanner({ evidenceGapCount, failures }: FailuresBannerProps) {
  if (failures.length === 0) return null;

  const isHistorical = evidenceGapCount === null;
  const sourceWord = failures.length === 1 ? "source" : "sources";

  if (isHistorical) {
    return (
      <div className="flex items-start gap-3 border-l-2 border-neutral-300 bg-neutral-50 py-4 pl-4 pr-5">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Archived packet — {failures.length} {sourceWord} predate{failures.length === 1 ? "s" : ""} the
            current collectors.
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            This run was recorded before {failures.map((failure) => failure.source).join(", ")} could be
            collected. The gap is permanent and expected; newer runs collect{" "}
            {failures.length === 1 ? "it" : "them"}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className="flex items-start gap-3 border-l-2 border-rose-500 bg-rose-50/70 py-4 pl-4 pr-5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" strokeWidth={2.2} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-rose-800">
          This packet is incomplete — {failures.length} evidence {sourceWord} never arrived.
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
  /** The run predates the evidence-gap measurement. */
  readonly isHistorical: boolean;
}

/** A source the runbook allowed but that returned nothing still gets a group:
 * an absent heading would quietly hide the hole in the packet. */
function SourceGroup({ cards, failure, isHistorical, source }: SourceGroupProps) {
  if (cards.length === 0 && failure === undefined) return null;
  const Icon = SOURCE_ICONS[source];
  const isEmpty = cards.length === 0;
  // An archived gap is not a fault, so it does not get the fault colour.
  const emptyTone = isHistorical ? "text-neutral-400" : "text-rose-500";

  return (
    <section>
      <div className="flex items-center gap-2 border-b border-sky-100 pb-2">
        <Icon
          className={cn("h-4 w-4 shrink-0", isEmpty ? emptyTone : "text-signal")}
          strokeWidth={2}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold text-ink">{SOURCE_LABELS[source]}</h3>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            isEmpty && !isHistorical ? "text-rose-600" : "text-neutral-400"
          )}
        >
          {cards.length}
        </span>
      </div>
      {isEmpty ? (
        <p className={`py-4 text-sm ${isHistorical ? "text-neutral-500" : "text-rose-700"}`}>
          {isHistorical
            ? "Not collected for this run — this packet predates the collector for this source."
            : "Nothing arrived from this source — the packet is incomplete here."}
        </p>
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
  readonly evidenceGapCount: number | null;
  readonly failures: readonly RunFailure[];
  readonly packet: EvidencePacket | null;
}

export function EvidenceTab({ confidence, evidenceGapCount, failures, packet }: EvidenceTabProps) {
  // A run recorded before the gap measurement existed: its missing sources are
  // settled history, not a fault to act on.
  const isHistorical = evidenceGapCount === null;
  const cards = packet?.cards ?? [];
  const reportingSources = new Set(cards.map((card) => card.source));

  return (
    <div className="flex flex-col gap-8">
      <FailuresBanner evidenceGapCount={evidenceGapCount} failures={failures} />

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
            <SourceGroup isHistorical={isHistorical}
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
