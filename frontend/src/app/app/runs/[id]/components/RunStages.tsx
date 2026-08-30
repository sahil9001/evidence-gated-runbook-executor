import type { LucideIcon } from "lucide-react";
import { FlaskConical, Layers, PlayCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ApprovalGate, EvidencePacket, RunFailure, RunRow } from "@/lib/types";

type StageStatus = "done" | "partial" | "active" | "blocked" | "idle";

interface Stage {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly caption: string;
  readonly status: StageStatus;
}

/** The rule above each stage is the whole visualisation: filled = happened,
 * striped = happening now, hairline = not yet. */
const RULE_CLASS: Readonly<Record<StageStatus, string>> = {
  done: "bg-signal",
  partial: "bg-amber-400",
  active: "bg-[repeating-linear-gradient(90deg,#0284c7_0_5px,transparent_5px_10px)]",
  blocked: "bg-rose-400",
  idle: "bg-sky-100"
};

const ICON_CLASS: Readonly<Record<StageStatus, string>> = {
  done: "text-signal",
  partial: "text-amber-600",
  active: "text-signal",
  blocked: "text-rose-600",
  idle: "text-neutral-300"
};

const CAPTION_CLASS: Readonly<Record<StageStatus, string>> = {
  done: "text-ink",
  partial: "text-amber-700",
  active: "text-signal",
  blocked: "text-rose-700",
  idle: "text-neutral-400"
};

interface RunStagesProps {
  /** null when the run predates the evidence-gap measurement. */
  readonly evidenceGapCount: number | null;
  readonly failures: readonly RunFailure[];
  readonly gate: ApprovalGate | null;
  readonly packet: EvidencePacket | null;
  readonly runState: RunRow["state"];
}

function evidenceStage(
  packet: EvidencePacket | null,
  failures: readonly RunFailure[],
  isHistorical: boolean
): Stage {
  const cards = packet?.cards.length ?? 0;
  const gaps = failures.length;
  const sourceGaps = `${gaps} source ${gaps === 1 ? "gap" : "gaps"}`;

  // A run recorded before the collector that would have filled these gaps is
  // settled history, not a fault. The Evidence tab already says so; this strip
  // sat directly above that banner still colouring the same gap as a problem,
  // so the two contradicted each other on the same screen.
  if (isHistorical && gaps > 0) {
    return {
      label: "Evidence",
      icon: Layers,
      caption: cards === 0 ? "Archived — none collected" : `${cards} ${cards === 1 ? "card" : "cards"}, archived`,
      status: "done"
    };
  }

  // Gaps are checked before the empty case. A run where every allowed
  // collector came back empty has zero cards AND a full set of failures, and
  // returning the neutral "Nothing collected" for it hid a known evidence gap
  // behind a state that reads as "nothing has happened yet".
  if (gaps > 0) {
    return {
      label: "Evidence",
      icon: Layers,
      caption:
        cards === 0
          ? `No cards — ${sourceGaps}`
          : `${cards} ${cards === 1 ? "card" : "cards"}, ${sourceGaps}`,
      // Nothing usable arrived at all, so the run is blocked rather than
      // merely thin: there is no evidence here to reason about.
      status: cards === 0 ? "blocked" : "partial"
    };
  }

  if (cards === 0) {
    return { label: "Evidence", icon: Layers, caption: "Nothing collected", status: "idle" };
  }

  return {
    label: "Evidence",
    icon: Layers,
    caption: `${cards} ${cards === 1 ? "card" : "cards"}`,
    status: "done"
  };
}

function gateStage(gate: ApprovalGate | null): Stage {
  if (gate === null) return { label: "Gate", icon: ShieldCheck, caption: "Not opened", status: "idle" };
  if (gate.state === "locked") {
    return { label: "Gate", icon: ShieldCheck, caption: "Waiting on a human", status: "active" };
  }
  return {
    label: "Gate",
    icon: ShieldCheck,
    caption: gate.state === "approved" ? "Approval recorded" : "Rejection recorded",
    status: gate.state === "approved" ? "done" : "blocked"
  };
}

function actionStage(runState: RunRow["state"]): Stage {
  if (runState === "executed") {
    return { label: "Action", icon: PlayCircle, caption: "Ran to completion", status: "done" };
  }
  if (runState === "rejected") {
    return { label: "Action", icon: PlayCircle, caption: "Never ran", status: "blocked" };
  }
  return { label: "Action", icon: PlayCircle, caption: "Held under the gate", status: "idle" };
}

/**
 * Where this run sits in the flow the product promises: evidence is
 * collected, a sandbox fixture is recorded, a human decides, and only then
 * can the action run. Drawn as four rules rather than four boxes so the
 * strip reads as one continuous progress track across the page.
 */
export function RunStages({ evidenceGapCount, failures, gate, packet, runState }: RunStagesProps) {
  const sandboxCards = (packet?.cards ?? []).filter((card) => card.source === "sandbox").length;

  const stages: readonly Stage[] = [
    evidenceStage(packet, failures, evidenceGapCount === null),
    {
      label: "Sandbox",
      icon: FlaskConical,
      caption: sandboxCards > 0 ? "Fixture recorded" : "No fixture",
      status: sandboxCards > 0 ? "done" : "idle"
    },
    gateStage(gate),
    actionStage(runState)
  ];

  return (
    <ol className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4 sm:gap-x-8">
      {stages.map((stage, index) => {
        const Icon = stage.icon;
        return (
          <li key={stage.label} className="min-w-0">
            <span
              className={cn("block h-[3px] w-full rounded-full", RULE_CLASS[stage.status])}
              aria-hidden="true"
            />
            <div className="mt-3 flex items-center gap-2">
              <Icon
                className={cn("h-3.5 w-3.5 shrink-0", ICON_CLASS[stage.status])}
                strokeWidth={2.2}
                aria-hidden="true"
              />
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                {index + 1}. {stage.label}
              </p>
            </div>
            <p className={cn("mt-1.5 text-sm font-medium leading-5", CAPTION_CLASS[stage.status])}>
              {stage.caption}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
