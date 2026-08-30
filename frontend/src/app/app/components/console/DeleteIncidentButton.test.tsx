// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "../../../../lib/api";

const deleteIncident = vi.fn();
vi.mock("../../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/api")>("../../../../lib/api");
  return {
    ...actual,
    deleteIncident: (...args: unknown[]) => deleteIncident(...args)
  };
});

// Imported after the mock above so the module under test picks it up.
import { DeleteIncidentButton } from "./DeleteIncidentButton";

function renderButton(onDeleted = vi.fn()) {
  render(
    <DeleteIncidentButton
      incidentId="inc-1"
      incidentTitle="Checkout errors spiking"
      onDeleted={onDeleted}
    />
  );
  return { onDeleted };
}

describe("DeleteIncidentButton", () => {
  beforeEach(() => {
    deleteIncident.mockReset();
  });

  // The accessible name has to name the incident, not just say "Delete":
  // the list renders one of these per row, and a screen reader moving
  // between them would otherwise hear the same label every time with no way
  // to tell which incident is about to go.
  it("names the incident in its accessible label", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /delete checkout errors spiking/i })).toBeTruthy();
  });

  // The whole point of the two-step control: the destructive call must not
  // be one stray click away.
  it("asks for confirmation instead of deleting on the first click", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));

    expect(deleteIncident).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeTruthy();
  });

  it("deletes and reports back once confirmed", async () => {
    const user = userEvent.setup();
    deleteIncident.mockResolvedValue({ id: "inc-1", deletedRuns: 2 });
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(deleteIncident).toHaveBeenCalledWith("inc-1");
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("returns to its resting state on cancel, having called nothing", async () => {
    const user = userEvent.setup();
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteIncident).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /delete checkout errors spiking/i })).toBeTruthy();
  });

  // A second confirm click while the first request is still open would
  // delete once and 404 once, surfacing an error for an operation that
  // actually succeeded.
  it("disables confirm while the delete is in flight", async () => {
    const user = userEvent.setup();
    let resolveDelete: (value: unknown) => void = () => {};
    deleteIncident.mockImplementation(() => new Promise((resolve) => (resolveDelete = resolve)));
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(screen.getByRole("button", { name: /deleting/i }).hasAttribute("disabled")).toBe(true);

    resolveDelete({ id: "inc-1", deletedRuns: 0 });
    await screen.findByRole("button", { name: /delete checkout errors spiking/i }).catch(() => undefined);
    expect(deleteIncident).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });

  it("shows the failure and keeps the row when the delete fails", async () => {
    const user = userEvent.setup();
    deleteIncident.mockRejectedValue(new ApiClientError("boom", "internal_error", 500));
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  // Someone else deleting it first, or a stale list, both land here. The
  // incident is gone either way, which is what the click asked for — so
  // this reports success and lets the caller refresh rather than showing an
  // error for an outcome the operator wanted.
  it("treats an already-deleted incident as success", async () => {
    const user = userEvent.setup();
    deleteIncident.mockRejectedValue(new ApiClientError("No incident found", "not_found", 404));
    const { onDeleted } = renderButton();

    await user.click(screen.getByRole("button", { name: /delete checkout errors spiking/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
