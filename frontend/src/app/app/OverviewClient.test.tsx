// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntry, OverviewResponse } from "../../lib/types";

const getOverview = vi.fn();
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    getOverview: (...args: unknown[]) => getOverview(...args)
  };
});

// Imported after the mock above so the module under test picks it up.
import { OverviewClient } from "./OverviewClient";

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
    ...overrides
  };
}

describe("OverviewClient", () => {
  beforeEach(() => {
    getOverview.mockReset();
  });

  it("renders counts from a mocked getOverview", async () => {
    getOverview.mockResolvedValue(makeOverview({ awaitingApproval: 3, activeIncidents: 2, runsToday: 5 }));
    render(<OverviewClient />);

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Active incidents")).toBeInTheDocument();
    expect(screen.getByText("Runs today")).toBeInTheDocument();
  });

  it("renders the awaiting-approval figure and links it to a filtered view", async () => {
    getOverview.mockResolvedValue(makeOverview({ awaitingApproval: 4 }));
    render(<OverviewClient />);

    const link = await screen.findByRole("link", { name: /4 gates awaiting approval/i });
    expect(link).toHaveAttribute("href", "/app/incidents");
    expect(within(link).getByText("4")).toBeInTheDocument();
  });

  it("links recent-activity entries to /app/runs/:runId", async () => {
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

    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.queryByText(/could not load the overview/i)).not.toBeInTheDocument();
  });

  it("does not blank the shell — the page keeps rendering something useful after a failed fetch", async () => {
    getOverview.mockRejectedValue(new Error("network down"));
    render(<OverviewClient />);

    expect(await screen.findByText(/could not load the overview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders a calm empty state when nothing is awaiting approval and there is no activity", async () => {
    getOverview.mockResolvedValue(makeOverview());
    render(<OverviewClient />);

    expect(await screen.findByRole("link", { name: /nothing awaiting approval/i })).toBeInTheDocument();
    expect(screen.getByText(/all clear/i)).toBeInTheDocument();
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });
});
