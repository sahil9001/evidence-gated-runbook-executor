import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunRow } from "@/lib/types";

/** Status, figure, and pill vocabulary shared across the console screens. */

const TONES = {
  neutral: "bg-neutral-100 text-neutral-600",
  info: "bg-sky-50 text-sky-700",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700"
} as const;

export type Tone = keyof typeof TONES;

export function Pill({
  children,
  className,
  icon: Icon,
  tone = "neutral"
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]",
        TONES[tone],
        className
      )}
    >
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.2} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * How each run state should read at a glance. `awaiting_approval` is the only
 * state that means "a human is the blocker", so it is the only one that gets
 * the attention-seeking tone.
 */
export const RUN_STATE_PRESENTATION: Readonly<
  Record<RunRow["state"], { readonly label: string; readonly tone: Tone }>
> = {
  collecting: { label: "Collecting", tone: "info" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "bad" },
  executed: { label: "Executed", tone: "good" }
};

export function RunStatePill({ state }: { state: RunRow["state"] }) {
  const presentation = RUN_STATE_PRESENTATION[state] ?? { label: state, tone: "neutral" as const };
  return <Pill tone={presentation.tone}>{presentation.label}</Pill>;
}

/**
 * A headline number. Figures use tabular numerals so a column of them stays
 * aligned as values change, and are never wrapped in a card.
 */
export function Figure({
  caption,
  icon: Icon,
  label,
  tone = "neutral",
  value
}: {
  caption?: string;
  icon?: LucideIcon;
  label: string;
  tone?: Tone;
  value: ReactNode;
}) {
  const accent = {
    neutral: "text-ink",
    info: "text-signal",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-rose-600"
  }[tone];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {Icon ? (
          <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden="true" />
        ) : null}
        <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
          {label}
        </p>
      </div>
      <p className={cn("mt-2 text-3xl font-semibold leading-none tabular-nums", accent)}>{value}</p>
      {caption ? <p className="mt-2 text-xs leading-5 text-neutral-500">{caption}</p> : null}
    </div>
  );
}

/**
 * A horizontal meter. Used for score components and pipeline proportions --
 * bars, never pie slices, so values stay comparable at a glance.
 */
export function Meter({
  label,
  percent,
  tone = "info",
  trailing
}: {
  label?: ReactNode;
  /** null renders an explicitly unmeasured track rather than an empty one. */
  percent: number | null;
  tone?: Tone;
  trailing?: ReactNode;
}) {
  const fill = {
    neutral: "bg-neutral-400",
    info: "bg-signal",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500"
  }[tone];

  return (
    <div>
      {label || trailing ? (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          {label}
          {trailing}
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? "Not enough data yet" : `${percent}%`}
      >
        {percent === null ? (
          // A dashed track, not a 0% bar: "nothing to measure" and "measured
          // and scored zero" must never look the same.
          <div className="h-full w-full bg-[repeating-linear-gradient(90deg,rgb(186_230_253)_0_6px,transparent_6px_12px)]" />
        ) : (
          <div
            className={cn("h-full rounded-full transition-[width] duration-700", fill)}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        )}
      </div>
    </div>
  );
}
