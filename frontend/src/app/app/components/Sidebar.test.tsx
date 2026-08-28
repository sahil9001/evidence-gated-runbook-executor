// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let pathnameValue = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameValue
}));

// Imported after the mock above so the module under test picks it up.
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    pathnameValue = "/app";
  });

  it("marks Overview active on /app, and NOT active on /app/incidents (prefix-match bug)", () => {
    pathnameValue = "/app";
    const { rerender } = render(<Sidebar isOpen={false} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: /overview/i })).toHaveAttribute("aria-current", "page");

    pathnameValue = "/app/incidents";
    rerender(<Sidebar isOpen={false} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: /overview/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /incidents/i })).toHaveAttribute("aria-current", "page");
  });

  it("marks a nested run detail route as belonging to Incidents, not Overview", () => {
    pathnameValue = "/app/incidents/inc-1";
    render(<Sidebar isOpen={false} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: /overview/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: /incidents/i })).toHaveAttribute("aria-current", "page");
  });

  it("renders every nav item with a working link to its route", () => {
    render(<Sidebar isOpen={false} onClose={vi.fn()} />);
    const expected: Record<string, string> = {
      Overview: "/app",
      Incidents: "/app/incidents",
      Runbooks: "/app/runbooks",
      History: "/app/history",
      Audit: "/app/audit"
    };
    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toHaveAttribute("href", href);
    }
  });

  it("closes on Escape while open", () => {
    const onClose = vi.fn();
    render(<Sidebar isOpen onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("does not attach an Escape handler while already closed", () => {
    const onClose = vi.fn();
    render(<Sidebar isOpen={false} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the route changes", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sidebar isOpen onClose={onClose} />);
    onClose.mockClear();

    pathnameValue = "/app/incidents";
    rerender(<Sidebar isOpen onClose={onClose} />);

    expect(onClose).toHaveBeenCalled();
  });
});
