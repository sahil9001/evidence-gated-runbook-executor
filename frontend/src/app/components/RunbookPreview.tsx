"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCode2,
  GitPullRequest,
  LockKeyhole,
  ServerCog,
  Terminal,
  XCircle
} from "lucide-react";
import { Gauge } from "./Gauge";

export type TimelineEntry = {
  label: string;
  detail: string;
  state: "done" | "pending";
};

export type RunbookPreviewData = {
  riskScore: number;
  riskLabel: "High" | "Medium" | "Low";
  incidentTitle: string;
  runbookId: string;
  timeline: TimelineEntry[];
  sandboxOutput: string;
  actionDescription: string;
  gateState: "locked" | "approved" | "rejected";
  onApprove?: () => void;
  onReject?: () => void;
  isDeciding?: boolean;
};

export const DEMO_PREVIEW: RunbookPreviewData = {
  riskScore: 82,
  riskLabel: "High",
  incidentTitle: "Checkout incident",
  runbookId: "checkout-failure",
  timeline: [
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
  ],
  sandboxOutput: `timeout_ms=3000
failed_requests=47
likely_commit=8f31c2b
recommendation=rollback`,
  actionDescription: "rollback payment-service",
  gateState: "locked",
  onApprove: () => {},
  onReject: () => {},
  isDeciding: false
};

type RunbookPreviewProps = {
  className?: string;
  data?: RunbookPreviewData;
};

function sandboxPanelLabel(gateState: RunbookPreviewData["gateState"]): string {
  if (gateState === "approved") return "Execution output";
  if (gateState === "rejected") return "Rejection reason";
  return "Sandbox output";
}

function gateIcon(gateState: RunbookPreviewData["gateState"]) {
  if (gateState === "approved") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={1.8} />;
  }
  if (gateState === "rejected") {
    return <XCircle className="h-5 w-5 text-rose-600" strokeWidth={1.8} />;
  }
  return <LockKeyhole className="h-5 w-5 text-neutral-500" strokeWidth={1.8} />;
}

export function RunbookPreview({ className = "", data = DEMO_PREVIEW }: RunbookPreviewProps) {
  const isLocked = data.gateState === "locked";
  const approveDisabled = !isLocked || data.isDeciding === true || !data.onApprove;
  const reviewDisabled = !isLocked || data.isDeciding === true || !data.onReject;

  return (
    <div
      className={`mx-auto w-full max-w-[1180px] rounded-t-3xl rounded-b-none bg-panel p-3 pb-0 shadow-soft sm:p-5 sm:pb-0 lg:p-6 lg:pb-0 xl:max-w-[1280px] xl:p-7 xl:pb-0 2xl:max-w-[1440px] ${className}`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-5 xl:gap-6">
        <section className="rounded-2xl bg-white p-4 sm:p-5 xl:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-signal">Risk score</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                {data.incidentTitle}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              {data.riskLabel}
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-ink">{data.riskScore}</span>
            <span className="text-sm font-medium text-neutral-500">/ 100</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Based on logs, metrics, and latest deploy.
          </p>

          <div className="mt-4">
            <Gauge value={data.riskScore} color="#0284c7" showLabels min="Safe" max="Risky" />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 sm:p-5 xl:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-signal">Evidence trail</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                Runbook: {data.runbookId}
              </p>
            </div>
            <ServerCog className="h-5 w-5 text-neutral-500" strokeWidth={1.8} />
          </div>

          <div className="mt-4 space-y-3">
            {data.timeline.map((item) => (
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

        <section className="rounded-2xl bg-white p-4 sm:col-span-2 sm:p-5 lg:col-span-1 xl:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-signal">Approval gate</p>
              <p className="mt-1 text-xs font-medium text-neutral-500">
                Action: {data.actionDescription}
              </p>
              {!isLocked ? (
                <p className="mt-1 text-xs font-semibold text-neutral-700">
                  Decision: {data.gateState}
                </p>
              ) : null}
            </div>
            {gateIcon(data.gateState)}
          </div>

          <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <Terminal className="h-3.5 w-3.5" strokeWidth={2} />
              {sandboxPanelLabel(data.gateState)}
            </div>
            <pre className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-600">
              {data.sandboxOutput}
            </pre>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={data.onApprove}
              disabled={approveDisabled}
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              {data.isDeciding ? "Approving..." : "Approve"}
            </button>
            <button
              type="button"
              onClick={data.onReject}
              disabled={reviewDisabled}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <FileCode2 className="h-4 w-4" strokeWidth={1.8} />
              Review
            </button>
            <button
              type="button"
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 transition hover:bg-neutral-50"
            >
              <GitPullRequest className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
