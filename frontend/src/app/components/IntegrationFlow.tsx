import Image from "next/image";
import { ArrowRight, CheckCircle2, LockKeyhole, Radio, ShieldCheck, Terminal } from "lucide-react";
import { integrations } from "./landingContent";

const outputNodes = [
  {
    icon: CheckCircle2,
    label: "Evidence packet",
    body: "Deploys, traces, logs, and metrics are grouped for review."
  },
  {
    icon: Terminal,
    label: "Sandbox replay",
    body: "Diagnostics run before production is touched."
  },
  {
    icon: LockKeyhole,
    label: "Approval request",
    body: "The action stays locked until a person approves."
  }
];

export function IntegrationFlow() {
  return (
    <div className="px-6 py-10 sm:px-10 lg:px-12 lg:py-16">
      <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-signal">
            <Radio className="h-5 w-5" strokeWidth={1.8} />
          </div>
          <h2 className="mt-6 max-w-2xl text-3xl font-semibold leading-tight text-ink sm:text-4xl lg:text-5xl">
            Designed for the stack that already wakes you up.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-600">
            Connect the tools that create incident context, then move the work through one visible proof and approval flow.
          </p>
        </div>

        <div className="flex w-fit items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Live context flow
        </div>
      </div>

      <div className="mt-9 overflow-hidden rounded-2xl border border-sky-100 bg-[#f7fbff] shadow-sm">
        <div className="relative p-4 sm:p-6 lg:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,132,199,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(2,132,199,0.08)_1px,transparent_1px)] bg-[length:42px_42px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_50%,rgba(14,165,233,0.2),transparent_34%)]" />

          <div className="relative overflow-x-auto pb-2">
            <div className="grid min-w-[940px] grid-cols-[280px_360px_280px] items-center gap-5">
              <div className="grid gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">
                  Source systems
                </p>
                {integrations.map((integration, index) => (
                  <div
                    key={integration.name}
                    className={`rp-rise flex items-center gap-3 rounded-2xl border border-white bg-white/92 p-3 shadow-sm ${
                      index % 2 === 0 ? "mr-7" : "ml-7"
                    }`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white">
                      <Image
                        src={integration.logo}
                        alt={`${integration.name} logo`}
                        width={24}
                        height={24}
                        unoptimized
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{integration.name}</p>
                      <p className="mt-0.5 text-xs font-medium text-neutral-500">{integration.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative flex h-[430px] items-center justify-center overflow-hidden">
                <div className="absolute left-6 right-6 top-1/2 h-px bg-gradient-to-r from-sky-200 via-signal to-sky-200" />
                <div className="absolute left-8 top-[212px] h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_20px_rgba(2,132,199,0.55)] rp-flow-packet" />
                <div className="absolute left-8 top-[212px] h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.45)] rp-flow-packet rp-flow-packet-2" />
                <div className="absolute left-8 top-[212px] h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.45)] rp-flow-packet rp-flow-packet-3" />

                <div className="absolute left-3 top-12 rounded-2xl border border-sky-100 bg-white/90 p-3 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">Collect</p>
                  <p className="mt-1 text-sm font-semibold text-ink">signals</p>
                </div>

                <div className="absolute bottom-12 right-3 rounded-2xl border border-emerald-100 bg-white/90 p-3 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">Gate</p>
                  <p className="mt-1 text-sm font-semibold text-ink">action</p>
                </div>

                <div className="relative z-10 flex h-52 w-52 flex-col items-center justify-center rounded-full border border-sky-100 bg-white text-center shadow-2xl">
                  <div className="absolute inset-4 rounded-full border border-dashed border-sky-200" />
                  <div className="rp-float relative z-10 flex h-20 w-20 items-center justify-center rounded-2xl bg-signal text-white shadow-[0_24px_60px_rgba(2,132,199,0.32)]">
                    <ShieldCheck className="h-9 w-9" strokeWidth={1.8} />
                  </div>
                  <p className="relative z-10 mt-4 text-xl font-semibold text-ink">RunProof</p>
                  <p className="relative z-10 mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">
                    proof layer
                  </p>
                </div>
              </div>

              <div className="grid gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-neutral-400">
                  Reviewable output
                </p>
                {outputNodes.map((node) => {
                  const Icon = node.icon;

                  return (
                    <div
                      key={node.label}
                      className="group relative overflow-hidden rounded-2xl border border-white bg-white/94 p-4 shadow-sm"
                    >
                      <div className="absolute inset-y-0 left-0 w-1 bg-signal transition group-hover:w-1.5" />
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-signal">
                          <Icon className="h-5 w-5" strokeWidth={1.8} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-ink">{node.label}</p>
                            <ArrowRight className="h-3.5 w-3.5 text-signal" strokeWidth={2} />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-neutral-500">{node.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
