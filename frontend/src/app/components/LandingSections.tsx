import Image from "next/image";
import {
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileSearch,
  FlaskConical,
  GitPullRequest,
  LockKeyhole,
  ServerCog,
  ShieldCheck,
  Terminal
} from "lucide-react";

const evidenceItems = [
  "Recent deploy metadata",
  "Error-rate spike window",
  "Runbook step coverage",
  "Sandbox reproduction output"
];

const flowSteps = [
  {
    title: "Read the runbook",
    body: "The agent starts from a Markdown or YAML checklist, not a vague prompt.",
    icon: ClipboardCheck
  },
  {
    title: "Collect signals",
    body: "It pulls logs, metrics, commits, and service context into one evidence packet.",
    icon: FileSearch
  },
  {
    title: "Run diagnostics",
    body: "Generated scripts execute in isolation before any production action is suggested.",
    icon: FlaskConical
  },
  {
    title: "Ask for approval",
    body: "Risky actions remain locked until the engineer reviews the proof.",
    icon: LockKeyhole
  }
];

const workflowMoments = [
  "Checkout alert arrives",
  "Runbook is selected",
  "Logs and deploys are checked",
  "Diagnostic script runs",
  "Rollback is recommended",
  "Approval unlocks action"
];

const controlRows = [
  {
    label: "Allowed automatically",
    value: "Read logs, inspect metrics, search commits"
  },
  {
    label: "Sandbox only",
    value: "Generate scripts, test theories, parse evidence"
  },
  {
    label: "Approval required",
    value: "Rollback, restart, open PR, change config"
  }
];

const executionSignals = [
  "Tool call starts from a scoped runbook",
  "Sandbox output is shown before recommendation",
  "Approval gate blocks production actions"
];

const footerLinks = [
  {
    title: "Product",
    links: ["Runbooks", "Evidence packets", "Sandbox checks"]
  },
  {
    title: "Workflow",
    links: ["Incident preview", "Controlled execution", "Approval gate"]
  },
  {
    title: "Platform",
    links: ["Runbook library", "Cloudflare-ready", "Private deployment"]
  }
];

export function LandingSections() {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pt-4 sm:gap-5 sm:pt-5">
      <section
        id="runbooks"
        className="overflow-hidden rounded-2xl bg-white shadow-sm sm:rounded-3xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col justify-center px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal text-white">
              <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl">
              A runbook executor that behaves like a careful{" "}
              <span className="font-serif italic font-normal leading-[1.1]">
                operator
              </span>
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-neutral-600 sm:text-base">
              RunProof gives the agent a narrow incident path: follow the
              checklist, collect proof, run diagnostics, and pause before the
              risky part.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {flowSteps.map((step) => {
                const Icon = step.icon;

                return (
                  <div
                    key={step.title}
                    className="rounded-2xl border border-neutral-200 bg-[#fbfaf8] p-4"
                  >
                    <Icon className="h-5 w-5 text-signal" strokeWidth={1.8} />
                    <h3 className="mt-3 text-sm font-semibold text-ink">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-5 text-neutral-600">
                      {step.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative min-h-[460px] bg-panel p-4 sm:p-6 lg:p-8">
            <div className="relative h-full min-h-[420px] overflow-hidden rounded-3xl bg-white">
              <Image
                src="/illustrations/evidence-gathering.png"
                alt="Soft illustration of logs, metrics, and runbook pages converging into evidence"
                fill
                sizes="(min-width: 1024px) 560px, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur-md sm:inset-x-6 sm:bottom-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      Evidence packet
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      Generated from the current incident session.
                    </p>
                  </div>
                  <span className="rounded-full bg-signal px-3 py-1 text-xs font-semibold text-white">
                    Ready
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {evidenceItems.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-neutral-700"
                    >
                      <CheckCircle2
                        className="h-4 w-4 shrink-0 text-signal"
                        strokeWidth={1.8}
                      />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="evidence"
        className="overflow-hidden rounded-2xl bg-white shadow-sm sm:rounded-3xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
            <article>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal text-white">
                <ServerCog className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
                Show the governed execution path
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-neutral-600 sm:text-base">
                RunProof makes every step inspectable: scoped tool access,
                sandbox diagnostics, evidence-backed recommendations, and a
                locked production action.
              </p>

              <div className="mt-7 space-y-3">
                {executionSignals.map((signal) => (
                  <div
                    key={signal}
                    className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-[#fbfaf8] p-4"
                  >
                    <CheckCircle2
                      className="h-5 w-5 shrink-0 text-signal"
                      strokeWidth={1.8}
                    />
                    <p className="text-sm font-semibold text-neutral-800">
                      {signal}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article
              id="sandbox"
              className="mt-5 rounded-2xl bg-ink p-5 text-white sm:p-6"
            >
              <div className="flex items-center gap-3">
                <Terminal className="h-5 w-5 text-signal" strokeWidth={1.8} />
                <h3 className="text-base font-semibold">
                  Execution trace
                </h3>
              </div>
              <pre className="mt-4 overflow-hidden rounded-2xl bg-white/8 p-4 text-[12px] leading-6 text-white/75 ring-1 ring-white/10">
{`runbook: checkout-failure
tool: sandbox.exec
result: reproduced timeout
next: request rollback approval`}
              </pre>
            </article>
          </div>

          <div className="bg-panel p-4 sm:p-6 lg:p-8">
            <div className="relative min-h-[520px] overflow-hidden rounded-3xl bg-[#f7f4ef]">
              <Image
                src="/illustrations/sandbox-diagnostics.png"
                alt="Soft illustration of diagnostics running inside a protected sandbox"
                fill
                sizes="(min-width: 1024px) 620px, 100vw"
                className="object-contain p-6 sm:p-8 lg:p-10"
              />
              <div className="absolute left-4 top-4 rounded-2xl border border-white/80 bg-white/85 px-4 py-3 shadow-sm backdrop-blur-md sm:left-6 sm:top-6">
                <p className="text-xs font-semibold text-signal">
                  Governed workflow
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  Evidence before execution
                </p>
              </div>
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm backdrop-blur-md sm:inset-x-6 sm:bottom-6">
                <h3 className="text-sm font-semibold text-ink">
                  What runs where
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {controlRows.map((row) => (
                    <div
                      key={row.label}
                      className="rounded-xl bg-white px-3 py-3 ring-1 ring-neutral-200"
                    >
                      <p className="text-[11px] font-semibold text-signal">
                        {row.label}
                      </p>
                      <p className="mt-1 text-xs leading-4 text-neutral-700">
                        {row.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="approval"
        className="overflow-hidden rounded-2xl bg-white shadow-sm sm:rounded-3xl"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="relative min-h-[420px] bg-panel">
            <Image
              src="/illustrations/approval-control.png"
              alt="Soft illustration of an approval gate protecting a production action"
              fill
              sizes="(min-width: 1024px) 480px, 100vw"
              className="object-cover"
            />
          </div>

          <div className="px-5 py-10 sm:px-8 sm:py-14 lg:px-12">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal text-white">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl">
              Human approval is the final proof point
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
              RunProof keeps risky actions locked until the operator can review
              the evidence packet, sandbox output, and recommended change.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {workflowMoments.map((moment, index) => (
                <div
                  key={moment}
                  className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-[#fbfaf8] p-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-signal shadow-sm">
                    {index + 1}
                  </span>
                  <p className="text-sm font-semibold text-neutral-800">
                    {moment}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-8 rounded-2xl bg-ink p-5 text-white">
              <div className="flex flex-wrap items-center gap-3">
                <LockKeyhole className="h-5 w-5 text-signal" strokeWidth={1.8} />
                <p className="text-sm font-semibold">
                  Approval request: rollback payment-service
                </p>
                <span className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80">
                  Waiting
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-white/65">
                The action button stays locked until the evidence packet and
                sandbox output are reviewed.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-2xl bg-panel px-5 py-10 text-center sm:rounded-3xl sm:px-8 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <Clock3 className="mx-auto h-7 w-7 text-signal" strokeWidth={1.8} />
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">
            A clear path from alert to action
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
            Start with an alert, gather evidence, run a sandbox check, explain
            the recommendation, then unlock the approved action.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#product-preview"
              className="inline-flex items-center justify-center rounded-full bg-signal px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:translate-y-[-1px] active:translate-y-0"
            >
              Open product preview
            </a>
            <a
              href="#runbooks"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink shadow-sm ring-1 ring-neutral-200 transition hover:translate-y-[-1px] active:translate-y-0"
            >
              <GitPullRequest className="h-4 w-4 text-signal" strokeWidth={1.8} />
              Review flow
            </a>
          </div>
        </div>
      </section>

      <footer className="overflow-hidden rounded-2xl bg-ink text-white sm:rounded-3xl">
        <div className="px-5 py-9 sm:px-8 sm:py-12 lg:px-12">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-sm font-semibold text-white/65">
                Evidence-gated runbooks for safer agentic operations.
              </p>
              <h2 className="mt-5 text-6xl font-bold leading-none text-white sm:text-8xl lg:text-9xl">
                RunProof
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {footerLinks.map((group) => (
                <div key={group.title}>
                  <h3 className="text-sm font-semibold text-white">
                    {group.title}
                  </h3>
                  <ul className="mt-4 space-y-2 text-sm text-white/60">
                    {group.links.map((link) => (
                      <li key={link}>{link}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-5 text-sm text-white/50 sm:flex-row sm:items-center sm:justify-between">
            <p>Built for incident teams that need proof before action.</p>
            <a
              href="#product-preview"
              className="inline-flex w-fit items-center justify-center rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink transition hover:translate-y-[-1px] active:translate-y-0"
            >
              Explore product
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
