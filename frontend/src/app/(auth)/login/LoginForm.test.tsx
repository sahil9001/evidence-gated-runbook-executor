// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "../../../lib/api";

const push = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue
}));

const login = vi.fn();
vi.mock("../../../lib/auth", () => ({
  login: (...args: unknown[]) => login(...args)
}));

// Imported after the mocks above so the module under test picks them up.
import { LoginForm } from "./LoginForm";

describe("LoginForm", () => {
  beforeEach(() => {
    push.mockClear();
    login.mockReset();
    searchParamsValue = new URLSearchParams();
  });

  it("surfaces field errors for invalid input without calling the API", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("surfaces a field error for a malformed email without calling the API", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText(/password/i), "whatever");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("renders the backend's generic invalid_credentials message verbatim and never reveals whether the email exists", async () => {
    login.mockRejectedValueOnce(new ApiClientError("Invalid email or password", "invalid_credentials", 401));
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password");
    expect(alert.textContent?.toLowerCase()).not.toContain("no account");
    expect(alert.textContent?.toLowerCase()).not.toContain("exist");
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveLogin: (() => void) | undefined;
    login.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = () => resolve({ id: "u1", email: "a@b.com", createdAt: "t" });
      })
    );
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();

    resolveLogin?.();
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("calls login with the entered credentials on valid submit", async () => {
    login.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("a@b.com", "correcthorsebattery"));
  });

  it("redirects to /app by default on successful login", async () => {
    login.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  it("redirects to a valid `next` path when provided", async () => {
    searchParamsValue = new URLSearchParams({ next: "/app/incidents" });
    login.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/incidents"));
  });

  it("rejects an open-redirect `next` param (//evil.com) and falls back to /app", async () => {
    searchParamsValue = new URLSearchParams({ next: "//evil.com" });
    login.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });

  it("rejects an open-redirect `next` param (https://evil.com) and falls back to /app", async () => {
    searchParamsValue = new URLSearchParams({ next: "https://evil.com" });
    login.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });
});
