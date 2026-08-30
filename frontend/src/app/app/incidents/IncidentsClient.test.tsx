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
const deleteIncident = vi.fn();
vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    listIncidents: (...args: unknown[]) => listIncidents(...args),
    deleteIncident: (...args: unknown[]) => deleteIncident(...args)
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

/** A `Figure` renders its label inside a wrapper next to its value, so the
 * figure itself is the label's grandparent. */
function figureFor(label: RegExp): HTMLElement {
  const figure = screen.getByText(label).closest("div")?.parentElement;
  if (!figure) throw new Error(`No figure found for ${String(label)}`);
  return figure;
}

describe("IncidentsClient", () => {
  beforeEach(() => {
    push.mockClear();
    listIncidents.mockReset();
    deleteIncident.mockReset();
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
    expect(listIncidents).toHaveBeenCalledWith(undefined, undefined, expect.any(AbortSignal));
  });

  it("reads the initial status filter from the URL and requests that status", async () => {
    searchParamsValue = new URLSearchParams("status=open");
    listIncidents.mockResolvedValue([makeIncident()]);

    render(<IncidentsClient />);

    await screen.findByText("Checkout errors spiking");
    expect(listIncidents).toHaveBeenCalledWith("open", undefined, expect.any(AbortSignal));

    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked();
  });

  it("updates the URL when the status filter changes", async () => {
    listIncidents.mockResolvedValue([makeIncident()]);
    const user = userEvent.setup();
    render(<IncidentsClient />);

    await screen.findByText("Checkout errors spiking");
    listIncidents.mockClear();
    listIncidents.mockResolvedValue([]);

    await user.click(screen.getByRole("radio", { name: "Resolved" }));

    expect(push).toHaveBeenCalledWith("/app/incidents?status=resolved");
  });

  it("exposes the status filter as a labelled radio group", async () => {
    listIncidents.mockResolvedValue([makeIncident()]);
    render(<IncidentsClient />);

    await screen.findByText("Checkout errors spiking");
    const group = screen.getByRole("group", { name: /status/i });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
  });

  it("shows the incident's signals and a summary of what is in view", async () => {
    listIncidents.mockResolvedValue([
      makeIncident({ id: "inc-1", signals: ["timeout", "error_rate"] }),
      makeIncident({ id: "inc-2", title: "Latency on auth-service", service: "auth-service", signals: ["latency"] })
    ]);
    render(<IncidentsClient />);

    expect(await screen.findByText("timeout")).toBeInTheDocument();
    expect(screen.getByText("error_rate")).toBeInTheDocument();
    expect(screen.getByText("latency")).toBeInTheDocument();

    // Two incidents across two distinct services, both open.
    expect(within(figureFor(/in view/i)).getByText("2")).toBeInTheDocument();
    expect(within(figureFor(/^services$/i)).getByText("2")).toBeInTheDocument();
    // "Open" also names a radio and each row's affordance, so this figure is
    // reached through its caption instead.
    const openFigure = screen.getByText(/still unresolved/i).parentElement as HTMLElement;
    expect(within(openFigure).getByText("2")).toBeInTheDocument();
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

    expect(await screen.findByText(/no incidents match this filter/i)).toBeInTheDocument();
    expect(screen.getByText(/start a new incident/i)).toBeInTheDocument();
  });

  describe("deleting from the list", () => {
    it("refetches the list so the deleted row disappears", async () => {
      const doomed = makeIncident({ id: "inc-doomed", title: "Doomed incident" });
      const survivor = makeIncident({ id: "inc-keep", title: "Surviving incident" });
      listIncidents.mockResolvedValueOnce([doomed, survivor]);
      deleteIncident.mockResolvedValueOnce({ id: "inc-doomed", deletedRuns: 0 });
      const user = userEvent.setup();
      render(<IncidentsClient />);
      await screen.findByText("Doomed incident");

      // The second listing is what the post-delete refetch receives.
      listIncidents.mockResolvedValueOnce([survivor]);
      await user.click(screen.getByRole("button", { name: /delete doomed incident/i }));
      await user.click(screen.getByRole("button", { name: /confirm/i }));

      expect(deleteIncident).toHaveBeenCalledWith("inc-doomed");
      expect(await screen.findByText("Surviving incident")).toBeInTheDocument();
      expect(screen.queryByText("Doomed incident")).toBeNull();
    });

    // Each row carries its own control, so arming one must not arm the
    // others — otherwise a list of ten shows ten confirm buttons at once
    // and the operator can commit the wrong one.
    it("arms only the row whose delete was clicked", async () => {
      listIncidents.mockResolvedValueOnce([
        makeIncident({ id: "inc-a", title: "First incident" }),
        makeIncident({ id: "inc-b", title: "Second incident" })
      ]);
      const user = userEvent.setup();
      render(<IncidentsClient />);
      await screen.findByText("First incident");

      await user.click(screen.getByRole("button", { name: /delete first incident/i }));

      expect(screen.getAllByRole("button", { name: /confirm/i })).toHaveLength(1);
      expect(screen.getByRole("button", { name: /delete second incident/i })).toBeInTheDocument();
    });
  });

  describe("stale filter-change races", () => {
    it("leaves the SECOND filter's results displayed when a slow first request resolves after a fast second", async () => {
      let resolveFirst: (value: IncidentRow[]) => void = () => {};
      listIncidents.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
      const { rerender } = render(<IncidentsClient />);
      await screen.findByRole("status", { name: /loading incidents/i });

      listIncidents.mockResolvedValueOnce([makeIncident({ id: "inc-2", title: "Second filter result" })]);
      searchParamsValue = new URLSearchParams("status=open");
      rerender(<IncidentsClient />);

      expect(await screen.findByText("Second filter result")).toBeInTheDocument();

      resolveFirst([makeIncident({ id: "inc-1", title: "First filter result" })]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("Second filter result")).toBeInTheDocument();
      expect(screen.queryByText("First filter result")).not.toBeInTheDocument();
    });

    it("does not let an obsolete error from the first filter replace the second filter's data", async () => {
      let rejectFirst: (error: Error) => void = () => {};
      listIncidents.mockImplementationOnce(() => new Promise((_resolve, reject) => (rejectFirst = reject)));
      const { rerender } = render(<IncidentsClient />);
      await screen.findByRole("status", { name: /loading incidents/i });

      listIncidents.mockResolvedValueOnce([makeIncident({ id: "inc-2", title: "Second filter result" })]);
      searchParamsValue = new URLSearchParams("status=open");
      rerender(<IncidentsClient />);

      expect(await screen.findByText("Second filter result")).toBeInTheDocument();

      rejectFirst(new Error("stale failure from the first filter"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByText("Second filter result")).toBeInTheDocument();
      expect(screen.queryByText(/could not load incidents/i)).not.toBeInTheDocument();
    });

    it("aborts the in-flight request on unmount", async () => {
      let observedSignal: AbortSignal | undefined;
      listIncidents.mockImplementation(
        (_status?: string, _limit?: number, signal?: AbortSignal) =>
          new Promise<IncidentRow[]>((resolve) => {
            observedSignal = signal;
            setTimeout(() => resolve([]), 50);
          })
      );
      const { unmount } = render(<IncidentsClient />);
      await screen.findByRole("status", { name: /loading incidents/i });

      expect(observedSignal?.aborted).toBe(false);
      unmount();
      expect(observedSignal?.aborted).toBe(true);
    });
  });
});
