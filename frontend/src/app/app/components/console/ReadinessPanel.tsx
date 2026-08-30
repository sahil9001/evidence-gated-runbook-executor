import { CircleAlert, ShieldCheck, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReadinessScore } from "@/lib/readiness";
import { Meter } from "./Indicators";

/**
 * The "how am I performing" answer, and the reasoning behind it.
 *
 * The score is always shown with its components and their raw counts. A bare
 * number an operator cannot audit is exactly the kind of unaccountable
 * summary this product exists to argue against, so the working is on screen
 * rather than behind a tooltip.
 */

const BANDS = {
  strong: {
    label: "Strong",
    note: "Decisions are landing and packets are complete.",
    ring: "text-emerald-500",
    text: "text-emerald-600"
  },
  fair: {
    label: "Fair",
    note: "Working, with gaps worth closing.",
    ring: "text-amber-500",
    text: "text-amber-600"
  },
  "at-risk": {
    label: "At risk",
    note: "Evidence or decisions are falling behind.",
    ring: "text-rose-500",
    text: "text-rose-600"
  }
};

/**
 * A component's bar is coloured by its own value, never by the overall band.
 * Tinting a healthy 71% component red because the aggregate happens to sit in
 * the at-risk band tells the operator the wrong thing about which half of the
 * score needs their attention.
 */
function toneForPercent(percent: number | null): "neutral" | "good" | "warn" | "bad" {
  if (percent === null) return "neutral";
  if (percent >= 80) return "good";
  if (percent >= 50) return "warn";
  return "bad";
}

/** Radius/circumference for the score dial, shared by both arcs. */
const R = 52;
const CIRCUMFERENCE = 2 * Math.PI * R;

function ScoreDial({ band, score }: { band: keyof typeof BANDS; score: number | null }) {
  const presentation = BANDS[band];
  const swept = score === null ? 0 : (score / 100) * CIRCUMFERENCE;

  return (
    <div className="relative h-[136px] w-[136px] shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" strokeWidth="8" className="text-sky-100" />
        {score !== null ? (
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${swept} ${CIRCUMFERENCE}`}
            className={cn(presentation.ring, "transition-[stroke-dasharray] duration-700")}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {score === null ? (
          <span className="text-2xl font-semibold text-neutral-300">--</span>
        ) : (
          <span className="text-4xl font-semibold leading-none tabular-nums text-ink">{score}</span>
        )}
        <span className={cn("mt-1 text-[11px] font-bold uppercase tracking-[0.12em]", presentation.text)}>
          {score === null ? "No data" : presentation.label}
        </span>
      </div>
    </div>
  );
}

export function ReadinessPanel({ readiness }: { readiness: ReadinessScore }) {
  const presentation = BANDS[readiness.band];
  const hasData = readiness.score !== null;

  return (
    <div className="grid gap-8 lg:grid-cols-[auto_1fr] lg:gap-12">
      <div className="flex items-center gap-5">
        <ScoreDial band={readiness.band} score={readiness.score} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
            Operational readiness
          </p>
          <p className="mt-2 max-w-[15rem] text-sm leading-6 text-neutral-600">
            {hasData
              ? presentation.note
              : "Start a run to begin measuring. Nothing has reached a gate yet."}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-neutral-400">
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Across {readiness.totalRuns} run{readiness.totalRuns === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-center gap-6">
        {readiness.components.map((component) => (
          <div key={component.id}>
            <Meter
              percent={component.percent}
              tone={toneForPercent(component.percent)}
              label={
                <span className="text-sm font-semibold text-ink">{component.label}</span>
              }
              trailing={
                <span className="shrink-0 text-xs font-semibold tabular-nums text-neutral-500">
                  {component.percent === null ? (
                    "Not measurable yet"
                  ) : (
                    <>
                      {component.percent}%
                      <span className="ml-2 font-medium text-neutral-400">
                        {component.detail.met}/{component.detail.total}
                      </span>
                    </>
                  )}
                </span>
              }
            />
            <p className="mt-2 text-xs leading-5 text-neutral-500">{component.description}</p>
          </div>
        ))}

        {/* Stated separately from the scored components on purpose: this one
            is true by construction, so averaging it in would add a constant
            to every score and measure nothing. */}
        <p className="flex items-start gap-2 border-t border-sky-100 pt-4 text-xs leading-5 text-neutral-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} aria-hidden="true" />
          <span>
            <span className="font-semibold text-ink">Gate discipline verified.</span> Every
            state-changing action in this workspace passed an approval gate. Guaranteed by the
            executor, so it is not scored above.
          </span>
        </p>

        {readiness.awaiting > 0 ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-700">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>
              {readiness.awaiting} run{readiness.awaiting === 1 ? "" : "s"} still waiting on a human
              decision. Deciding {readiness.awaiting === 1 ? "it" : "them"} is the fastest way to
              raise this score.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
