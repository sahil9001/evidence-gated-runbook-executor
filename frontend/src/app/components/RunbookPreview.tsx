import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode2,
  GitPullRequest,
  LockKeyhole,
  ServerCog,
  Terminal
} from "lucide-react";
import { Gauge } from "./Gauge";

const timeline = [
  {
    label: "Alert received",
    detail: "Checkout error rate increased on payment-service.",
    state: "done"
  },
  {
    label: "Evidence gathered",
    detail: "Logs, deploy history, and metrics agree on one likely cause.",
    state: "done"
  },
  {
    label: "Sandbox check",
    detail: "Diagnostic script reproduced timeout failure in isolation.",
    state: "done"
  },
  {
    label: "Approval required",
    detail: "Rollback stays locked until an engineer approves it.",
    state: "pending"
  }
];

export function RunbookPreview() {
  return (
    <div className="mx-auto w-full max-w-[940px] rounded-3xl bg-panel p-4 shadow-soft sm:p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        <section className="rounded-2xl bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-signal">Risk score</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                Checkout incident
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              High
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-ink">82</span>
            <span className="text-sm font-medium text-neutral-500">/ 100</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Based on logs, metrics, and latest deploy.
          </p>

          <div className="mt-4">
            <Gauge value={82} color="#ef4d23" showLabels min="Safe" max="Risky" />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-signal">Evidence trail</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                Runbook: checkout-failure
              </p>
            </div>
            <ServerCog className="h-5 w-5 text-neutral-500" strokeWidth={1.8} />
          </div>

          <div className="mt-4 space-y-3">
            {timeline.map((item) => (
              <div key={item.label} className="grid grid-cols-[20px_1fr] gap-3">
                <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100">
                  {item.state === "done" ? (
                    <CheckCircle2
                      className="h-3.5 w-3.5 text-signal"
                      strokeWidth={2}
                    />
                  ) : (
                    <Clock3
                      className="h-3.5 w-3.5 text-neutral-500"
                      strokeWidth={2}
                    />
                  )}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{item.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-signal">Approval gate</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                Action: rollback payment-service
              </p>
            </div>
            <LockKeyhole className="h-5 w-5 text-neutral-500" strokeWidth={1.8} />
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <Terminal className="h-3.5 w-3.5" strokeWidth={2} />
              Sandbox output
            </div>
            <pre className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-600">
{`timeout_ms=3000
failed_requests=47
likely_commit=8f31c2b
recommendation=rollback`}
            </pre>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              Approve
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50">
              <FileCode2 className="h-4 w-4" strokeWidth={1.8} />
              Review
            </button>
            <button className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition hover:bg-neutral-50">
              <GitPullRequest className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
