import Image from "next/image";
import { CheckCircle2, LockKeyhole, ShieldCheck, Terminal } from "lucide-react";
import { Accent, Eyebrow, Section, SectionHeading } from "./Section";
import { integrations } from "../landingContent";

const outputNodes = [
  {
    body: "Deploys, traces, logs, and metrics are grouped for review.",
    icon: CheckCircle2,
    label: "Evidence packet"
  },
  {
    body: "Diagnostics run before production is touched.",
    icon: Terminal,
    label: "Sandbox replay"
  },
  {
    body: "The action stays locked until a person approves.",
    icon: LockKeyhole,
    label: "Approval request"
  }
];

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
      {children}
    </p>
  );
}

export function IntegrationSection() {
  return (
    <Section id="integrations" className="border-t border-sky-100/70 bg-white">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Eyebrow>Integrations</Eyebrow>
          <span className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            <span className="rp-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live context flow
          </span>
        </div>
          <SectionHeading
            className="mt-6"
            title={
              <>
                Designed for the stack that already wakes you <Accent>up</Accent>.
              </>
            }
            lead="Connect the tools that create incident context, then move the work through one visible proof and approval flow."
          />
      </div>

      <div className="relative mt-12 overflow-hidden rounded-3xl border border-sky-100 bg-[#f6fafe] p-5 sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(2,132,199,0.06)_1px,transparent_1px),linear-gradient(0deg,rgba(2,132,199,0.06)_1px,transparent_1px)] bg-[length:40px_40px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(14,165,233,0.16),transparent_46%)]" />

        {/* Stacks on small screens instead of forcing a 940px horizontal
            scroll region. */}
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:gap-6">
          <div>
            <ColumnLabel>Source systems</ColumnLabel>
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {integrations.map((integration, index) => (
                <li
                  key={integration.name}
                  className={`rp-rise rp-rise-${(index % 5) + 1} flex items-center gap-3 rounded-xl border border-sky-100 bg-white/95 p-3 transition hover:border-sky-200`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white">
                    <Image
                      src={integration.logo}
                      alt={`${integration.name} logo`}
                      width={26}
                      height={26}
                      unoptimized
                      className="h-[26px] w-[26px] object-contain"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {integration.name}
                    </span>
                    <span className="mt-0.5 block text-xs font-medium text-neutral-500">
                      {integration.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative flex items-center justify-center py-4 lg:self-center lg:px-8 lg:py-0">
            {/* Connector rail: horizontal on desktop, vertical when stacked. */}
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-sky-300 to-transparent lg:left-0 lg:top-1/2 lg:h-px lg:w-full lg:-translate-x-0 lg:-translate-y-1/2 lg:bg-gradient-to-r"
            />
            <span
              aria-hidden="true"
              className="rp-flow-packet absolute left-1/2 top-1/2 hidden h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-signal lg:block"
              style={{ left: "0.5rem" }}
            />
            <span
              aria-hidden="true"
              className="rp-flow-packet rp-flow-packet-2 absolute left-1/2 top-1/2 hidden h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-emerald-500 lg:block"
              style={{ left: "0.5rem" }}
            />

            <div className="relative z-10 flex h-40 w-40 flex-col items-center justify-center rounded-full border border-sky-100 bg-white text-center shadow-[0_16px_40px_rgb(2_132_199/0.1)]">
              <span aria-hidden="true" className="absolute inset-3 rounded-full border border-dashed border-sky-200" />
              <span className="rp-float relative flex h-16 w-16 items-center justify-center rounded-2xl bg-signal text-white shadow-[0_10px_28px_rgb(2_132_199/0.3)]">
                <ShieldCheck className="h-8 w-8" strokeWidth={1.8} />
              </span>
              <p className="relative mt-3 text-base font-semibold text-ink">RunProof</p>
              <p className="relative text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">
                proof layer
              </p>
            </div>
          </div>

          <div>
            <ColumnLabel>Reviewable output</ColumnLabel>
            <ul className="grid gap-2.5">
              {outputNodes.map((node) => {
                const Icon = node.icon;

                return (
                  <li
                    key={node.label}
                    className="group relative overflow-hidden rounded-xl border border-sky-100 bg-white/95 p-4 pl-5 transition hover:border-sky-200"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1 bg-signal transition-all group-hover:w-1.5"
                    />
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-signal">
                        <Icon className="h-4.5 w-4.5" strokeWidth={1.9} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{node.label}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">{node.body}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
