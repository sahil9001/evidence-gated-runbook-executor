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

/** Renders past this on a single mount mean the hook is driving itself. */
const RENDER_LOOP_LIMIT = 10;

describe("useAbortableResource", () => {
  it("leaves the SECOND fetcher's result displayed when a slow first call resolves after a fast second one", async () => {
    const { result, rerender } = renderHook(
      ({ fetcher }: { fetcher: (signal: AbortSignal) => Promise<string> }) => useAbortableResource(fetcher),
      { initialProps: { fetcher: (signal: AbortSignal) => delayed("first", 50, signal) } }
    );

    rerender({ fetcher: (signal: AbortSignal) => delayed("second", 5, signal) });

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "second" }));

    // Give the slow first call's timer room to fire, if it wasn't actually
    // aborted, and confirm it never clobbers the second result.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(result.current.state).toEqual({ status: "loaded", data: "second" });
  });

  it("does not let an obsolete error replace current data", async () => {
    const { result, rerender } = renderHook(
      ({ fetcher }: { fetcher: (signal: AbortSignal) => Promise<string> }) => useAbortableResource(fetcher),
      {
        initialProps: {
          fetcher: (signal: AbortSignal) =>
            new Promise<string>((_resolve, reject) => {
              setTimeout(() => reject(new Error("stale failure")), 50);
              signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            })
        }
      }
    );

    rerender({ fetcher: (signal: AbortSignal) => delayed("fresh data", 5, signal) });

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "fresh data" }));

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(result.current.state).toEqual({ status: "loaded", data: "fresh data" });
  });

  it("resets to loading as soon as the fetcher changes, so a filter change never leaves the previous filter's rows on screen under the new filter's label", async () => {
    const { result, rerender } = renderHook(
      ({ fetcher }: { fetcher: (signal: AbortSignal) => Promise<string> }) => useAbortableResource(fetcher),
      { initialProps: { fetcher: (signal: AbortSignal) => delayed("open incidents", 5, signal) } }
    );

    await waitFor(() => expect(result.current.state).toEqual({ status: "loaded", data: "open incidents" }));

    // Simulate a filter change to a slow/hanging replacement request.
    rerender({ fetcher: (signal: AbortSignal) => delayed("resolved incidents", 1000, signal) });

    // The instant the filter changes, the UI must stop showing the old
    // filter's rows — they are not an answer to the new filter, and leaving
    // them up would let an operator read them as if they were.
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("does not re-render on mount, so a caller passing an inline fetcher cannot loop", () => {
    let renders = 0;
    // Deliberately NOT memoized: a new closure on every render, which is
    // what makes this a loop detector. If the loading reset re-rendered on
    // mount, this fetcher's identity would change, the effect would re-run,
    // and the two would drive each other forever.
    renderHook(() => {
      renders += 1;
      // Bail out loudly rather than letting a real loop exhaust the heap and
      // take the whole test runner down with an unreadable OOM.
      if (renders > RENDER_LOOP_LIMIT) throw new Error(`render loop: ${renders} renders on mount`);
      return useAbortableResource((signal: AbortSignal) => delayed("value", 50, signal));
    });

    expect(renders).toBe(1);
  });

  it("aborts the in-flight request on unmount", async () => {
    let observedSignal: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useAbortableResource((signal) => {
        observedSignal = signal;
        return delayed("value", 50, signal);
      })
    );

    expect(observedSignal?.aborted).toBe(false);
    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });
});
