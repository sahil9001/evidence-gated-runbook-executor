// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Runbook } from "../../../lib/types";

const listRunbooks = vi.fn();
vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    listRunbooks: (...args: unknown[]) => listRunbooks(...args)
  };
});

// Imported after the mock above so the module under test picks it up.
import { RunbooksClient } from "./RunbooksClient";

function makeRunbook(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: "rb-1",
    title: "Rollback bad deploy",
    trigger: { service: "payment-service", signals: ["error_rate", "timeout"] },
    allowedSources: ["logs", "metrics", "deploys"],
    steps: [
      { id: "step-1", label: "Check recent deploys", detail: "Look for a deploy in the last 30 minutes." },
      { id: "step-2", label: "Correlate error rate", detail: "Confirm the spike lines up with the deploy." }
    ],
    proposedAction: {
      kind: "rollback",
      target: "payment-service",
      params: {},
      reversible: true,
      description: "Roll back payment-service to the previous release."
    },
    ...overrides
  };
}

describe("RunbooksClient", () => {
  beforeEach(() => {
    listRunbooks.mockReset();
  });

  it("renders runbooks from a mocked client, including trigger service and signals", async () => {
    listRunbooks.mockResolvedValue([
      makeRunbook({ id: "rb-1", title: "Rollback bad deploy" }),
      makeRunbook({ id: "rb-2", title: "Restart stuck workers", trigger: { service: "queue-worker", signals: ["backlog"] } })
    ]);

    render(<RunbooksClient />);

    expect(await screen.findByText("Rollback bad deploy")).toBeInTheDocument();
    expect(screen.getByText("Restart stuck workers")).toBeInTheDocument();
    expect(screen.getByText("payment-service")).toBeInTheDocument();
    expect(screen.getByText("queue-worker")).toBeInTheDocument();
    expect(screen.getByText("error_rate")).toBeInTheDocument();
    expect(screen.getByText("backlog")).toBeInTheDocument();
  });

  it("renders allowedSources as the evidence scope for each runbook", async () => {
    listRunbooks.mockResolvedValue([
      makeRunbook({ id: "rb-1", title: "Rollback bad deploy", allowedSources: ["logs", "metrics", "deploys"] }),
      makeRunbook({ id: "rb-2", title: "Diagnose sandbox", allowedSources: ["sandbox"] })
    ]);

    render(<RunbooksClient />);

    const first = (await screen.findByText("Rollback bad deploy")).closest("article");
    expect(first).not.toBeNull();
    expect(within(first as HTMLElement).getByText("logs")).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText("metrics")).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText("deploys")).toBeInTheDocument();

    const second = screen.getByText("Diagnose sandbox").closest("article");
    expect(second).not.toBeNull();
    expect(within(second as HTMLElement).getByText("sandbox")).toBeInTheDocument();
  });

  it("renders ordered steps and the proposed action for a runbook", async () => {
    listRunbooks.mockResolvedValue([makeRunbook()]);

    render(<RunbooksClient />);

    await screen.findByText("Rollback bad deploy");
    expect(screen.getByText("Check recent deploys.")).toBeInTheDocument();
    expect(screen.getByText("Correlate error rate.")).toBeInTheDocument();
    expect(screen.getByText("Roll back payment-service to the previous release.")).toBeInTheDocument();
  });

  it("labels a state-changing proposed action distinctly from a read-only one", async () => {
    listRunbooks.mockResolvedValue([
      makeRunbook({
        id: "rb-1",
        title: "Rollback bad deploy",
        proposedAction: {
          kind: "rollback",
          target: "payment-service",
          params: {},
          reversible: true,
          description: "Roll back payment-service."
        }
      }),
      makeRunbook({
        id: "rb-2",
        title: "Read diagnostics only",
        proposedAction: {
          kind: "read_logs",
          target: "payment-service",
          params: {},
          reversible: true,
          description: "Pull the last hour of logs."
        }
      })
    ]);

    render(<RunbooksClient />);

    const stateChangingCard = (await screen.findByText("Rollback bad deploy")).closest("article") as HTMLElement;
    const readOnlyCard = screen.getByText("Read diagnostics only").closest("article") as HTMLElement;

    expect(within(stateChangingCard).getByText(/state-changing/i)).toBeInTheDocument();
    expect(within(readOnlyCard).getByText(/read-only/i)).toBeInTheDocument();
    expect(within(readOnlyCard).queryByText(/state-changing/i)).not.toBeInTheDocument();
  });

  it("renders a loading skeleton before the response resolves", () => {
    listRunbooks.mockReturnValue(new Promise(() => {}));
    render(<RunbooksClient />);

    expect(screen.getByRole("status", { name: /loading runbooks/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    listRunbooks.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<RunbooksClient />);

    expect(await screen.findByText(/could not load runbooks/i)).toBeInTheDocument();

    listRunbooks.mockResolvedValueOnce([makeRunbook()]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Rollback bad deploy")).toBeInTheDocument();
    expect(screen.queryByText(/could not load runbooks/i)).not.toBeInTheDocument();
  });

  it("renders a calm empty state when there are no runbooks", async () => {
    listRunbooks.mockResolvedValue([]);
    render(<RunbooksClient />);

    expect(await screen.findByText(/no runbooks/i)).toBeInTheDocument();
  });
});
