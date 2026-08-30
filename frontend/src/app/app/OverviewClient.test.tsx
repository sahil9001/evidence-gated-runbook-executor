// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntry, OverviewResponse, RunRow } from "../../lib/types";

const getOverview = vi.fn();
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    getOverview: (...args: unknown[]) => getOverview(...args)
  };
});

// Imported after the mock above so the module under test picks it up.
import { OverviewClient, shortenIds } from "./OverviewClient";

const NO_RUNS: Record<RunRow["state"], number> = {
  collecting: 0,
  awaiting_approval: 0,
  approved: 0,
  rejected: 0,
  executed: 0
};

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    at: "2026-08-26T09:00:00.000Z",
    kind: "gate_approved",
    detail: "Approved by oncall@runproof.dev",
    ...overrides
  };
}

function makeOverview(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    awaitingApproval: 0,
    activeIncidents: 0,
    runsToday: 0,
    recentActivity: [],
    runsByState: NO_RUNS,
    partialEvidenceRuns: 0,
    ...overrides
  };
}

/** Reads the figure rendered under a given uppercase label. */
function figureValue(label: string): string {
  const heading = screen.getByText(label);
  const block = heading.closest("div")?.parentElement;
  return block?.querySelector("p.tabular-nums")?.textContent ?? "";
}

describe("OverviewClient", () => {
  beforeEach(() => {
    getOverview.mockReset();
  });

  it("renders the headline figures from a mocked getOverview", async () => {
    getOverview.mockResolvedValue(
      makeOverview({ awaitingApproval: 3, activeIncidents: 2, runsToday: 5 })
    );
    render(<OverviewClient />);

    expect(await screen.findByText("Awaiting approval")).toBeInTheDocument();
    expect(figureValue("Awaiting approval")).toBe("3");
    expect(figureValue("Active incidents")).toBe("2");
    expect(figureValue("Runs today")).toBe("5");
  });

  describe("readiness score", () => {
    it("scores a fully decided, fully evidenced history and shows its working", async () => {
      getOverview.mockResolvedValue(
        makeOverview({ runsByState: { ...NO_RUNS, executed: 3, rejected: 1 } })
      );
      render(<OverviewClient />);

      expect(await screen.findByText("Operational readiness")).toBeInTheDocument();
      expect(screen.getByText("100")).toBeInTheDocument();
      expect(screen.getByText("Strong")).toBeInTheDocument();

      // The raw counts behind each component are on screen, not hidden in a
      // tooltip — an unauditable score is what this product argues against.
      expect(screen.getByText("Decision coverage")).toBeInTheDocument();
      expect(screen.getByText("Evidence completeness")).toBeInTheDocument();
      expect(screen.getAllByText("4/4").length).toBeGreaterThan(0);
    });

    it("marks down a backlog of undecided gates and says how to fix it", async () => {
      getOverview.mockResolvedValue(
        makeOverview({
          awaitingApproval: 5,
          runsByState: { ...NO_RUNS, executed: 5, awaiting_approval: 5 }
        })
      );
      render(<OverviewClient />);

      // 0.55 * 50 + 0.45 * 100 = 72.5 -> 73
      expect(await screen.findByText("73")).toBeInTheDocument();
      expect(screen.getByText(/still waiting on a human decision/i)).toBeInTheDocument();
    });

    it("reports no score at all on an install where nothing has run", async () => {
      getOverview.mockResolvedValue(makeOverview());
      render(<OverviewClient />);

      // Neither 0 nor 100: a brand-new install has earned neither.
      expect(await screen.findByText("No data")).toBeInTheDocument();
      expect(screen.getAllByText("Not measurable yet").length).toBe(2);
    });

    it("presents gate discipline as a guarantee rather than a scored component", async () => {
      getOverview.mockResolvedValue(
        makeOverview({ runsByState: { ...NO_RUNS, executed: 2 } })
      );
      render(<OverviewClient />);

      expect(await screen.findByText(/Gate discipline verified/i)).toBeInTheDocument();
      expect(screen.getByText(/not scored above/i)).toBeInTheDocument();
    });
  });

  describe("pipeline flow", () => {
    it("shows every stage with its live count", async () => {
      getOverview.mockResolvedValue(
        makeOverview({
          activeIncidents: 2,
          runsByState: { ...NO_RUNS, collecting: 1, awaiting_approval: 4, executed: 3 }
        })
      );
      render(<OverviewClient />);

      expect(await screen.findByText("Signal")).toBeInTheDocument();
      expect(screen.getByText("Evidence")).toBeInTheDocument();
      expect(screen.getByText("Approval gate")).toBeInTheDocument();
      expect(screen.getByText("Action")).toBeInTheDocument();

      const gateStage = screen.getByRole("link", { name: /approval gate/i });
      expect(gateStage).toHaveAttribute("href", "/app/incidents");
      expect(within(gateStage).getByText("4")).toBeInTheDocument();
      expect(within(gateStage).getByText("waiting")).toBeInTheDocument();
    });
  });

  describe("recent activity", () => {
    it("links entries to /app/runs/:runId", async () => {
      getOverview.mockResolvedValue(
        makeOverview({
          recentActivity: [makeEntry({ id: "a1", runId: "run-42", kind: "gate_approved" })]
        })
      );
      render(<OverviewClient />);

      const link = await screen.findByRole("link", { name: /approval granted/i });
      expect(link).toHaveAttribute("href", "/app/runs/run-42");
    });

    it("shows a plain-language label for activity kinds", async () => {
      getOverview.mockResolvedValue(
        makeOverview({
          recentActivity: [makeEntry({ id: "a1", runId: "run-1", kind: "gate_approved" })]
        })
      );
      render(<OverviewClient />);

      expect(await screen.findByText("Approval granted")).toBeInTheDocument();
      expect(screen.queryByText("gate_approved")).not.toBeInTheDocument();
    });

    it("falls back to a readable label for an unrecognised kind", async () => {
      getOverview.mockResolvedValue(
        makeOverview({
          recentActivity: [makeEntry({ id: "a1", kind: "some_future_kind" })]
        })
      );
      render(<OverviewClient />);

      expect(await screen.findByText("some future kind")).toBeInTheDocument();
    });
  });

  it("renders a loading skeleton before the response resolves", () => {
    getOverview.mockReturnValue(new Promise(() => {}));
    render(<OverviewClient />);

    expect(screen.getByRole("status", { name: /loading overview/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    getOverview.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<OverviewClient />);

    expect(await screen.findByText(/could not load the overview/i)).toBeInTheDocument();

    getOverview.mockResolvedValueOnce(makeOverview({ awaitingApproval: 1 }));
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByText(/could not load the overview/i)).not.toBeInTheDocument();
  });

  it("does not blank the shell — the page keeps rendering something useful after a failed fetch", async () => {
    getOverview.mockRejectedValue(new Error("network down"));
    render(<OverviewClient />);

    expect(await screen.findByText(/could not load the overview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("offers a first action when nothing has ever run", async () => {
    getOverview.mockResolvedValue(makeOverview());
    render(<OverviewClient />);

    expect(await screen.findByText(/nothing has run yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new incident/i })).toHaveAttribute(
      "href",
      "/app/incidents/new"
    );
  });
});

describe("shortenIds", () => {
  it("truncates embedded UUIDs so the readable half of the sentence survives", () => {
    expect(shortenIds("Gate 7814bdea-f883-4b95-b478-496d59607512 rejected by sam")).toBe(
      "Gate 7814bdea… rejected by sam"
    );
  });

  it("shortens every id in a detail line, not just the first", () => {
    const detail =
      "Evidence collected for incident dd809c19-4abb-4ce5-8c26-c27f5a057b40; action 7814bdea-f883-4b95-b478-496d59607512 locked";
    expect(shortenIds(detail)).toBe(
      "Evidence collected for incident dd809c19…; action 7814bdea… locked"
    );
  });

  it("leaves details with no ids untouched", () => {
    expect(shortenIds("Approved by oncall@runproof.dev")).toBe("Approved by oncall@runproof.dev");
  });
});
