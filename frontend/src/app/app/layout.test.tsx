// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathnameValue = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameValue,
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock("../../lib/auth", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  me: vi.fn().mockResolvedValue({ id: "u1", email: "oncall@runproof.dev", createdAt: "t" })
}));

vi.mock("../../lib/api", () => ({
  getOverview: vi.fn().mockResolvedValue({ awaitingApproval: 0, activeIncidents: 0, runsToday: 0, recentActivity: [] })
}));

// Imported after the mocks above so the module under test picks them up.
import ConsoleLayout from "./layout";

describe("ConsoleLayout", () => {
  beforeEach(() => {
    pathnameValue = "/app";
  });

  it("opens the mobile nav drawer via the hamburger, and closes it on Escape", async () => {
    const user = userEvent.setup();
    render(
      <ConsoleLayout>
        <div>screen content</div>
      </ConsoleLayout>
    );

    expect(screen.queryByTestId("mobile-nav-backdrop")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open navigation/i }));
    expect(screen.getByTestId("mobile-nav-backdrop")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("mobile-nav-backdrop")).not.toBeInTheDocument();
  });

  it("renders the page content passed as children", () => {
    render(
      <ConsoleLayout>
        <div>screen content</div>
      </ConsoleLayout>
    );

    expect(screen.getByText("screen content")).toBeInTheDocument();
  });
});
