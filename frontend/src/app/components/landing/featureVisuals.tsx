import {
  CheckCircle2,
  Clock3,
  FileText,
  GitCommitHorizontal,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Terminal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { workflowRows } from "../landingContent";

/**
 * Product visuals for the feature showcase.
 *
 * These replace an earlier set built from arbitrary 3D `rotate`/`perspective`
 * transforms, where the rotated cards overlapped each other and their body copy
 * collided into unreadable text. Everything here stays on a flat plane: depth
 * comes from stacking, offset, and shadow instead.
 */

function VisualFrame({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-full min-h-[380px] overflow-hidden rounded-2xl border border-sky-100 bg-[#f6fafe] p-5 sm:p-7",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(2,132,199,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(2,132,199,0.05)_1px,transparent_1px)] bg-[length:32px_32px]" />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

const severityTone = {
  high: "border-rose-200 bg-rose-50 text-rose-600",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-emerald-200 bg-emerald-50 text-emerald-700"
} as const;

const incidentCards = [
  {
    elapsed: "120s",
    severity: "high",
    summary: "Rollback touches payment-service and its retry queue.",
    tags: ["rollback", "risk"],
    title: "Risk analysis"
  },
  {
    elapsed: "40s",
    severity: "medium",
    summary: "Checkout failure, likely cause, and operator decision in one place.",
    tags: ["checkout", "p95"],
    title: "Incident tracker"
  },
  {
    elapsed: "10s",
    severity: "low",
    summary: "Deploy diffs, logs, and metrics collected before any action.",
    tags: ["deploy", "logs"],
    title: "Evidence packet"
  }
] as const;

export function IncidentWorkspaceVisual() {
  return (
    <VisualFrame>
      <div className="flex h-full flex-col gap-3">
        {incidentCards.map((card, index) => (
          <article
            key={card.title}
            className={cn(
              "rp-rise rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_1px_2px_rgb(11_15_26/0.04)]",
              // A small, consistent indent reads as a stack without ever
              // pushing one card's text on top of another's.
              index === 1 && "ml-3",
              index === 2 && "ml-6",
              index === 0 && "rp-rise-1",
              index === 1 && "rp-rise-2",
              index === 2 && "rp-rise-3"
            )}
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-signal" strokeWidth={2} />
              <h4 className="text-sm font-semibold text-ink">{card.title}</h4>
              <span
                className={cn(
                  "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                  severityTone[card.severity]
                )}
              >
                <Radio className="h-2.5 w-2.5" strokeWidth={2.4} />
                {card.elapsed}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-5 text-neutral-500">{card.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700"
                >
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </VisualFrame>
  );
}

export function EvidenceCaptureVisual() {
  const completed = workflowRows.filter(([, , state]) => state === "complete").length;
  const percent = Math.round((completed / workflowRows.length) * 100);

  return (
    <VisualFrame>
      <div className="rp-rise flex h-full flex-col rounded-2xl border border-sky-100 bg-white p-4 shadow-[0_1px_2px_rgb(11_15_26/0.04)] sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-signal">
            <FileText className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <div>
            <h4 className="text-sm font-semibold text-ink">Evidence packet</h4>
            <p className="text-xs text-neutral-500">checkout-failure</p>
          </div>
          <span className="ml-auto text-xs font-semibold tabular-nums text-signal">
            {completed}/{workflowRows.length}
          </span>
        </div>

        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
          <div
            className="h-full rounded-full bg-signal transition-[width] duration-700"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ul className="mt-4 flex-1 divide-y divide-sky-50">
          {workflowRows.map(([label, time, state]) => (
            <li key={label} className="flex items-center gap-3 py-2.5">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  state === "pending" ? "bg-amber-100 text-amber-600" : "bg-emerald-100 text-emerald-600"
                )}
              >
                {state === "pending" ? (
                  <Clock3 className="rp-pulse h-3 w-3" strokeWidth={2.4} />
                ) : (
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.6} />
                )}
              </span>
              <span
                className={cn(
                  "flex-1 text-[13px]",
                  state === "pending" ? "font-semibold text-ink" : "text-neutral-600"
                )}
              >
                {label}
              </span>
              <span className="text-[11px] font-bold tabular-nums text-neutral-400">{time}</span>
            </li>
          ))}
        </ul>
      </div>
    </VisualFrame>
  );
}

const replayFindings = [
  {
    count: 12,
    detail: "4 affected log lines",
    icon: Terminal,
    label: "Log",
    title: "Checkout timeout reproduced in sandbox",
    tone: "bg-sky-500"
  },
  {
    count: 8,
    detail: "2 matching traces",
    icon: Radio,
    label: "Trace",
    title: "Retry fanout matches production failure",
    tone: "bg-cyan-500"
  },
  {
    count: 3,
    detail: "1 deploy candidate",
    icon: GitCommitHorizontal,
    label: "Run",
    title: "Rollback path is safe to recommend",
    tone: "bg-indigo-500"
  },
  {
    count: 1,
    detail: "approval still required",
    icon: ShieldCheck,
    label: "Gate",
    title: "Production action remains locked",
    tone: "bg-emerald-500"
  }
] as const;

export function SandboxReplayVisual() {
  return (
    <VisualFrame>
      <div className="rp-rise flex h-full flex-col rounded-2xl border border-sky-100 bg-white shadow-[0_1px_2px_rgb(11_15_26/0.04)]">
        <div className="flex items-center gap-2 border-b border-sky-50 px-4 py-3">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          <p className="text-xs font-semibold text-ink">Sandbox replay</p>
          <p className="ml-auto text-[11px] font-semibold text-neutral-400">isolated target</p>
        </div>

        <ul className="flex-1 divide-y divide-sky-50">
          {replayFindings.map((finding) => {
            const Icon = finding.icon;

            return (
              <li key={finding.title} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-signal">
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <span className="w-10 shrink-0 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                  {finding.label}
                </span>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", finding.tone)} />
                <span className="min-w-0 flex-1">
                  {/* Wraps instead of being masked by a fade, so no finding is
                      ever half-readable at narrow widths. */}
                  <span className="block text-[13px] font-medium leading-5 text-ink">
                    {finding.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-neutral-400">
                    {finding.detail}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-neutral-300">
                  {String(finding.count).padStart(2, "0")}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </VisualFrame>
  );
}

export function ApprovalGateVisual() {
  return (
    <VisualFrame className="flex items-center justify-center">
      <div className="flex h-full flex-col items-center justify-center gap-6">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-sky-100 bg-white" />
          <span className="absolute inset-4 rounded-full border border-dashed border-sky-200" />
          <span className="rp-float relative flex h-20 w-20 items-center justify-center rounded-2xl bg-signal text-white shadow-[0_12px_32px_rgb(2_132_199/0.28)]">
            <ShieldCheck className="h-9 w-9" strokeWidth={1.8} />
          </span>
        </div>

        <div className="grid w-full max-w-xs gap-2.5">
          <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-white p-3">
            <LockKeyhole className="h-4 w-4 shrink-0 text-signal" strokeWidth={2} />
            <span className="text-[13px] font-semibold text-ink">Approval</span>
            <span className="ml-auto rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
              required
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-sky-100 bg-white p-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2} />
            <span className="text-[13px] font-semibold text-ink">Audit</span>
            <span className="ml-auto rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              recorded
            </span>
          </div>
        </div>
      </div>
    </VisualFrame>
  );
}
