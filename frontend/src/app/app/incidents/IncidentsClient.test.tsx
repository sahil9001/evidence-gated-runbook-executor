// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IncidentRow } from "../../../lib/types";

const push = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue
}));

const listIncidents = vi.fn();
vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    listIncidents: (...args: unknown[]) => listIncidents(...args)
  };
});

// Imported after the mocks above so the module under test picks them up.
import { IncidentsClient } from "./IncidentsClient";

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

describe("IncidentsClient", () => {
  beforeEach(() => {
    push.mockClear();
    listIncidents.mockReset();
    searchParamsValue = new URLSearchParams();
  });

  it("renders incidents from a mocked client", async () => {
    listIncidents.mockResolvedValue([
      makeIncident({ id: "inc-1", title: "Checkout errors spiking" }),
      makeIncident({ id: "inc-2", title: "Latency on auth-service", service: "auth-service" })
    ]);

    render(<IncidentsClient />);

    expect(await screen.findByText("Checkout errors spiking")).toBeInTheDocument();
    expect(screen.getByText("Latency on auth-service")).toBeInTheDocument();
    expect(listIncidents).toHaveBeenCalledWith(undefined);
  });

  it("reads the initial status filter from the URL and requests that status", async () => {
    searchParamsValue = new URLSearchParams("status=open");
    listIncidents.mockResolvedValue([makeIncident()]);

    render(<IncidentsClient />);

    await screen.findByText("Checkout errors spiking");
    expect(listIncidents).toHaveBeenCalledWith("open");

    const select = screen.getByLabelText(/status/i) as HTMLSelectElement;
    expect(select.value).toBe("open");
  });

  it("updates the URL when the status filter changes", async () => {
    listIncidents.mockResolvedValue([makeIncident()]);
    const user = userEvent.setup();
    render(<IncidentsClient />);

    await screen.findByText("Checkout errors spiking");
    listIncidents.mockClear();
    listIncidents.mockResolvedValue([]);

    await user.selectOptions(screen.getByLabelText(/status/i), "resolved");

    expect(push).toHaveBeenCalledWith("/app/incidents?status=resolved");
  });

  it("each row links to its incident", async () => {
    listIncidents.mockResolvedValue([makeIncident({ id: "inc-77" })]);
    render(<IncidentsClient />);

    const link = await screen.findByRole("link", { name: /checkout errors spiking/i });
    expect(link).toHaveAttribute("href", "/app/incidents/inc-77");
  });

  it("has a prominent New incident action", async () => {
    listIncidents.mockResolvedValue([]);
    render(<IncidentsClient />);

    await screen.findByText(/no incidents/i);
    const link = screen.getByRole("link", { name: /new incident/i });
    expect(link).toHaveAttribute("href", "/app/incidents/new");
  });

  it("renders a loading skeleton before the response resolves", () => {
    listIncidents.mockReturnValue(new Promise(() => {}));
    render(<IncidentsClient />);

    expect(screen.getByRole("status", { name: /loading incidents/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    listIncidents.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<IncidentsClient />);

    expect(await screen.findByText(/could not load incidents/i)).toBeInTheDocument();

    listIncidents.mockResolvedValueOnce([makeIncident()]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Checkout errors spiking")).toBeInTheDocument();
    expect(screen.queryByText(/could not load incidents/i)).not.toBeInTheDocument();
  });

  it("renders a calm empty state when there are no incidents", async () => {
    listIncidents.mockResolvedValue([]);
    render(<IncidentsClient />);

    const empty = await screen.findByText(/no incidents/i);
    expect(within(empty.closest("section") ?? empty).getByText(/no incidents/i)).toBeInTheDocument();
  });
});
