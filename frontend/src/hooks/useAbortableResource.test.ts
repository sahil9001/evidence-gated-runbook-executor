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
