"use client";

import { FlaskConical, History, TerminalSquare } from "lucide-react";
import { EmptyState, Eyebrow } from "@/app/app/components/console/Surface";
import type { EvidencePacket } from "@/lib/types";
import { formatTimestamp } from "../shared";

interface DiagnosticsTabProps {
  /** null when the run predates the evidence-gap measurement. */
  readonly evidenceGapCount: number | null;
  readonly packet: EvidencePacket | null;
}

/**
 * No sandbox actually runs in this build — whatever's shown here is a
 * fixture the runbook shipped with, collected the same way any other
 * evidence card is. Presenting it as live diagnostic output would be the
 * product lying about its own evidence, so the banner leads every render of
 * this tab, not just the empty state.
 */
export function DiagnosticsTab({ evidenceGapCount, packet }: DiagnosticsTabProps) {
  const sandboxCards = (packet?.cards ?? []).filter((card) => card.source === "sandbox");
  const isHistorical = evidenceGapCount === null;

  return (
    <div className="flex flex-col gap-8">
      {/* Stated as a standing property of the build rather than an amber
          warning about this run: no sandbox executes here, and that is equally
          true of every run. Alarming about it on each one would drown the
          banners that do describe something specific. */}
      <div className="flex items-start gap-3 border-l-2 border-sky-200 bg-sky-50/70 py-4 pl-4 pr-5">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-signal" strokeWidth={2.2} aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">Recorded output, not a live sandbox run.</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">
            RunProof never executes code. This is the captured output of the runbook&apos;s diagnostic
            script, collected like any other evidence — re-running that script reproduces these numbers.
          </p>
        </div>
      </div>

      {sandboxCards.length === 0 ? (
        isHistorical ? (
          <EmptyState
            icon={History}
            title="Recorded before diagnostics were collected"
            body="This run predates the sandbox collector, so no diagnostic output was captured for it. Newer runs include one."
          />
        ) : (
          <EmptyState
            icon={TerminalSquare}
            title="No diagnostic output"
            body="The sandbox source collected nothing for this run, so there is nothing to reproduce here."
          />
        )
      ) : (
        <ul className="flex flex-col gap-6">
          {sandboxCards.map((card) => (
            <li key={card.id} className="border-t border-sky-100 pt-5 first:border-t-0 first:pt-0">
              <Eyebrow>Sandbox output</Eyebrow>
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
