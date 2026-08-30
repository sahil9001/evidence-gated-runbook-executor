// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingSections } from "./LandingSections";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) =>
    createElement("img", { alt, src })
}));

describe("LandingSections", () => {
  it("renders expanded homepage sections with daytime nature assets", () => {
    const { container } = render(<LandingSections />);

    expect(
      screen.getByRole("heading", { name: /From noisy alert to approved run/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Built like a real incident review/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /A control layer for AI-assisted operations/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Packed with proof-first features/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Built for the people who carry incidents/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Designed for the stack that already wakes you up/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Safer automation starts with a stop point/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Ready to review the incident loop/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/judges can understand/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hackathon story/i)).not.toBeInTheDocument();

    const imageSources = Array.from(container.querySelectorAll("img")).map((image) =>
      image.getAttribute("src")
    );
    expect(imageSources).toContain("/landing/daytime-forest-stream.png");
    expect(imageSources).not.toContain("/landing/evidence-command-room.png");
    expect(imageSources).not.toContain("/landing/approval-control-room.png");

    expect(screen.getByRole("contentinfo")).toHaveClass("bg-ink");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
    expect(screen.getByRole("link", { name: "Read security" })).toHaveAttribute(
      "href",
      "/security"
    );
  });
});
