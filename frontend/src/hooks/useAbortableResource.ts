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
 */
export function useAbortableResource<T>(fetcher: (signal: AbortSignal) => Promise<T>): {
  readonly state: AbortableResourceState<T>;
  readonly retry: () => void;
} {
  const [state, setState] = useState<AbortableResourceState<T>>({ status: "loading" });
  const [retryToken, setRetryToken] = useState(0);

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
    setState({ status: "loading" });
    setRetryToken((token) => token + 1);
  }, []);

  return { state, retry };
}
