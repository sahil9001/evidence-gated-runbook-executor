// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { accountInitial, Navbar } from "./Navbar";
import * as auth from "../../lib/auth";
import { ApiClientError } from "../../lib/api";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    createElement("img", { alt: String(props.alt ?? "") })
}));

const USER = { id: "u1", email: "operator@example.com", createdAt: "2026-08-28T00:00:00.000Z" };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Navbar", () => {
  it("offers a way in when nobody is signed in", async () => {
    vi.spyOn(auth, "currentUser").mockResolvedValue(null);

    render(<Navbar />);

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy());
    expect(screen.getAllByRole("link", { name: "Sign in" })[0].getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: /Get started/ }).getAttribute("href")).toBe("/register");
    expect(screen.getAllByRole("link", { name: "Platform" })[0].getAttribute("href")).toBe(
      "#platform"
    );
    expect(screen.getAllByRole("link", { name: "Integrations" })[0].getAttribute("href")).toBe(
      "#integrations"
    );
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
  });

  it("collapses a signed-in operator's controls into an account menu", async () => {
    vi.spyOn(auth, "currentUser").mockResolvedValue(USER);

    render(<Navbar />);

    const trigger = await screen.findByRole("button", {
      name: `Account menu for ${USER.email}`
    });
    // The initial stands in for the console link that used to sit in the bar.
    expect(trigger).toHaveTextContent("O");
    expect(screen.queryByRole("menuitem", { name: /Open console/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();

    await userEvent.click(trigger);

    expect(await screen.findByText(USER.email)).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Open console/ }).getAttribute("href")
    ).toBe("/app");
    expect(screen.getByRole("menuitem", { name: /Sign out/ })).toBeTruthy();
  });

  it("renders the signed-out nav before the session check answers", () => {
    // The first paint happens before the request resolves. A public page
    // should show the anonymous view then, not a blank or a console link.
    vi.spyOn(auth, "currentUser").mockReturnValue(new Promise(() => {}));

    render(<Navbar />);

    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
  });

  it("keeps the signed-out nav when the session check fails outright", async () => {
    // A broken or unreachable API must not be presented as "signed in".
    vi.spyOn(auth, "currentUser").mockRejectedValue(
      new ApiClientError("Network request failed", "network_error", 0)
    );

    render(<Navbar />);

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
  });

  it("swaps back to the signed-out nav after signing out from the menu", async () => {
    const currentUser = vi.spyOn(auth, "currentUser").mockResolvedValue(USER);
    const logout = vi.spyOn(auth, "logout").mockResolvedValue(undefined);

    render(<Navbar />);
    const trigger = await screen.findByRole("button", {
      name: `Account menu for ${USER.email}`
    });

    currentUser.mockResolvedValue(null);
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Sign out/ }));

    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Account menu/ })).toBeNull();
  });
});

describe("accountInitial", () => {
  it("uses the first character of the email, upper-cased", () => {
    expect(accountInitial("operator@example.com")).toBe("O");
    expect(accountInitial("  zoe@example.com")).toBe("Z");
    expect(accountInitial("7ops@example.com")).toBe("7");
  });

  it("falls back to a placeholder rather than an empty circle", () => {
    expect(accountInitial("")).toBe("\u2022");
    expect(accountInitial("+tag@example.com")).toBe("\u2022");
  });
});
