// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

const logout = vi.fn();
const me = vi.fn();
vi.mock("../../../lib/auth", () => ({
  logout: (...args: unknown[]) => logout(...args),
  me: (...args: unknown[]) => me(...args)
}));

const getOverview = vi.fn();
vi.mock("../../../lib/api", () => ({
  getOverview: (...args: unknown[]) => getOverview(...args)
}));

// Imported after the mocks above so the module under test picks them up.
import { TopBar } from "./TopBar";

describe("TopBar", () => {
  beforeEach(() => {
    push.mockClear();
    logout.mockReset();
    me.mockReset();
    getOverview.mockReset();
    me.mockResolvedValue({ id: "u1", email: "oncall@runproof.dev", createdAt: "t" });
  });

  it("renders the awaiting-approval count from /overview", async () => {
    getOverview.mockResolvedValue({ awaitingApproval: 3, activeIncidents: 1, runsToday: 2, recentActivity: [] });
    render(<TopBar onOpenNav={vi.fn()} />);

    expect(await screen.findByText(/3 awaiting approval/i)).toBeInTheDocument();
  });

  it("renders the shell (email, logout) without the badge when /overview fails", async () => {
    getOverview.mockRejectedValue(new Error("network down"));
    render(<TopBar onOpenNav={vi.fn()} />);

    expect(await screen.findByText("oncall@runproof.dev")).toBeInTheDocument();
    await waitFor(() => expect(getOverview).toHaveBeenCalled());
    expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("calls logout() and redirects to /login", async () => {
    getOverview.mockResolvedValue({ awaitingApproval: 0, activeIncidents: 0, runsToday: 0, recentActivity: [] });
    logout.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TopBar onOpenNav={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /log out/i }));

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("still redirects to /login even when logout() rejects", async () => {
    getOverview.mockResolvedValue({ awaitingApproval: 0, activeIncidents: 0, runsToday: 0, recentActivity: [] });
    logout.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    render(<TopBar onOpenNav={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: /log out/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("calls onOpenNav when the hamburger is clicked", async () => {
    getOverview.mockResolvedValue({ awaitingApproval: 0, activeIncidents: 0, runsToday: 0, recentActivity: [] });
    const onOpenNav = vi.fn();
    const user = userEvent.setup();
    render(<TopBar onOpenNav={onOpenNav} />);

    await user.click(screen.getByRole("button", { name: /open navigation/i }));

    expect(onOpenNav).toHaveBeenCalled();
  });
});
