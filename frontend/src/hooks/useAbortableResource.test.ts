// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAbortableResource } from "./useAbortableResource";

/** Resolves after `ms`, rejecting instead if the given signal aborts first —
 * mirrors how a real fetch driven by an AbortSignal behaves, without a real
 * network call. */
function delayed<T>(value: T, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Renders past this for one request key mean the hook is driving itself. */
const RENDER_LOOP_LIMIT = 10;

type Props = { fetcher: (signal: AbortSignal) => Promise<string>; requestKey: string };

function renderResource(initialProps: Props) {
  return renderHook(({ fetcher, requestKey }: Props) => useAbortableResource(fetcher, requestKey), {
    initialProps
  });
}

describe("useAbortableResource", () => {
  it("leaves the SECOND request's result displayed when a slow first call resolves after a fast second one", async () => {
    const { result, rerender } = renderResource({
      fetcher: (signal: AbortSignal) => delayed("first", 50, signal),
      requestKey: "first"
    });

    rerender({ fetcher: (signal: AbortSignal) => delayed("second", 5, signal), requestKey: "second" });

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "second" }));

    // Give the slow first call's timer room to fire, if it wasn't actually
    // aborted, and confirm it never clobbers the second result.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(result.current.state).toEqual({ status: "loaded", data: "second" });
  });

  it("does not let an obsolete error replace current data", async () => {
    const { result, rerender } = renderResource({
      fetcher: (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          setTimeout(() => reject(new Error("stale failure")), 50);
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      requestKey: "failing"
    });

    rerender({ fetcher: (signal: AbortSignal) => delayed("fresh data", 5, signal), requestKey: "fresh" });

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "fresh data" }));

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(result.current.state).toEqual({ status: "loaded", data: "fresh data" });
  });

  it("resets to loading as soon as the request key changes, so a filter change never leaves the previous filter's rows on screen under the new filter's label", async () => {
    const { result, rerender } = renderResource({
      fetcher: (signal: AbortSignal) => delayed("open incidents", 5, signal),
      requestKey: "open"
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "open incidents" }));

    // Simulate a filter change to a slow/hanging replacement request.
    rerender({
      fetcher: (signal: AbortSignal) => delayed("resolved incidents", 1000, signal),
      requestKey: "resolved"
    });

    // The instant the filter changes, the UI must stop showing the old
    // filter's rows — they are not an answer to the new filter, and leaving
    // them up would let an operator read them as if they were.
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("re-fetches on a request key change even when the fetcher's identity is unchanged", async () => {
    const keysFetched: string[] = [];
    // One stable function serving both keys — the mirror image of the inline
    // fetcher below. A hook keyed on function identity would never re-fetch.
    const fetcher = (signal: AbortSignal): Promise<string> => {
      const key = keysFetched.length === 0 ? "first" : "second";
      keysFetched.push(key);
      return delayed(key, 5, signal);
    };

    const { result, rerender } = renderResource({ fetcher, requestKey: "open" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "first" }));

    rerender({ fetcher, requestKey: "resolved" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "second" }));

    expect(keysFetched).toEqual(["first", "second"]);
  });

  it("does not loop or re-fetch when a caller passes an inline fetcher, including after the request settles", async () => {
    let renders = 0;
    let fetches = 0;

    const { result, rerender } = renderHook(() => {
      renders += 1;
      // Bail out loudly rather than letting a real loop exhaust the heap and
      // take the whole test runner down with an unreadable OOM.
      if (renders > RENDER_LOOP_LIMIT) throw new Error(`render loop: ${renders} renders`);
      // Deliberately NOT memoized: a new closure on every render. Re-creating
      // it must be inert, since `requestKey` is what names the request.
      return useAbortableResource((signal: AbortSignal) => {
        fetches += 1;
        return delayed("value", 5, signal);
      }, "stable-key");
    });

    // Settling is the part that exposes the loop: it re-renders the hook,
    // handing it a brand-new fetcher identity. Asserting only on the
    // synchronous mount would miss that entirely.
    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "value" }));

    // Re-render again for good measure — still a new identity, still inert.
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetches).toBe(1);
    expect(result.current.state).toEqual({ status: "loaded", data: "value" });
  });

  it("aborts the in-flight request on unmount", async () => {
    let observedSignal: AbortSignal | undefined;
    const { unmount } = renderResource({
      fetcher: (signal: AbortSignal) => {
        observedSignal = signal;
        return delayed("value", 50, signal);
      },
      requestKey: "only"
    });

    expect(observedSignal?.aborted).toBe(false);
    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("retries the current request key on demand, showing loading while it re-runs", async () => {
    let attempts = 0;
    const fetcher = (signal: AbortSignal): Promise<string> => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("first attempt failed"))
        : delayed("recovered", 5, signal);
    };

    const { result } = renderResource({ fetcher, requestKey: "only" });
    await waitFor(() => expect(result.current.state.status).toBe("error"));

    result.current.retry();

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "recovered" }));
    expect(attempts).toBe(2);
  });
});
