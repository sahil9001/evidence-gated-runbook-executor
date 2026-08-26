// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IncidentDetailResponse, RunResponse } from "../../../../lib/types";

const getIncident = vi.fn();
const startRun = vi.fn();
vi.mock("../../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/api")>("../../../../lib/api");
  return {
    ...actual,
    getIncident: (...args: unknown[]) => getIncident(...args),
    startRun: (...args: unknown[]) => startRun(...args)
  };
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

// Imported after the mocks above so the module under test picks them up.
import { IncidentDetailClient } from "./IncidentDetailClient";

function makeDetail(overrides: Partial<IncidentDetailResponse> = {}): IncidentDetailResponse {
  return {
    incident: {
      id: "inc-1",
      title: "Checkout errors spiking",
      service: "payment-service",
      signals: ["timeout", "error_rate"],
      status: "open",
      createdBy: "oncall@runproof.dev",
      createdAt: "2026-08-26T09:00:00.000Z"
    },
    runs: [],
    ...overrides
  };
}

function makeRunResponse(): RunResponse {
  return {
    run: {
      id: "run-new",
      incidentId: "inc-1",
      runbookId: "rb-1",
      service: "payment-service",
      state: "awaiting_approval",
      createdAt: "t",
      updatedAt: "t"
    },
    packet: { id: "pk-1", incidentId: "inc-1", runbookId: "rb-1", cards: [], summary: "s", builtAt: "t" },
    action: {
      id: "run-new",
      kind: "rollback",
      target: "payment-service",
      params: {},
      reversible: true,
      description: "d",
      isStateChanging: true
    },
    gate: { id: "run-new", actionId: "run-new", createdAt: "t", expiresAt: "t2", state: "locked" }
  };
}

describe("IncidentDetailClient", () => {
  beforeEach(() => {
    getIncident.mockReset();
    startRun.mockReset();
    push.mockClear();
  });

  it("renders the incident's title, service, status, and signals", async () => {
    getIncident.mockResolvedValue(makeDetail());
    render(<IncidentDetailClient incidentId="inc-1" />);

    expect(await screen.findByText("Checkout errors spiking")).toBeInTheDocument();
    expect(screen.getByText("payment-service")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("error_rate")).toBeInTheDocument();
  });

  it("links each run to its run detail screen", async () => {
    getIncident.mockResolvedValue(
      makeDetail({
        runs: [
          {
            id: "run-1",
            incidentId: "inc-1",
            runbookId: "rb-1",
            service: "payment-service",
            state: "awaiting_approval",
            createdAt: "2026-08-26T09:00:00.000Z",
            updatedAt: "2026-08-26T09:00:00.000Z"
          }
        ]
      })
    );
    render(<IncidentDetailClient incidentId="inc-1" />);

    const link = await screen.findByRole("link", { name: /run-1/i });
    expect(link).toHaveAttribute("href", "/app/runs/run-1");
  });

  it("shows a calm message and a way to start a run when the incident has none", async () => {
    getIncident.mockResolvedValue(makeDetail({ runs: [] }));
    render(<IncidentDetailClient incidentId="inc-1" />);

    expect(await screen.findByText(/no run has started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start a run/i })).toBeInTheDocument();
  });

  it("starting a run from an orphaned incident navigates to the new run on success", async () => {
    getIncident.mockResolvedValue(makeDetail({ runs: [] }));
    startRun.mockResolvedValue(makeRunResponse());
    const user = userEvent.setup();
    render(<IncidentDetailClient incidentId="inc-1" />);

    await user.click(await screen.findByRole("button", { name: /start a run/i }));

    expect(startRun).toHaveBeenCalledWith("inc-1", { service: "payment-service", signals: ["timeout", "error_rate"] });
    expect(push).toHaveBeenCalledWith("/app/runs/run-new");
  });

  it("shows an inline error (not a dead screen) when starting a run fails", async () => {
    getIncident.mockResolvedValue(makeDetail({ runs: [] }));
    startRun.mockRejectedValue(new Error("no matching runbook"));
    const user = userEvent.setup();
    render(<IncidentDetailClient incidentId="inc-1" />);

    await user.click(await screen.findByRole("button", { name: /start a run/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText("Checkout errors spiking")).toBeInTheDocument();
  });

  it("renders a loading state before the response resolves", () => {
    getIncident.mockReturnValue(new Promise(() => {}));
    render(<IncidentDetailClient incidentId="inc-1" />);

    expect(screen.getByRole("status", { name: /loading incident/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    getIncident.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<IncidentDetailClient incidentId="inc-1" />);

    expect(await screen.findByText(/could not load this incident/i)).toBeInTheDocument();

    getIncident.mockResolvedValueOnce(makeDetail());
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Checkout errors spiking")).toBeInTheDocument();
  });
});
