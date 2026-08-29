// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Navbar } from "./Navbar";
import * as auth from "../../lib/auth";
import { ApiClientError } from "../../lib/api";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? "")} />
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
    expect(screen.queryByRole("button", { name: /Sign out/ })).toBeNull();
  });

  it("points a signed-in operator at the console instead", async () => {
    vi.spyOn(auth, "currentUser").mockResolvedValue(USER);

    render(<Navbar />);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Open console/ }).getAttribute("href")).toBe("/app")
    );
    expect(screen.getAllByRole("button", { name: /Sign out/ })[0]).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("renders the signed-out nav before the session check answers", () => {
    // The first paint happens before the request resolves. A public page
    // should show the anonymous view then, not a blank or a console link.
    vi.spyOn(auth, "currentUser").mockReturnValue(new Promise(() => {}));

    render(<Navbar />);

    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open console/ })).toBeNull();
  });

  it("keeps the signed-out nav when the session check fails outright", async () => {
    // A broken or unreachable API must not be presented as "signed in".
    vi.spyOn(auth, "currentUser").mockRejectedValue(
      new ApiClientError("Network request failed", "network_error", 0)
    );

    render(<Navbar />);

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy());
    expect(screen.queryByRole("link", { name: /Open console/ })).toBeNull();
  });

  it("swaps back to the signed-out nav after signing out", async () => {
    const currentUser = vi.spyOn(auth, "currentUser").mockResolvedValue(USER);
    const logout = vi.spyOn(auth, "logout").mockResolvedValue(undefined);

    render(<Navbar />);
    await waitFor(() => expect(screen.getByRole("link", { name: /Open console/ })).toBeTruthy());

    currentUser.mockResolvedValue(null);
    await userEvent.click(screen.getAllByRole("button", { name: /Sign out/ })[0]);

    expect(logout).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toBeTruthy());
    expect(screen.queryByRole("link", { name: /Open console/ })).toBeNull();
  });
});
