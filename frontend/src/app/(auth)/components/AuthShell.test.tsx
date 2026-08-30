// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthShell } from "./AuthShell";

vi.mock("next/image", () => ({
  default: ({
    alt,
    fill,
    priority,
    sizes,
    src,
    unoptimized,
    ...rest
  }: {
    alt: string;
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    src: string;
    unoptimized?: boolean;
  } & Record<string, unknown>) =>
    createElement("img", {
      ...rest,
      alt,
      "data-fill": fill,
      "data-priority": priority,
      "data-unoptimized": unoptimized,
      sizes,
      src
    })
}));

describe("AuthShell", () => {
  it("renders the shared full-bleed split-screen auth frame", () => {
    const { container } = render(
      <AuthShell title="Welcome back" subtitle="Sign in to review evidence and decide what ships.">
        <button type="button">Form action</button>
      </AuthShell>
    );

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to review evidence and decide what ships.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Form action" })).toBeInTheDocument();

    const main = container.querySelector("main");
    expect(main).toHaveClass("min-h-[100dvh]", "w-screen", "bg-white");

    const splitGrid = container.querySelector(".grid");
    expect(splitGrid).toHaveClass("min-h-[100dvh]", "w-screen", "grid-cols-1");
  });

  it("keeps the pixel scenery decorative and eagerly loaded", () => {
    render(
      <AuthShell title="Welcome back" subtitle="Sign in.">
        <button type="button">Form action</button>
      </AuthShell>
    );

    // Empty alt + aria-hidden: the scenery carries no information, and the
    // proof list beside it is the accessible content of that panel.
    const scenery = document.querySelector("img[src='/auth/pixel-tulip-windmill.png']");
    expect(scenery).toHaveAttribute("alt", "");
    expect(scenery).toHaveAttribute("aria-hidden", "true");
    expect(scenery).toHaveAttribute("data-fill", "true");
    expect(scenery).toHaveAttribute("data-priority", "true");
    expect(scenery).toHaveAttribute("data-unoptimized", "true");
    expect(scenery).toHaveAttribute("sizes", "(min-width: 1024px) 52vw, 100vw");
  });

  it("uses the media panel to restate what the product guarantees", () => {
    render(
      <AuthShell title="Welcome back" subtitle="Sign in.">
        <button type="button">Form action</button>
      </AuthShell>
    );

    expect(screen.getByText("Evidence packet")).toBeInTheDocument();
    expect(screen.getByText("Sandbox replay")).toBeInTheDocument();
    expect(screen.getByText("Human approval")).toBeInTheDocument();
  });

  it("offers a labelled way back to the marketing site and to the policy pages", () => {
    render(
      <AuthShell title="Welcome back" subtitle="Sign in.">
        <button type="button">Form action</button>
      </AuthShell>
    );

    expect(screen.getByRole("link", { name: "RunProof home" })).toHaveAttribute("href", "/");
    expect(within(screen.getByRole("link", { name: "RunProof home" })).getByRole("img")).toHaveAttribute(
      "src",
      "/brand/runproof-wordmark-black.png"
    );
    expect(screen.getByRole("link", { name: /Back to site/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });
});
