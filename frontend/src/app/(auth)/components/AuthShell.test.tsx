// @vitest-environment jsdom
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthShell } from "./AuthShell";

vi.mock("next/image", () => ({
  default: ({
    alt,
    fill,
    priority,
    sizes,
    src,
    unoptimized
  }: {
    alt: string;
    fill?: boolean;
    priority?: boolean;
    sizes?: string;
    src: string;
    unoptimized?: boolean;
  }) =>
    createElement("img", {
      alt,
      "data-fill": fill,
      "data-priority": priority,
      "data-unoptimized": unoptimized,
      sizes,
      src
    })
}));

describe("AuthShell", () => {
  it("renders the shared full-bleed split-screen auth frame with decorative pixel scenery", () => {
    const { container } = render(
      <AuthShell title="Welcome back" subtitle="Sign in to review evidence and decide what ships.">
        <button type="button">Form action</button>
      </AuthShell>
    );

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to review evidence and decide what ships.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Form action" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "RunProof" })).toHaveAttribute(
      "src",
      "/brand/runproof-wordmark-black.png"
    );

    const main = container.querySelector("main");
    expect(main).toHaveClass("min-h-[100dvh]", "w-screen", "bg-white");

    const splitGrid = container.querySelector(".grid");
    expect(splitGrid).toHaveClass("min-h-[100dvh]", "w-screen", "lg:grid-cols-2");

    const mediaSection = container.querySelector("section[aria-hidden='true']");
    const sceneryImage = mediaSection?.querySelector("img");
    expect(mediaSection).toHaveClass("lg:min-h-[100dvh]");
    expect(sceneryImage).toHaveAttribute("alt", "");
    expect(sceneryImage).toHaveAttribute("src", "/auth/pixel-tulip-windmill.png");
    expect(sceneryImage).toHaveAttribute("data-fill", "true");
    expect(sceneryImage).toHaveAttribute("data-priority", "true");
    expect(sceneryImage).toHaveAttribute("data-unoptimized", "true");
    expect(sceneryImage).toHaveAttribute("sizes", "(min-width: 1024px) 50vw, 100vw");
  });
});
