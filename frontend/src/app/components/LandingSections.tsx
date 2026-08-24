import type { ReactNode } from "react";
import {
  CheckCircle2,
  Play,
  Radio,
  ShieldCheck,
  Terminal
} from "lucide-react";

const terminalLines = [
  "$ runproof replay checkout-failure",
  "loading logs: payment-service, api-gateway",
  "matched deploy: retry-window-config",
  "sandbox.exec diagnostic_timeout_check.js",
  "result: reproduced timeout in 2.9s",
  "recommendation: rollback config after approval"
];

const workflowRows = [
  ["Fetching logs", "10s", "complete"],
  ["Processing traces", "20s", "complete"],
  ["Running sandbox", "30s", "complete"],
  ["Writing proof packet", "40s", "complete"],
  ["Waiting for approval", "50s", "pending"]
];

const footerLinks = [
  {
    label: "Privacy Policy",
    href: "#"
  },
  {
    label: "Terms of Service",
    href: "#"
  },
  {
    label: "Security",
    href: "#"
  }
];

function SectionShell({
  children,
  id,
  className = ""
}: {
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`overflow-hidden rounded-2xl bg-white shadow-sm sm:rounded-3xl ${className}`}
    >
      {children}
    </section>
  );
}

function FeatureTile({
  children,
  className = "",
  title,
  body
}: {
  children: ReactNode;
  className?: string;
  title: string;
  body: string;
}) {
  return (
    <div
      className={`relative overflow-hidden border-sky-100 bg-white ${className}`}
    >
      <div className="px-4 pt-5 md:px-8 md:pt-8">
        <h3 className="text-left text-xl font-semibold tracking-[-0.015em] text-ink md:text-2xl md:leading-snug">
          {title}
        </h3>
        <p className="mx-0 mt-2 max-w-sm text-left text-sm leading-6 text-neutral-500">
          {body}
        </p>
      </div>
      <div className="h-full max-h-[390px] w-full pt-3 md:pt-5">
        {children}
      </div>
    </div>
  );
}

function TimeBadge({
  time,
  tone
}: {
  time: string;
  tone: "green" | "yellow" | "red";
}) {
  const toneClass = {
    green: "border-emerald-300 bg-emerald-300/10 text-emerald-600",
    red: "border-red-300 bg-red-300/10 text-red-500",
    yellow: "border-amber-300 bg-amber-300/10 text-amber-600"
  }[tone];

  return (
    <div
      className={`flex w-fit items-center gap-1 rounded-full border px-1.5 py-1 ${toneClass}`}
    >
      <Radio className="h-3 w-3" strokeWidth={1.8} />
      <p className="text-[10px] font-bold uppercase">{time}</p>
    </div>
  );
}

function TiltedAgentCard({
  className,
  description,
  tags,
  time,
  title,
  tone
}: {
  className: string;
  description: string;
  tags: string[];
  time: string;
  title: string;
  tone: "green" | "yellow" | "red";
}) {
  return (
    <div
      className={`absolute h-fit w-full rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-2xl ${className}`}
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-signal" strokeWidth={1.8} />
        <p className="text-sm font-semibold text-ink">{title}</p>
        <TimeBadge tone={tone} time={time} />
      </div>
      <p className="mt-3 text-sm leading-5 text-neutral-500">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <div
            key={tag}
            className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700"
          >
            {tag}
          </div>
        ))}
      </div>
    </div>
  );
}

function IssueTrackerBoard() {
  return (
    <div className="relative h-[410px] overflow-hidden bg-[#f7fbff] [perspective:900px]">
      <div className="absolute inset-x-0 bottom-0 z-20 h-32 bg-gradient-to-b from-transparent to-white" />
      <div className="rp-rise absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            transform: "translateY(-85px) translateX(83px) scale(1.2) rotateX(4deg) rotateY(5deg) rotateZ(-15deg)",
            transformStyle: "preserve-3d"
          }}
        >
          <TiltedAgentCard
            className="bottom-8 left-16 z-30 max-w-[78%]"
            title="Evidence packet"
            description="Collects deploy diffs, logs, metrics, and runbook rules before any action is suggested."
            tags={["deploy", "logs", "metrics"]}
            tone="green"
            time="10s"
          />
          <TiltedAgentCard
            className="bottom-24 left-10 z-20 max-w-[72%]"
            title="Incident tracker"
            description="Keeps the checkout failure, likely cause, and operator decision in one visible place."
            tags={["checkout", "timeout", "p95"]}
            tone="yellow"
            time="40s"
          />
          <TiltedAgentCard
            className="bottom-40 left-4 z-10 max-w-[66%]"
            title="Risk analysis"
            description="Shows why rollback is useful, what it touches, and why approval is required."
            tags={["rollback", "risk", "gate"]}
            tone="red"
            time="120s"
          />
        </div>
      </div>
    </div>
  );
}

function EvidenceCardStack() {
  return (
    <div className="relative h-[350px] overflow-hidden bg-[#f7fbff] [perspective:900px]">
      <div className="absolute inset-x-0 bottom-0 z-20 h-28 bg-gradient-to-b from-transparent to-white" />
      <div className="rp-rise h-full w-full">
        <div
          className="group mx-auto flex h-full w-full max-w-[86%] flex-col rounded-2xl border border-sky-100 bg-white p-3 shadow-2xl"
          style={{
            transform: "translateX(40px) rotateY(20deg) rotateX(20deg) rotateZ(-20deg)",
            transformStyle: "preserve-3d"
          }}
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-signal" strokeWidth={1.8} />
            <p className="text-sm font-semibold text-ink">Evidence capture</p>
          </div>
          <div className="relative mt-4 flex-1 overflow-visible rounded-2xl border border-sky-100 bg-sky-50">
            <div className="absolute inset-0 bg-[repeating-linear-gradient(315deg,rgba(2,132,199,0.12)_0,rgba(2,132,199,0.12)_1px,transparent_0,transparent_50%)] bg-[length:10px_10px]" />
            <div className="absolute inset-0 translate-x-4 -translate-y-4 rounded-2xl bg-white transition duration-300 group-hover:translate-x-0 group-hover:translate-y-0">
              {workflowRows.map(([label, time, state], index) => (
                <div key={label}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-4 w-4 items-center justify-center rounded-full ${
                          state === "pending" ? "bg-amber-500" : "bg-emerald-500"
                        }`}
                      >
                        <CheckCircle2
                          className={`h-3 w-3 text-white ${
                            state === "pending" ? "rp-pulse" : ""
                          }`}
                          strokeWidth={2.2}
                        />
                      </div>
                      <p className="text-sm font-medium text-neutral-500">{label}</p>
                    </div>
                    <div className="flex items-center gap-1 text-neutral-400">
                      <Radio className="h-3 w-3" strokeWidth={1.8} />
                      <p className="text-[10px] font-bold">{time}</p>
                    </div>
                  </div>
                  {index < workflowRows.length - 1 ? (
                    <div className="h-px w-full bg-gradient-to-r from-transparent via-sky-100 to-transparent" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplayPreview() {
  return (
    <div className="relative h-[330px] overflow-hidden bg-[#f7fbff] [perspective:900px]">
      <div className="absolute inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-b from-transparent to-white" />
      <div className="rp-rise absolute inset-x-7 top-4 rounded-2xl border border-sky-100 bg-white p-3 shadow-2xl">
        <div className="flex items-center gap-3">
          <Terminal className="h-4 w-4 text-signal" strokeWidth={1.8} />
          <p className="text-sm font-semibold text-ink">Sandbox replay</p>
          <TimeBadge tone="green" time="30s" />
        </div>
        <div className="relative mt-4 overflow-hidden rounded-2xl bg-ink p-4 text-white">
          <div className="rp-scan absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-sky-300/20 to-transparent" />
          <div className="relative space-y-2 font-mono text-[12px] leading-6 text-white/72">
            {terminalLines.slice(0, 5).map((line, index) => (
              <p key={line} className={`rp-terminal-line rp-terminal-${index + 1}`}>
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
      <div className="rp-float absolute bottom-12 right-9 z-30 rounded-2xl border border-sky-100 bg-white p-3 shadow-xl">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 fill-current text-signal" strokeWidth={1.8} />
          <p className="text-xs font-semibold text-ink">reproduced safely</p>
        </div>
      </div>
    </div>
  );
}

function DeployGuardVisual() {
  return (
    <div className="relative h-[330px] overflow-hidden bg-[#f7fbff]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(14,165,233,0.22),transparent_32%),repeating-linear-gradient(90deg,rgba(14,165,233,0.12)_0,rgba(14,165,233,0.12)_1px,transparent_1px,transparent_22px)] [mask-image:radial-gradient(circle_at_center,black_0%,transparent_72%)]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-sky-100 bg-white shadow-2xl md:h-44 md:w-44">
          <div className="absolute inset-4 rounded-full border border-dashed border-sky-200" />
          <div className="rp-float relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-signal text-white shadow-[0_22px_70px_rgba(2,132,199,0.35)] md:h-24 md:w-24">
            <ShieldCheck className="h-10 w-10" strokeWidth={1.8} />
          </div>
        </div>
      </div>
      <div className="absolute left-6 top-8 rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          approval
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">required</p>
      </div>
      <div className="absolute bottom-10 right-6 rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
          audit
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">recorded</p>
      </div>
    </div>
  );
}

function FeatureGridSection() {
  return (
    <SectionShell id="runbooks" className="rounded-2xl bg-white sm:rounded-3xl">
      <div className="relative z-20 mx-auto max-w-5xl py-10 lg:py-20">
        <div className="px-6">
          <h2 className="mx-auto max-w-5xl text-center text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl lg:leading-tight">
            Packed with proof-first{" "}
            <span className="font-serif italic font-normal leading-[1.1]">
              features
            </span>
          </h2>
          <p className="mx-auto my-4 max-w-2xl text-center text-sm leading-6 text-neutral-500 lg:text-base">
            RunProof connects the parts of an incident that usually stay
            scattered: issue context, logs, runbooks, sandbox output, and the
            final approval gate.
          </p>
        </div>

        <div className="relative px-2 sm:px-6">
          <div className="mt-12 grid grid-cols-1 overflow-hidden rounded-lg border border-sky-100 lg:grid-cols-6">
            <FeatureTile
              className="col-span-1 border-b lg:col-span-4 lg:border-r"
              title="Track incidents with evidence"
              body="Every alert becomes a structured workspace with the exact deploys, logs, metrics, and runbook rules needed to reason about the fix."
            >
              <IssueTrackerBoard />
            </FeatureTile>

            <FeatureTile
              className="col-span-1 border-b lg:col-span-2"
              title="Capture proof automatically"
              body="Evidence cards move into the packet as the agent checks each safe source."
            >
              <EvidenceCardStack />
            </FeatureTile>

            <FeatureTile
              className="col-span-1 border-b lg:col-span-3 lg:border-r lg:border-b-0"
              title="Replay the failure safely"
              body="Diagnostics run in a sandbox first, so the recommendation is backed by visible output."
            >
              <ReplayPreview />
            </FeatureTile>

            <FeatureTile
              className="col-span-1 lg:col-span-3"
              title="Deploy only after approval"
              body="Production actions stay blocked until a human reviews the proof packet and approves the runbook step."
            >
              <DeployGuardVisual />
            </FeatureTile>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

export function LandingSections() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pt-4 sm:gap-5 sm:pt-5">
      <FeatureGridSection />

      <footer className="relative left-1/2 w-screen -translate-x-1/2 border-t border-neutral-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-7 text-sm font-medium text-neutral-700 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
          <p>© 2026 RunProof Labs. All rights reserved.</p>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
            {footerLinks.map((link) => (
              <a key={link.label} href={link.href} className="hover:text-signal">
                {link.label}
              </a>
            ))}
            <button className="inline-flex w-fit items-center gap-1 hover:text-signal">
              English
              <span aria-hidden="true">⌄</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
