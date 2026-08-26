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

const register = vi.fn();
vi.mock("../../../lib/auth", () => ({
  register: (...args: unknown[]) => register(...args)
}));

// Imported after the mocks above so the module under test picks them up.
import { RegisterForm } from "./RegisterForm";

describe("RegisterForm", () => {
  beforeEach(() => {
    push.mockClear();
    register.mockReset();
    searchParamsValue = new URLSearchParams();
  });

  it("surfaces field errors for empty input without calling the API", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a password/i)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it("surfaces a field error when the password is under 12 characters, without calling the API", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "short1234");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it("renders the backend's email_taken message when registration fails", async () => {
    register.mockRejectedValueOnce(
      new ApiClientError('An account with email "a@b.com" already exists', "email_taken", 409)
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/already exists/i);
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveRegister: (() => void) | undefined;
    register.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRegister = () => resolve({ id: "u1", email: "a@b.com", createdAt: "t" });
      })
    );
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.getByRole("button", { name: /creating account/i })).toBeDisabled();

    resolveRegister?.();
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("calls register with the entered credentials on valid submit", async () => {
    register.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(register).toHaveBeenCalledWith("a@b.com", "correcthorsebattery"));
  });

  it("honours a valid `next` path (/app/incidents) after successful registration", async () => {
    searchParamsValue = new URLSearchParams({ next: "/app/incidents" });
    register.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/incidents"));
  });

  it("rejects an open-redirect `next` param (//evil.com) and falls back to /app", async () => {
    searchParamsValue = new URLSearchParams({ next: "//evil.com" });
    register.mockResolvedValueOnce({ id: "u1", email: "a@b.com", createdAt: "t" });
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "correcthorsebattery");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });
});
