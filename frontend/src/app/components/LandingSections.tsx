import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Play,
  Radio,
  ShieldCheck,
  Terminal
} from "lucide-react";
import {
  footerGroups,
  outcomes,
  platformCards,
  workflowRows
} from "./landingContent";
import { IntegrationFlow } from "./IntegrationFlow";

function SectionShell({
  children,
  className,
  id
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const sectionClassName = className ?? "bg-white";

  return (
    <section
      id={id}
      className={`overflow-hidden rounded-2xl shadow-sm sm:rounded-3xl ${sectionClassName}`}
    >
      {children}
    </section>
  );
}

function FeatureTile({
  body,
  children,
  className = "",
  title
}: {
  body: string;
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <div className={`relative overflow-hidden border-sky-100 bg-white ${className}`}>
      <div className="px-4 pt-5 md:px-8 md:pt-8">
        <h3 className="text-left text-xl font-semibold text-ink md:text-2xl md:leading-snug">
          {title}
        </h3>
        <p className="mx-0 mt-2 max-w-sm text-left text-sm leading-6 text-neutral-500">
          {body}
        </p>
      </div>
      <div className="h-full max-h-[390px] w-full pt-3 md:pt-5">{children}</div>
    </div>
  );
}

function TimeBadge({ time, tone }: { time: string; tone: "green" | "yellow" | "red" }) {
  const toneClass = {
    green: "border-emerald-300 bg-emerald-300/10 text-emerald-600",
    red: "border-red-300 bg-red-300/10 text-red-500",
    yellow: "border-amber-300 bg-amber-300/10 text-amber-600"
  }[tone];

  return (
    <div className={`flex w-fit items-center gap-1 rounded-full border px-1.5 py-1 ${toneClass}`}>
      <Radio className="h-3 w-3" strokeWidth={1.8} />
      <p className="text-[10px] font-bold">{time}</p>
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
    <div className={`absolute h-fit w-full rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-2xl ${className}`}>
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-signal" strokeWidth={1.8} />
        <p className="text-sm font-semibold text-ink">{title}</p>
        <TimeBadge tone={tone} time={time} />
      </div>
      <p className="mt-3 text-sm leading-5 text-neutral-500">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <div key={tag} className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
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
            time="10s"
            tone="green"
          />
          <TiltedAgentCard
            className="bottom-24 left-10 z-20 max-w-[72%]"
            title="Incident tracker"
            description="Keeps the checkout failure, likely cause, and operator decision in one visible place."
            tags={["checkout", "timeout", "p95"]}
            time="40s"
            tone="yellow"
          />
          <TiltedAgentCard
            className="bottom-40 left-4 z-10 max-w-[66%]"
            title="Risk analysis"
            description="Shows what rollback touches and why approval is required."
            tags={["rollback", "risk", "gate"]}
            time="120s"
            tone="red"
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
                        <CheckCircle2 className={`h-3 w-3 text-white ${state === "pending" ? "rp-pulse" : ""}`} strokeWidth={2.2} />
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
  const replayFindings = [
    {
      count: "(12)",
      detail: "4 affected log lines",
      icon: Terminal,
      label: "Log",
      progress: "border-sky-500 after:bg-sky-500",
      title: "Checkout timeout reproduced in sandbox"
    },
    {
      count: "(08)",
      detail: "2 matching traces",
      icon: Radio,
      label: "Trace",
      progress: "border-sky-500 after:bg-sky-500",
      title: "Retry fanout matches production failure"
    },
    {
      count: "(03)",
      detail: "1 deploy candidate",
      icon: CheckCircle2,
      label: "Run",
      progress: "border-cyan-500",
      title: "Rollback path is safe to recommend"
    },
    {
      count: "(01)",
      detail: "approval still required",
      icon: ShieldCheck,
      label: "Gate",
      progress: "border-emerald-500 after:bg-emerald-500",
      title: "Production action remains locked"
    }
  ];

  return (
    <div className="relative h-[330px] overflow-hidden bg-[#f7fbff] px-4 pt-5">
      <div className="rp-rise relative rounded-2xl border-2 border-sky-100 bg-white py-2 shadow-2xl">
        {replayFindings.map((finding, index) => {
          const Icon = finding.icon;

          return (
            <div key={finding.title} className={`group flex items-center gap-4 px-4 py-3 ${index > 0 ? "border-t border-sky-50" : ""}`}>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-signal">
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="w-12 shrink-0 text-xs font-semibold text-neutral-400">{finding.label}</div>
              <div
                className={`relative h-4 w-4 shrink-0 rounded-full border-[5px] ${finding.progress} after:absolute after:inset-y-[-5px] after:right-[-5px] after:w-2 after:rounded-r-full after:content-['']`}
              />
              <div className="flex min-w-0 flex-1 flex-col text-sm">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{finding.title}</span>
                  <span className="text-neutral-400">{finding.count}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-4 text-xs text-neutral-400">
                  <span>{finding.detail}</span>
                </div>
              </div>
            </div>
          );
        })}

        <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-white via-white to-transparent lg:w-44" />
        <div className="pointer-events-none absolute -right-2 -top-4 z-20 h-[110%] w-20 bg-gradient-to-l from-[#f7fbff] to-transparent md:w-32" />
      </div>
      <div className="rp-float absolute bottom-10 right-8 z-30 rounded-2xl border border-sky-100 bg-white p-3 shadow-xl">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 fill-current text-signal" strokeWidth={1.8} />
          <p className="text-xs font-semibold text-ink">Replay complete</p>
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
        <p className="text-xs font-semibold text-sky-700">Approval</p>
        <p className="mt-2 text-sm font-semibold text-ink">required</p>
      </div>
      <div className="absolute bottom-10 right-6 rounded-2xl border border-sky-100 bg-white/95 p-3 shadow-xl">
        <p className="text-xs font-semibold text-sky-700">Audit</p>
        <p className="mt-2 text-sm font-semibold text-ink">recorded</p>
      </div>
    </div>
  );
}

function WorkflowSection() {
  return (
    <SectionShell id="workflow" className="bg-white">
      <div className="grid grid-cols-1 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-12 lg:py-16">
          <h2 className="max-w-xl text-3xl font-semibold leading-tight text-ink sm:text-4xl lg:text-5xl">
            From noisy alert to approved run.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-neutral-600">
            RunProof turns a page into a staged workflow: gather the signal, replay the failure, and approve the action with proof attached.
          </p>
          <div className="mt-8 grid gap-3">
            {outcomes.map((outcome) => (
              <div
                key={outcome}
                className="flex items-start gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 p-4"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-signal" strokeWidth={2} />
                <p className="text-sm leading-6 text-neutral-700">{outcome}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative min-h-[360px] overflow-hidden bg-sky-50 lg:min-h-[620px]">
          <Image
            src="/landing/daytime-forest-stream.png"
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(min-width: 1024px) 52vw, 100vw"
            className="object-cover"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-ink/5" />
        </div>
      </div>
    </SectionShell>
  );
}

function PlatformSection() {
  return (
    <SectionShell id="platform" className="bg-white">
      <div className="px-6 py-10 sm:px-10 lg:px-12 lg:py-16">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold leading-tight text-ink sm:text-4xl lg:text-5xl">
            A control layer for AI-assisted operations.
          </h2>
          <p className="mt-5 text-base leading-7 text-neutral-600">
            Use agents for investigation and diagnosis while keeping the production boundary explicit.
          </p>
        </div>

        <div className="mt-9 grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {platformCards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.title}
                  className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-signal">
                    <Icon className="h-5 w-5" strokeWidth={1.8} />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-ink">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">{card.body}</p>
                </article>
              );
            })}
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-sky-100 bg-sky-50 p-5 sm:p-6">
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(2,132,199,0.13),transparent_42%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.2),transparent_28%)]" />
            <div className="relative">
              <p className="text-sm font-semibold text-signal">Policy-aware by default</p>
              <h3 className="mt-4 text-2xl font-semibold leading-tight text-ink">
                Recommendations are useful only when the evidence is visible.
              </h3>
              <div className="mt-6 space-y-3">
                {[
                  "Source packet attached",
                  "Runbook rule matched",
                  "Sandbox replay completed",
                  "Human decision required"
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-xl bg-white/88 px-4 py-3 shadow-sm"
                  >
                    <span className="text-sm font-semibold text-neutral-700">{item}</span>
                    <CheckCircle2 className="h-4 w-4 text-signal" strokeWidth={2} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function FeatureGridSection() {
  return (
    <SectionShell id="runbooks">
      <div className="relative z-20 mx-auto max-w-5xl py-10 lg:py-20">
        <div className="px-6">
          <h2 className="mx-auto max-w-5xl text-center text-3xl font-semibold text-ink sm:text-4xl lg:text-5xl lg:leading-tight">
            Packed with proof-first <span className="font-serif italic font-normal leading-[1.1]">features</span>
          </h2>
          <p className="mx-auto my-4 max-w-2xl text-center text-sm leading-6 text-neutral-500 lg:text-base">
            RunProof connects the parts of an incident that usually stay scattered: issue context, logs, runbooks, sandbox output, and the final approval gate.
          </p>
        </div>

        <div className="relative px-2 sm:px-6">
          <div className="mt-12 grid grid-cols-1 overflow-hidden rounded-lg border border-sky-100 lg:grid-cols-6">
            <FeatureTile
              className="col-span-1 border-b lg:col-span-4 lg:border-r"
              title="Track incidents with evidence"
              body="Every alert becomes a structured workspace with the deploys, logs, metrics, and runbook rules needed to reason about the fix."
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
              className="col-span-1 border-b lg:col-span-3 lg:border-b-0 lg:border-r"
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

function FinalCtaSection() {
  return (
    <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm sm:rounded-3xl">
      <div className="grid items-center gap-0 lg:grid-cols-[1fr_0.78fr]">
        <div className="px-6 py-10 sm:px-10 lg:px-12 lg:py-14">
          <h2 className="max-w-2xl text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            Ready to review the incident loop?
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            Create an account, open the console, and walk through an evidence-gated runbook from alert to approval.
          </p>
          <Link
            href="/register"
            className="mt-7 inline-flex w-fit items-center gap-3 rounded-full bg-signal py-2.5 pl-6 pr-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0"
          >
            Get started
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </span>
          </Link>
        </div>
        <div className="relative min-h-[260px] overflow-hidden bg-sky-50 lg:min-h-full">
          <Image
            src="/landing/daytime-meadow-lake.png"
            alt=""
            aria-hidden="true"
            fill
            unoptimized
            sizes="(min-width: 1024px) 42vw, 100vw"
            className="object-cover"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-white/25 to-transparent" />
        </div>
      </div>
    </section>
  );
}

function IntegrationSection() {
  return (
    <SectionShell id="integrations" className="bg-white">
      <IntegrationFlow />
    </SectionShell>
  );
}

function Footer() {
  return (
    <footer className="relative left-1/2 w-screen -translate-x-1/2 bg-ink text-white">
      <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:px-12 lg:py-12">
        <div>
          <Image
            src="/brand/runproof-wordmark-white.png"
            alt="RunProof"
            width={160}
            height={38}
            className="h-8 w-auto"
          />
          <p className="mt-5 max-w-md text-sm leading-6 text-white/65">
            Evidence-gated runbook execution for teams that need AI assistance without giving up production control.
          </p>
          <p className="mt-8 text-sm text-white/45">Copyright 2026 RunProof Labs. All rights reserved.</p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-white">{group.title}</h3>
              <div className="mt-4 flex flex-col gap-3">
                {group.links.map((link) => (
                  <Link key={link.label} href={link.href} className="text-sm text-white/62 transition hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}

export function LandingSections() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pt-4 sm:gap-5 sm:pt-5">
      <WorkflowSection />
      <PlatformSection />
      <FeatureGridSection />
      <IntegrationSection />
      <FinalCtaSection />
      <Footer />
    </div>
  );
}
