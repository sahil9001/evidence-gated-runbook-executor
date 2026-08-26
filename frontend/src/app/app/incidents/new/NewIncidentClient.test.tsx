// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IncidentRow, Runbook } from "../../../../lib/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

const listRunbooks = vi.fn();
const createIncident = vi.fn();
const startRun = vi.fn();
vi.mock("../../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/api")>("../../../../lib/api");
  return {
    ...actual,
    listRunbooks: (...args: unknown[]) => listRunbooks(...args),
    createIncident: (...args: unknown[]) => createIncident(...args),
    startRun: (...args: unknown[]) => startRun(...args)
  };
});

// Imported after the mocks above so the module under test picks them up.
import { NewIncidentClient } from "./NewIncidentClient";

function makeRunbook(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: "checkout-failure",
    title: "Checkout payment-service failure",
    trigger: { service: "payment-service", signals: ["timeout", "error_rate"] },
    allowedSources: ["logs", "metrics", "deploys"],
    steps: [{ id: "s1", label: "Alert received", detail: "Checkout error rate increased." }],
    proposedAction: {
      kind: "rollback",
      target: "payment-service",
      params: { commit: "8f31c2b" },
      reversible: true,
      description: "Roll back payment-service to 8f31c2b"
    },
    ...overrides
  };
}

function makeIncident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "inc-1",
    title: "Checkout errors spiking",
    service: "payment-service",
    signals: ["timeout", "error_rate"],
    status: "open",
    createdBy: "oncall@runproof.dev",
    createdAt: "2026-08-26T09:00:00.000Z",
    ...overrides
  };
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { title, service, signals }: { title: string; service: string; signals: string[] }
): Promise<void> {
  await user.type(screen.getByLabelText(/^title$/i), title);
  await user.type(screen.getByLabelText(/^service$/i), service);
  const signalInput = screen.getByLabelText(/add a signal/i);
  for (const signal of signals) {
    await user.type(signalInput, `${signal}{Enter}`);
  }
}

describe("NewIncidentClient", () => {
  beforeEach(() => {
    push.mockClear();
    listRunbooks.mockReset();
    createIncident.mockReset();
    startRun.mockReset();
  });

  it("shows the matched runbook, its allowed sources, steps, and proposed action", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);
    const user = userEvent.setup();
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    await fillForm(user, { title: "Checkout errors spiking", service: "payment-service", signals: ["timeout"] });

    expect(await screen.findByText(/checkout payment-service failure/i)).toBeInTheDocument();
    expect(screen.getAllByText(/logs/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/metrics/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/deploys/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/alert received/i)).toBeInTheDocument();
    expect(screen.getByText(/roll back payment-service to 8f31c2b/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start run/i })).toBeEnabled();
  });

  it("shows no match and keeps submit disabled on zero signal overlap", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);
    const user = userEvent.setup();
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    await fillForm(user, {
      title: "Checkout errors spiking",
      service: "payment-service",
      signals: ["memory_leak"]
    });

    expect(await screen.findByText(/no runbook matches/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start run/i })).toBeDisabled();
  });

  it("a tie between two equally-matching runbooks shows no match and keeps submit disabled", async () => {
    listRunbooks.mockResolvedValue([
      makeRunbook({ id: "rb-a", trigger: { service: "payment-service", signals: ["timeout"] } }),
      makeRunbook({ id: "rb-b", trigger: { service: "payment-service", signals: ["error_rate"] } })
    ]);
    const user = userEvent.setup();
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    await fillForm(user, {
      title: "Checkout errors spiking",
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });

    expect(await screen.findByText(/no runbook matches/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start run/i })).toBeDisabled();
  });

  it("a successful submit calls create-then-run and navigates to the run", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);
    createIncident.mockResolvedValue(makeIncident());
    startRun.mockResolvedValue({
      run: {
        id: "run-99",
        incidentId: "inc-1",
        runbookId: "checkout-failure",
        service: "payment-service",
        state: "awaiting_approval",
        createdAt: "t",
        updatedAt: "t"
      },
      packet: { id: "pk-1", incidentId: "inc-1", runbookId: "checkout-failure", cards: [], summary: "s", builtAt: "t" },
      action: {
        id: "run-99",
        kind: "rollback",
        target: "payment-service",
        params: {},
        reversible: true,
        description: "d",
        isStateChanging: true
      },
      gate: { id: "run-99", actionId: "run-99", createdAt: "t", expiresAt: "t2", state: "locked" }
    });
    const user = userEvent.setup();
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    await fillForm(user, { title: "Checkout errors spiking", service: "payment-service", signals: ["timeout"] });

    await user.click(await screen.findByRole("button", { name: /start run/i }));

    await waitFor(() =>
      expect(createIncident).toHaveBeenCalledWith({
        title: "Checkout errors spiking",
        service: "payment-service",
        signals: ["timeout"]
      })
    );
    await waitFor(() =>
      expect(startRun).toHaveBeenCalledWith("inc-1", { service: "payment-service", signals: ["timeout", "error_rate"] })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/runs/run-99"));
  });

  it("surfaces an error and links to the incident when create succeeds but the run fails", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);
    createIncident.mockResolvedValue(makeIncident({ id: "inc-orphan" }));
    startRun.mockRejectedValue(new Error("no matching runbook"));
    const user = userEvent.setup();
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    await fillForm(user, { title: "Checkout errors spiking", service: "payment-service", signals: ["timeout"] });

    await user.click(await screen.findByRole("button", { name: /start run/i }));

    expect(await screen.findByText(/the run failed to start/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view the incident/i });
    expect(link).toHaveAttribute("href", "/app/incidents/inc-orphan");
    expect(push).not.toHaveBeenCalled();
  });

  it("does not call the API before a service is entered, and prompts for one", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);
    render(<NewIncidentClient />);

    await waitFor(() => expect(listRunbooks).toHaveBeenCalled());
    expect(screen.getByText(/enter a service/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start run/i })).toBeDisabled();
  });
});
