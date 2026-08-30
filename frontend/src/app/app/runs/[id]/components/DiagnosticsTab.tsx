"use client";

import { FlaskConical, TerminalSquare } from "lucide-react";
import { EmptyState, Eyebrow } from "@/app/app/components/console/Surface";
import type { EvidencePacket } from "@/lib/types";
import { formatTimestamp } from "../shared";

interface DiagnosticsTabProps {
  readonly packet: EvidencePacket | null;
}

/**
 * No sandbox actually runs in this build — whatever's shown here is a
 * fixture the runbook shipped with, collected the same way any other
 * evidence card is. Presenting it as live diagnostic output would be the
 * product lying about its own evidence, so the banner leads every render of
 * this tab, not just the empty state.
 */
export function DiagnosticsTab({ packet }: DiagnosticsTabProps) {
  const sandboxCards = (packet?.cards ?? []).filter((card) => card.source === "sandbox");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start gap-3 border-l-2 border-amber-500 bg-amber-50/70 py-4 pl-4 pr-5">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" strokeWidth={2.2} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Fixture output — no sandbox runs in this build.</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            The diagnostic output below is a static fixture, not a live sandbox execution.
          </p>
        </div>
      </div>

      {sandboxCards.length === 0 ? (
        <EmptyState
          icon={TerminalSquare}
          title="No diagnostic fixture"
          body="No diagnostic fixture was recorded for this run, so there is nothing to reproduce here."
        />
      ) : (
        <ul className="flex flex-col gap-6">
          {sandboxCards.map((card) => (
            <li key={card.id} className="border-t border-sky-100 pt-5 first:border-t-0 first:pt-0">
              <Eyebrow>Reproduction</Eyebrow>
              <p className="mt-2 text-[15px] font-medium leading-6 text-ink">{card.claim}</p>
              <p className="mt-1 text-xs text-neutral-500">Collected {formatTimestamp(card.collectedAt)}</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-sky-50/70 p-3 text-[11px] leading-relaxed text-neutral-700">
                {JSON.stringify(card.raw, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
