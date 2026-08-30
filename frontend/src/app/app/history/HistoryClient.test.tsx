// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApprovalGate, RunDetailResponse, RunRow } from "../../../lib/types";

const push = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue
}));

const listRuns = vi.fn();
const getRun = vi.fn();
vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    listRuns: (...args: unknown[]) => listRuns(...args),
    getRun: (...args: unknown[]) => getRun(...args)
  };
});

// Imported after the mocks above so the module under test picks them up.
import { HistoryClient } from "./HistoryClient";

function makeRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    incidentId: "inc-1",
    runbookId: "rb-1",
    service: "payment-service",
    state: "awaiting_approval",
    createdAt: "2026-08-26T09:00:00.000Z",
    updatedAt: "2026-08-26T09:05:00.000Z",
    createdBy: "oncall@runproof.dev",
    evidenceGapCount: 0,
    ...overrides
  };
}

function makeGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id: "run-1",
    actionId: "run-1",
    createdAt: "2026-08-26T09:00:00.000Z",
    expiresAt: "2026-08-26T10:00:00.000Z",
    state: "approved",
    decidedBy: "lead@runproof.dev",
    decidedAt: "2026-08-26T09:10:00.000Z",
    ...overrides
  };
}

function makeRunDetail(run: RunRow, gate: ApprovalGate | null): RunDetailResponse {
  return {
    run,
    incident: {
      id: run.incidentId,
      title: "Checkout errors spiking",
      service: run.service,
      signals: [],
      status: "open",
      createdBy: "oncall@runproof.dev",
      createdAt: run.createdAt
    },
    packet: null,
    action: null,
    gate,
    failures: [],
    confidence: null
  };
}

describe("HistoryClient", () => {
  beforeEach(() => {
    push.mockClear();
    listRuns.mockReset();
    getRun.mockReset();
    // Default fallback so tests that don't care about decision details
    // (most of them) don't need to stub `getRun` just to avoid a crash when
    // a fixture run happens to be in a decided state.
    getRun.mockResolvedValue(makeRunDetail(makeRun(), null));
    searchParamsValue = new URLSearchParams();
  });

  it("renders runs from a mocked client", async () => {
    listRuns.mockResolvedValue([
      makeRun({ id: "run-1", service: "payment-service" }),
      makeRun({ id: "run-2", service: "auth-service", state: "collecting" })
    ]);

    render(<HistoryClient />);

    expect(await screen.findByText("payment-service")).toBeInTheDocument();
    expect(screen.getByText("auth-service")).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledWith({ state: undefined, limit: expect.any(Number) }, expect.any(AbortSignal));
  });

  it("shows who created each run", async () => {
    listRuns.mockResolvedValue([makeRun({ createdBy: "oncall@runproof.dev" })]);

    render(<HistoryClient />);

    expect(await screen.findByText(/oncall@runproof\.dev/)).toBeInTheDocument();
  });

  it("fetches and shows the decision, approver, and decided-at for a decided run", async () => {
    const decided = makeRun({ id: "run-9", state: "approved" });
    listRuns.mockResolvedValue([decided]);
    getRun.mockResolvedValue(makeRunDetail(decided, makeGate({ state: "approved", decidedBy: "lead@runproof.dev" })));

    render(<HistoryClient />);

    const row = (await screen.findByText("payment-service")).closest("li") as HTMLElement;
    expect(getRun).toHaveBeenCalledWith("run-9", expect.any(AbortSignal));
    expect(await within(row).findByText(/lead@runproof\.dev/)).toBeInTheDocument();
    expect(within(row).getAllByText(/approved/i).length).toBeGreaterThan(0);
  });

  it("does not fetch gate details for a run still awaiting a decision", async () => {
    listRuns.mockResolvedValue([makeRun({ id: "run-2", state: "awaiting_approval" })]);

    render(<HistoryClient />);

    await screen.findByText("payment-service");
    expect(getRun).not.toHaveBeenCalled();
  });

  it("reads the initial state filter from the URL and requests that state", async () => {
    searchParamsValue = new URLSearchParams("state=rejected");
    listRuns.mockResolvedValue([makeRun({ state: "rejected" })]);

    render(<HistoryClient />);

    await screen.findByText("payment-service");
    expect(listRuns).toHaveBeenCalledWith({ state: "rejected", limit: expect.any(Number) }, expect.any(AbortSignal));

    // The filter is a segmented radio group, not a select: the run states are
    // this screen's vocabulary and stay legible rather than hiding in a menu.
    expect(screen.getByRole("radio", { name: "Rejected" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked();
  });

  it("updates the URL when the state filter changes", async () => {
    listRuns.mockResolvedValue([makeRun()]);
    const user = userEvent.setup();
    render(<HistoryClient />);

    await screen.findByText("payment-service");
    listRuns.mockClear();
    listRuns.mockResolvedValue([]);

    await user.click(screen.getByRole("radio", { name: "Executed" }));

    expect(push).toHaveBeenCalledWith("/app/history?state=executed");
  });

  it("each row links to its run", async () => {
    listRuns.mockResolvedValue([makeRun({ id: "run-77" })]);
    render(<HistoryClient />);

    const link = await screen.findByRole("link", { name: /payment-service/i });
    expect(link).toHaveAttribute("href", "/app/runs/run-77");
  });

  it("renders a loading skeleton before the response resolves", () => {
    listRuns.mockReturnValue(new Promise(() => {}));
    render(<HistoryClient />);

    expect(screen.getByRole("status", { name: /loading (run )?history/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    listRuns.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<HistoryClient />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();

    listRuns.mockResolvedValueOnce([makeRun()]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("payment-service")).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it("renders a calm empty state when there are no runs", async () => {
    listRuns.mockResolvedValue([]);
    render(<HistoryClient />);

    expect(await screen.findByText(/no runs/i)).toBeInTheDocument();
  });

  describe("stale filter-change races", () => {
    it("leaves the SECOND filter's results displayed when a slow first request resolves after a fast second", async () => {
      let resolveFirst: (value: RunRow[]) => void = () => {};
      listRuns.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
      const { rerender } = render(<HistoryClient />);
      await screen.findByRole("status", { name: /loading (run )?history/i });

      listRuns.mockResolvedValueOnce([makeRun({ id: "run-2", service: "second-filter-service" })]);
      searchParamsValue = new URLSearchParams("state=executed");
      rerender(<HistoryClient />);

      expect(await screen.findByText("second-filter-service")).toBeInTheDocument();

      resolveFirst([makeRun({ id: "run-1", service: "first-filter-service" })]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("second-filter-service")).toBeInTheDocument();
      expect(screen.queryByText("first-filter-service")).not.toBeInTheDocument();
    });

    it("does not let an obsolete error from the first filter replace the second filter's data", async () => {
      let rejectFirst: (error: Error) => void = () => {};
      listRuns.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)));
      const { rerender } = render(<HistoryClient />);
      await screen.findByRole("status", { name: /loading (run )?history/i });

      listRuns.mockResolvedValueOnce([makeRun({ id: "run-2", service: "second-filter-service" })]);
      searchParamsValue = new URLSearchParams("state=executed");
      rerender(<HistoryClient />);

      expect(await screen.findByText("second-filter-service")).toBeInTheDocument();

      rejectFirst(new Error("stale failure from the first filter"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("second-filter-service")).toBeInTheDocument();
      expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
    });

    it("aborts the in-flight request on unmount", async () => {
      let observedSignal: AbortSignal | undefined;
      listRuns.mockImplementation(
        (_filter?: unknown, signal?: AbortSignal) =>
          new Promise<RunRow[]>((resolve) => {
            observedSignal = signal;
            setTimeout(() => resolve([]), 50);
          })
      );
      const { unmount } = render(<HistoryClient />);
      await screen.findByRole("status", { name: /loading (run )?history/i });

      expect(observedSignal?.aborted).toBe(false);
      unmount();
      expect(observedSignal?.aborted).toBe(true);
    });
  });
});
