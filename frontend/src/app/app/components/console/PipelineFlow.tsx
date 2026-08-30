import Link from "next/link";
import { ArrowRight, Database, LockKeyhole, Radio, Terminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OverviewResponse } from "@/lib/types";

/**
 * The four stages every incident moves through, with live counts on each.
 *
 * Doubles as the console's onboarding: a new operator can read what the
 * system does to an incident straight off this strip, and an experienced one
 * reads it as a queue depth. Counts are attached to the stage they actually
 * describe -- the strip is never decorative.
 */

interface Stage {
  readonly body: string;
  readonly count: number;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly id: string;
  readonly label: string;
  /** The stage where work is stuck waiting on a person. */
  readonly needsHuman?: boolean;
  /** Secondary line, for an outcome the headline count deliberately omits. */
  readonly note?: string;
  readonly unit: string;
}

export function buildStages(overview: OverviewResponse): readonly Stage[] {
  const { runsByState } = overview;

  // Only runs that actually reached the executor. A rejected gate closes
  // without running the runbook step, so counting rejections here would
  // report actions at the stage described as "the runbook step runs" that
  // never happened. They are surfaced as a note instead of being hidden.
  const executed = runsByState.executed + runsByState.approved;
  const rejected = runsByState.rejected;

  return [
    {
      id: "signal",
      label: "Signal",
      body: "An alert becomes a tracked incident.",
      count: overview.activeIncidents,
      unit: "active",
      href: "/app/incidents",
      icon: Radio
    },
    {
      id: "evidence",
      label: "Evidence",
      body: "Logs, metrics, and deploys are gathered into a packet.",
      count: runsByState.collecting,
      unit: "collecting",
      href: "/app/history",
      icon: Database
    },
    {
      id: "gate",
      label: "Approval gate",
      body: "The action stays locked until a person decides.",
      count: runsByState.awaiting_approval,
      unit: "waiting",
      href: "/app/incidents",
      icon: LockKeyhole,
      needsHuman: true
    },
    {
      id: "action",
      label: "Action",
      body: "The approved runbook step runs, and the decision is recorded.",
      count: executed,
      unit: "executed",
      note: rejected > 0 ? `${rejected} rejected at the gate — never ran` : undefined,
      href: "/app/audit",
      icon: Terminal
    }
  ];
}

export function PipelineFlow({ overview }: { overview: OverviewResponse }) {
  const stages = buildStages(overview);

  return (
    <ol className="grid gap-px overflow-hidden border-y border-sky-100 bg-sky-100 sm:grid-cols-2 lg:grid-cols-4">
      {stages.map((stage, index) => {
        const Icon = stage.icon;
        // Only the gate is ever "blocked on you"; the other stages are the
        // agent's work and a number there is progress, not a backlog.
        const alert = stage.needsHuman === true && stage.count > 0;

        return (
          <li key={stage.id} className="relative bg-white">
            <Link
              href={stage.href}
              className="group flex h-full flex-col gap-3 p-5 transition hover:bg-sky-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition",
                    alert ? "bg-amber-100 text-amber-700" : "bg-sky-50 text-signal"
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                  Step {index + 1}
                </span>
                {index < stages.length - 1 ? (
                  <ArrowRight
                    aria-hidden="true"
                    className="ml-auto hidden h-4 w-4 text-sky-200 lg:block"
                    strokeWidth={2}
                  />
                ) : null}
              </div>

              <div>
                <p className="text-sm font-semibold text-ink">{stage.label}</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{stage.body}</p>
              </div>

              <div className="mt-auto pt-2">
                <p className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "text-2xl font-semibold leading-none tabular-nums",
                      alert ? "text-amber-600" : "text-ink"
                    )}
                  >
                    {stage.count}
                  </span>
                  <span className="text-xs font-medium text-neutral-500">{stage.unit}</span>
                  {alert ? (
                    <span className="rp-pulse ml-1 h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                  ) : null}
                </p>
                {stage.note ? (
                  <p className="mt-1.5 text-[11px] font-medium text-neutral-400">{stage.note}</p>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
