"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { ApiClientError, createIncident, listRunbooks, startRun } from "../../../../lib/api";
import { matchRunbook } from "../../../../lib/matchRunbook";
import type { Runbook } from "../../../../lib/types";
import { SignalTagInput } from "./SignalTagInput";
import { RunbookMatchPanel } from "./RunbookMatchPanel";

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

type RunbooksState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: Runbook[] };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "run-failed"; incidentId: string; message: string };

/**
 * The service + signals form that decides what the agent will be allowed to
 * touch. The runbook match is computed client-side with the exact rule the
 * backend enforces (`lib/matchRunbook.ts`) so the operator sees, before
 * submitting, precisely what `POST /incidents/:id/run` will decide — a tie
 * or zero overlap disables submission rather than starting a run with no
 * defined scope.
 */
export function NewIncidentClient() {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [service, setService] = useState("");
  const [signals, setSignals] = useState<string[]>([]);

  const [runbooksState, setRunbooksState] = useState<RunbooksState>({ status: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  // Mirrors OverviewClient's pattern: the effect body only ever calls
  // `setState` from inside a `.then`/`.catch` callback, never synchronously —
  // the initial "loading" state is already the `useState` default, so no
  // separate kickoff is needed. `handleRetryRunbooks` below is the only
  // place that resets to "loading" synchronously, and it only ever runs from
  // a click handler, not an effect.
  const fetchRunbooks = useCallback((): Promise<void> => {
    return listRunbooks()
      .then((data) => setRunbooksState({ status: "loaded", data }))
      .catch((error: unknown) => setRunbooksState({ status: "error", error: toApiClientError(error) }));
  }, []);

  useEffect(() => {
    void fetchRunbooks();
  }, [fetchRunbooks]);

  function handleRetryRunbooks(): void {
    setRunbooksState({ status: "loading" });
    void fetchRunbooks();
  }

  const knownSignals = useMemo(() => {
    if (runbooksState.status !== "loaded") return [];
    const unique = new Set<string>();
    for (const runbook of runbooksState.data) {
      for (const signal of runbook.trigger.signals) unique.add(signal);
    }
    return Array.from(unique);
  }, [runbooksState]);

  const matchedRunbook = useMemo(() => {
    if (runbooksState.status !== "loaded") return null;
    const trimmedService = service.trim();
    if (trimmedService.length === 0) return null;
    return matchRunbook(runbooksState.data, { service: trimmedService, signals });
  }, [runbooksState, service, signals]);

  const canSubmit =
    title.trim().length > 0 && matchedRunbook !== null && submitState.status !== "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || matchedRunbook === null) return;

    setSubmitState({ status: "submitting" });

    const trimmedTitle = title.trim();
    const trimmedService = service.trim();

    try {
      const incident = await createIncident({ title: trimmedTitle, service: trimmedService, signals });

      try {
        const result = await startRun(incident.id);
        router.push(`/app/runs/${result.run.id}`);
      } catch (runError: unknown) {
        // The incident exists even though the run didn't start — never
        // strand the operator on a screen with no reference to it.
        setSubmitState({
          status: "run-failed",
          incidentId: incident.id,
          message: toApiClientError(runError).message
        });
      }
    } catch (createError: unknown) {
      setSubmitState({ status: "error", message: toApiClientError(createError).message });
    }
  }

  const isSubmitting = submitState.status === "submitting";

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="flex flex-col gap-5">
        {submitState.status === "error" ? (
          <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            Could not create the incident: {submitState.message}
          </div>
        ) : null}

        {submitState.status === "run-failed" ? (
          <div role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              The incident was created, but the run failed to start.
            </p>
            <p className="mt-1 text-xs text-amber-800">{submitState.message}</p>
            <Link
              href={`/app/incidents/${encodeURIComponent(submitState.incidentId)}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2"
            >
              View the incident
              <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="incident-title" className="text-sm font-semibold text-ink">
            Title
          </label>
          <input
            id="incident-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Checkout errors spiking"
            className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-neutral-400 focus:border-signal focus:ring-2 focus:ring-signal/30"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="incident-service" className="text-sm font-semibold text-ink">
            Service
          </label>
          <input
            id="incident-service"
            type="text"
            value={service}
            onChange={(event) => setService(event.target.value)}
            placeholder="payment-service"
            list="known-service-suggestions"
            className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-neutral-400 focus:border-signal focus:ring-2 focus:ring-signal/30"
          />
          <datalist id="known-service-suggestions">
            {runbooksState.status === "loaded"
              ? Array.from(new Set(runbooksState.data.map((runbook) => runbook.trigger.service))).map((svc) => (
                  <option key={svc} value={svc} />
                ))
              : null}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Signals</span>
          <SignalTagInput signals={signals} onChange={setSignals} suggestions={knownSignals} />
          <p className="text-xs text-neutral-500">
            What was observed — e.g. timeout, error_rate. Add as many as apply.
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-signal px-4 py-2.5 text-sm font-semibold text-white transition hover:translate-y-[-1px] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" /> : null}
          {isSubmitting ? "Starting run…" : "Start run"}
        </button>
      </section>

      <RunbookMatchPanel
        service={service}
        runbooksState={runbooksState}
        matchedRunbook={matchedRunbook}
        onRetry={handleRetryRunbooks}
      />
    </form>
  );
}
