// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO_PREVIEW, RunbookPreview, type RunbookPreviewData } from "./RunbookPreview";

function customData(overrides: Partial<RunbookPreviewData> = {}): RunbookPreviewData {
  return {
    riskScore: 41,
    riskLabel: "Low",
    incidentTitle: "Database latency spike",
    runbookId: "db-latency-failover",
    timeline: [
      { label: "Alert received", detail: "Read replica latency exceeded threshold.", state: "done" }
    ],
    sandboxOutput: "replica_lag_ms=1200\nrecommendation=failover",
    actionDescription: "failover db-replica-2",
    gateState: "locked",
    onApprove: vi.fn(),
    onReject: vi.fn(),
    isDeciding: false,
    ...overrides
  };
}

describe("RunbookPreview", () => {
  it("renders DEMO_PREVIEW when given no props", () => {
    render(<RunbookPreview />);

    expect(screen.getByText(String(DEMO_PREVIEW.riskScore))).toBeInTheDocument();
    expect(screen.getByText(DEMO_PREVIEW.riskLabel)).toBeInTheDocument();
    expect(screen.getByText(DEMO_PREVIEW.incidentTitle)).toBeInTheDocument();
    expect(screen.getByText(`Runbook: ${DEMO_PREVIEW.runbookId}`)).toBeInTheDocument();
    expect(screen.getByText(`Action: ${DEMO_PREVIEW.actionDescription}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /review/i })).toBeEnabled();
  });

  it("renders injected data when given some", () => {
    const data = customData();

    render(<RunbookPreview data={data} />);

    expect(screen.getByText("41")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Database latency spike")).toBeInTheDocument();
    expect(screen.getByText("Runbook: db-latency-failover")).toBeInTheDocument();
    expect(screen.getByText("Action: failover db-replica-2")).toBeInTheDocument();
    expect(screen.getByText("Alert received")).toBeInTheDocument();
  });

  it("allows callers to tune the preview container", () => {
    const { container } = render(<RunbookPreview className="custom-preview" />);

    expect(container.firstElementChild).toHaveClass("custom-preview");
    expect(container.firstElementChild).toHaveClass("xl:max-w-[1280px]");
    expect(container.firstElementChild).toHaveClass("2xl:max-w-[1440px]");
  });

  it("disables Approve and Review when gateState is not locked", () => {
    const data = customData({ gateState: "approved" });

    render(<RunbookPreview data={data} />);

    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /review/i })).toBeDisabled();
  });

  it("fires onApprove exactly once when Approve is clicked", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const data = customData({ onApprove });

    render(<RunbookPreview data={data} />);
    await user.click(screen.getByRole("button", { name: /approve/i }));

    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("shows the decision instead of live buttons once a gate is decided", () => {
    const rejected = customData({ gateState: "rejected" });
    render(<RunbookPreview data={rejected} />);

    expect(screen.getByText(/decision: rejected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();

    const approved = customData({ gateState: "approved" });
    render(<RunbookPreview data={approved} />);

    expect(screen.getByText(/decision: approved/i)).toBeInTheDocument();
  });
});
