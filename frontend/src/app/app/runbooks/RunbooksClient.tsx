"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertOctagon, Eye, FileText, GitPullRequest, Lock, ScrollText, ShieldAlert, Terminal } from "lucide-react";
import { ApiClientError, listRunbooks } from "../../../lib/api";
import { STATE_CHANGING_ACTION_KINDS, type EvidenceSourceKind, type Runbook, type RunbookStep } from "../../../lib/types";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  network_error: "Could not reach the RunProof API. Check your connection.",
  invalid_response: "The server sent back a response we couldn't understand.",
  internal_error: "Something went wrong on the server.",
  unauthenticated: "Your session has expired. Sign in again."
};

function humanizeErrorCode(code: string): string {
  return ERROR_MESSAGES[code] ?? `Something went wrong (${code}).`;
}

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

/** Same icon language as the create-incident flow's runbook match preview
 * (`incidents/new/RunbookMatchPanel.tsx`) — kept as its own copy here since
 * that file is a different feature's local module, not a shared export. */
const SOURCE_ICONS: Readonly<Record<EvidenceSourceKind, typeof FileText>> = {
  logs: FileText,
  metrics: Activity,
  deploys: GitPullRequest,
  sandbox: Terminal
};

type RunbooksState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: readonly Runbook[] };

interface ScopeSectionProps {
  readonly allowedSources: readonly EvidenceSourceKind[];
}

/**
 * The headline of the card, not a footnote: this is the answer to "what
 * could this thing touch in production?" — the only evidence sources the
 * agent is permitted to read while this runbook runs.
 */
function ScopeSection({ allowedSources }: ScopeSectionProps) {
  return (
    <div className="rounded-2xl border-2 border-signal/25 bg-panel p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-signal">
        <Lock className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        Scope — permitted to read
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {allowedSources.map((source) => {
          const Icon = SOURCE_ICONS[source];
          return (
            <span
              key={source}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-sm"
            >
              <Icon className="h-3.5 w-3.5 text-signal" strokeWidth={2} aria-hidden="true" />
              {source}
            </span>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-neutral-500">Nothing outside this list is readable under this runbook.</p>
    </div>
  );
}

interface TriggerRowProps {
  readonly trigger: Runbook["trigger"];
}

function TriggerRow({ trigger }: TriggerRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center rounded-full bg-ink px-3 py-1 font-semibold text-white">
        {trigger.service}
      </span>
      {trigger.signals.map((signal) => (
        <span key={signal} className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-600">
          {signal}
        </span>
      ))}
    </div>
  );
}

interface StepsListProps {
  readonly steps: readonly RunbookStep[];
}

function StepsList({ steps }: StepsListProps) {
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
        <ScrollText className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        Steps
      </div>
      <ol className="mt-3 flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3 text-xs">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-panel text-[11px] font-bold text-signal">
              {index + 1}
            </span>
            <span>
              <span className="font-semibold text-ink">{step.label}.</span>{" "}
              <span className="text-neutral-600">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface ProposedActionCardProps {
  readonly action: Runbook["proposedAction"];
}

function ProposedActionCard({ action }: ProposedActionCardProps) {
  const isStateChanging = STATE_CHANGING_ACTION_KINDS.includes(action.kind);
  return (
    <div className="rounded-2xl bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-neutral-700">Proposed action</p>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            isStateChanging ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {isStateChanging ? (
            <ShieldAlert className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <Eye className="h-3 w-3" strokeWidth={2.4} aria-hidden="true" />
          )}
          {isStateChanging ? "State-changing" : "Read-only"}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink">{action.description}</p>
      <p className="mt-1 text-xs text-neutral-500">
        Target: {action.target} · {action.reversible ? "Reversible" : "Not reversible"}
      </p>
      <p className="mt-3 text-xs text-neutral-500">
        Stays locked until an engineer approves it — evidence-gated, never automatic.
      </p>
    </div>
  );
}

interface RunbookCardProps {
  readonly runbook: Runbook;
}

function RunbookCard({ runbook }: RunbookCardProps) {
  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-soft">
      <header className="bg-ink p-6 text-white sm:p-7">
        <h2 className="text-lg font-semibold">{runbook.title}</h2>
        <div className="mt-3">
          <TriggerRow trigger={runbook.trigger} />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 p-5 sm:p-6 lg:grid-cols-[1fr_1.1fr] lg:gap-6">
        <ScopeSection allowedSources={runbook.allowedSources} />
        <div className="flex flex-col gap-4">
          <StepsList steps={runbook.steps} />
          <ProposedActionCard action={runbook.proposedAction} />
        </div>
      </div>
    </article>
  );
}

function RunbooksSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading runbooks">
      {[0, 1].map((row) => (
        <div key={row} className="animate-pulse overflow-hidden rounded-3xl bg-white shadow-soft">
          <div className="h-24 bg-neutral-200" />
          <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="h-28 rounded-2xl bg-neutral-100" />
            <div className="flex flex-col gap-4">
              <div className="h-24 rounded-2xl bg-neutral-100" />
              <div className="h-20 rounded-2xl bg-neutral-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface RunbooksErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function RunbooksError({ error, onRetry }: RunbooksErrorProps) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-soft sm:p-8">
      <p className="text-sm font-semibold text-rose-700">Could not load runbooks</p>
      <p className="mt-1 text-sm text-neutral-600">{humanizeErrorCode(error.code)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        Retry
      </button>
    </div>
  );
}

function EmptyRunbooks() {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl bg-white px-6 py-16 text-center shadow-soft">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel text-signal">
        <AlertOctagon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink">No runbooks configured yet.</p>
      <p className="max-w-sm text-xs text-neutral-500">
        Nothing has been authorised for the agent to run. Add a runbook to define its scope and proposed action.
      </p>
    </section>
  );
}

export function RunbooksClient() {
  const [state, setState] = useState<RunbooksState>({ status: "loading" });

  const fetchRunbooks = useCallback((): Promise<void> => {
    return listRunbooks()
      .then((data) => setState({ status: "loaded", data }))
      .catch((error: unknown) => setState({ status: "error", error: toApiClientError(error) }));
  }, []);

  useEffect(() => {
    void fetchRunbooks();
  }, [fetchRunbooks]);

  function handleRetry(): void {
    setState({ status: "loading" });
    void fetchRunbooks();
  }

  if (state.status === "loading") return <RunbooksSkeleton />;
  if (state.status === "error") return <RunbooksError error={state.error} onRetry={handleRetry} />;
  if (state.data.length === 0) return <EmptyRunbooks />;

  return (
    <div className="flex flex-col gap-4">
      {state.data.map((runbook) => (
        <RunbookCard key={runbook.id} runbook={runbook} />
      ))}
    </div>
  );
}
