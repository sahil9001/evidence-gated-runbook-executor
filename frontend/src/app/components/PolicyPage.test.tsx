// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PolicyPage } from "./PolicyPage";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src })
}));

describe("PolicyPage", () => {
  it("renders a themed policy page with navigation and nature artwork", () => {
    const { container } = render(
      <PolicyPage
        badge="Privacy"
        title="Privacy built around operational trust."
        description="A short policy description."
        sections={[
          { title: "What we collect", body: "Only product data needed for the workflow." },
          { title: "How we use data", body: "To operate the evidence-gated product." }
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: /Privacy built around/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("heading", { name: "What we collect" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveClass("bg-ink");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");

    const imageSources = Array.from(container.querySelectorAll("img")).map((image) =>
      image.getAttribute("src")
    );
    expect(imageSources).toContain("/landing/daytime-forest-stream.png");
  });
});
