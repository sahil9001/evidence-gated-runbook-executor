"use client";

import { FlaskConical } from "lucide-react";
import type { EvidencePacket } from "../../../../../lib/types";
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
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Fixture output — no sandbox runs in this build.</p>
          <p className="mt-1 text-xs text-amber-800">
            The diagnostic output below is a static fixture, not a live sandbox execution.
          </p>
        </div>
      </div>

      {sandboxCards.length === 0 ? (
        <p className="rounded-2xl bg-panel px-4 py-6 text-center text-sm font-medium text-neutral-500">
          No diagnostic fixture was recorded for this run.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sandboxCards.map((card) => (
            <li key={card.id} className="rounded-2xl bg-white p-4">
              <p className="text-sm font-semibold text-ink">{card.claim}</p>
              <p className="mt-1 text-xs text-neutral-500">Collected {formatTimestamp(card.collectedAt)}</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-panel p-3 text-[11px] leading-relaxed text-neutral-700">
                {JSON.stringify(card.raw, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
