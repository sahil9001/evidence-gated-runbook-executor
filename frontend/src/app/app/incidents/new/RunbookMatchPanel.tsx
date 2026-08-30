import type { ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, FileText, GitPullRequest, Lock, Terminal } from "lucide-react";
import type { ApiClientError } from "../../../../lib/api";
import type { EvidenceSourceKind, Runbook } from "../../../../lib/types";

const SOURCE_ICONS: Readonly<Record<EvidenceSourceKind, typeof FileText>> = {
  logs: FileText,
  metrics: Activity,
  deploys: GitPullRequest,
  sandbox: Terminal
};

const SOURCE_LABELS: Readonly<Record<EvidenceSourceKind, string>> = {
  logs: "logs",
  metrics: "metrics",
  deploys: "deploys",
  sandbox: "sandbox output"
};

function listSources(sources: readonly EvidenceSourceKind[]): string {
  const labels = sources.map((source) => SOURCE_LABELS[source]);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

interface PanelShellProps {
  readonly children: ReactNode;
}

function PanelShell({ children }: PanelShellProps) {
  return (
    <section className="flex flex-col gap-4 border-l-2 border-signal bg-sky-50/70 p-5 sm:p-6">{children}</section>
  );
}

function PromptForService() {
  return (
    <PanelShell>
      <p className="text-sm font-semibold text-signal">Runbook match</p>
      <p className="text-sm text-neutral-600">
        Enter a service to see which runbook would run — and exactly what the agent would be allowed to touch.
      </p>
    </PanelShell>
  );
}

function LoadingRunbooks() {
  return (
    <PanelShell>
      <p className="text-sm font-semibold text-signal">Runbook match</p>
      <div className="animate-pulse space-y-3" role="status" aria-label="Loading runbooks">
        <div className="h-4 w-2/3 rounded-full bg-white/70" />
        <div className="h-3 w-full rounded-full bg-white/50" />
        <div className="h-3 w-5/6 rounded-full bg-white/50" />
      </div>
    </PanelShell>
  );
}

interface RunbooksErrorProps {
  readonly error: ApiClientError;
  readonly onRetry: () => void;
}

function RunbooksError({ error, onRetry }: RunbooksErrorProps) {
  return (
    <PanelShell>
      <p className="text-sm font-semibold text-signal">Runbook match</p>
      <p className="text-sm text-rose-700">Could not load runbooks: {error.message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="self-start rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
      >
        Retry
      </button>
    </PanelShell>
  );
}

function NoMatch() {
  return (
    <PanelShell>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-rose-800">No runbook matches this service and these signals.</p>
          <p className="mt-1 text-xs text-rose-700">
            RunProof never starts a run without a runbook defining its scope — that would mean an agent with no
            authorised sources and no proposed action. Add or adjust signals, or check the service name, until a
            single runbook matches.
          </p>
        </div>
      </div>
    </PanelShell>
  );
}

interface MatchedRunbookProps {
  readonly runbook: Runbook;
}

function MatchedRunbook({ runbook }: MatchedRunbookProps) {
  return (
    <PanelShell>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-signal">This run would follow</p>
          <p className="text-sm font-semibold text-ink">{runbook.title}</p>
        </div>
      </div>

      <div className="border border-sky-100 bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
          <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Scope: what the agent will be permitted to read
        </div>
        <p className="mt-2 text-sm text-ink">
          This runbook lets the agent read {listSources(runbook.allowedSources)}. Nothing else.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {runbook.allowedSources.map((source) => {
            const Icon = SOURCE_ICONS[source];
            return (
              <span
                key={source}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700"
              >
                <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {source}
              </span>
            );
          })}
        </div>
      </div>

      <div className="border border-sky-100 bg-white p-4">
        <p className="text-xs font-semibold text-neutral-700">Steps</p>
        <ol className="mt-2 space-y-2">
          {runbook.steps.map((step) => (
            <li key={step.id} className="text-xs text-neutral-600">
              <span className="font-semibold text-ink">{step.label}.</span> {step.detail}
            </li>
          ))}
        </ol>
      </div>

      <div className="border border-sky-100 bg-white p-4">
        <p className="text-xs font-semibold text-neutral-700">Proposed action (locked until approved)</p>
        <p className="mt-1 text-sm text-ink">{runbook.proposedAction.description}</p>
      </div>
    </PanelShell>
  );
}

interface RunbookMatchPanelProps {
  readonly service: string;
  readonly runbooksState:
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly error: ApiClientError }
    | { readonly status: "loaded"; readonly data: readonly Runbook[] };
  readonly matchedRunbook: Runbook | null;
  readonly onRetry: () => void;
}

/**
 * The centerpiece of the create flow: shows the operator exactly what
 * `matchRunbook` (mirrored client-side in `lib/matchRunbook.ts`) would
 * select on the backend, before anything starts — the scope contract, not
 * just a preview.
 */
export function RunbookMatchPanel({ service, runbooksState, matchedRunbook, onRetry }: RunbookMatchPanelProps) {
  if (runbooksState.status === "loading") return <LoadingRunbooks />;
  if (runbooksState.status === "error") return <RunbooksError error={runbooksState.error} onRetry={onRetry} />;
  if (service.trim().length === 0) return <PromptForService />;
  if (matchedRunbook === null) return <NoMatch />;
  return <MatchedRunbook runbook={matchedRunbook} />;
}
