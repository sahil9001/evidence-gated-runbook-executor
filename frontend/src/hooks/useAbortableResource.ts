"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "../lib/api";

export type AbortableResourceState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "loaded"; data: T };

function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  const message = error instanceof Error ? error.message : "Unexpected error";
  return new ApiClientError(message, "unknown_error", 0);
}

/**
 * Runs `fetcher` whenever it changes — typically because a `useCallback`
 * dependency (a filter, an id) changed — and keeps `state` in sync with
 * only the LATEST call.
 *
 * Fixes a race present anywhere a fetch is re-triggered by a changeable
 * filter: a slow older request can otherwise resolve (with data OR an
 * error) after a faster newer one starts, and clobber the newer result
 * with stale data or an obsolete error. Every previous in-flight call is
 * aborted — via the `AbortSignal` handed to `fetcher`, which callers pass
 * straight into an api.ts call's own `signal` parameter — before the next
 * one starts, and its resolution/rejection is ignored once aborted. This
 * both discards the stale write AND cancels the wasted network work,
 * rather than merely ignoring a response that still ran to completion.
 * The same cancellation fires on unmount, via the effect's cleanup.
 *
 * `state` is also reset to `{ status: "loading" }` the instant `fetcher`
 * changes, before the replacement request is even sent — not only once it
 * resolves. Without this, a screen driven by a changeable filter
 * (Incidents, History, Audit) would keep showing the PREVIOUS filter's
 * rows, under the NEWLY selected filter's label, for as long as the
 * replacement request takes — indefinitely, if it hangs. That is actively
 * misleading for an operator triaging incidents, worse than showing a
 * loading skeleton. A full loading reset was chosen over a "stale" state
 * that dims the old rows: every consumer already renders a
 * `status === "loading"` skeleton, so this fix lives entirely in this
 * shared hook with no screen-side changes, and it can never be confused
 * with data that merely hasn't refreshed yet — the two are visually
 * identical to an initial load, which is the honest state to show.
 */
export function useAbortableResource<T>(fetcher: (signal: AbortSignal) => Promise<T>): {
  readonly state: AbortableResourceState<T>;
  readonly retry: () => void;
} {
  const [state, setState] = useState<AbortableResourceState<T>>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  // React's "adjusting state when a prop changes" pattern: reset during
  // render, before the replacement fetch is even sent, so the previous
  // filter's rows are never painted under the new filter's label — see the
  // doc comment above. Doing this here rather than inside the effect below
  // matters twice over: React re-runs this render immediately without
  // committing the stale rows (an effect would let them paint first), and
  // there is no extra mount render for a caller whose `fetcher` is a new
  // closure each render to turn into an infinite loop.
  // `useState(() => fetcher)` is the lazy-initializer form on purpose:
  // `useState(fetcher)` would CALL the fetcher instead of storing it.
  const [activeFetcher, setActiveFetcher] = useState(() => fetcher);
  if (fetcher !== activeFetcher) {
    setActiveFetcher(() => fetcher);
    setState({ status: "loading" });
  }

  useEffect(() => {
    const controller = new AbortController();

    fetcher(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: "loaded", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: toApiClientError(error) });
      });

    return () => controller.abort();
  }, [fetcher, retryToken]);

  const retry = useCallback(() => {
    // A retry keeps the same `fetcher`, so the render-phase reset above
    // does not fire for it — an event handler is the right place to reset
    // this one, and setting state from one is always safe.
    setState({ status: "loading" });
    setRetryToken((token) => token + 1);
  }, []);

  return { state, retry };
}
