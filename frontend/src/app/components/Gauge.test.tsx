// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Gauge } from "./Gauge";

/** Every coordinate attribute on every tick, as the DOM actually holds them. */
function coordinateAttributes(container: HTMLElement): string[] {
  return [...container.querySelectorAll("line")].flatMap((line) =>
    (["x1", "y1", "x2", "y2"] as const).map((name) => line.getAttribute(name) ?? "")
  );
}

function decimalPlaces(value: string): number {
  const [, fraction = ""] = value.split(".");
  return fraction.length;
}

describe("Gauge", () => {
  it("emits coordinates short enough to survive hydration", () => {
    // Math.cos and Math.sin are implementation-approximated in ECMAScript, so
    // the server's Node build and the browser can differ in the last bit. Full
    // precision puts that difference straight into an attribute, and React
    // rejects the tree with a hydration mismatch. Rounding is what makes the
    // two agree, so the rounding is the thing worth pinning.
    const { container } = render(<Gauge value={82} />);
    const coordinates = coordinateAttributes(container);

    expect(coordinates.length).toBe(40 * 4);
    const overprecise = coordinates.filter((value) => decimalPlaces(value) > 3);
    expect(overprecise).toEqual([]);
  });

  it("renders identically across repeated renders, as hydration requires", () => {
    const first = render(<Gauge value={82} />);
    const firstCoordinates = coordinateAttributes(first.container);
    first.unmount();

    const second = render(<Gauge value={82} />);
    expect(coordinateAttributes(second.container)).toEqual(firstCoordinates);
  });

  it("keeps the geometry fixed while the value only changes how many ticks are lit", () => {
    // Guards the rounding against being made value-dependent later: geometry
    // must not move when the score does, or a re-render could disagree with
    // the server's HTML for a reason no test currently covers.
    const low = render(<Gauge value={12} />);
    const lowCoordinates = coordinateAttributes(low.container);
    low.unmount();

    const high = render(<Gauge value={97} />);
    expect(coordinateAttributes(high.container)).toEqual(lowCoordinates);
  });
});
