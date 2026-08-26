import { describe, expect, it } from "vitest";
import { resolveNextPath, withNextParam } from "./next-redirect";

describe("resolveNextPath", () => {
  it("returns the fallback when next is missing", () => {
    expect(resolveNextPath(null)).toBe("/app");
    expect(resolveNextPath(undefined)).toBe("/app");
    expect(resolveNextPath("")).toBe("/app");
  });

  it("honours a valid same-origin relative path", () => {
    expect(resolveNextPath("/app/incidents")).toBe("/app/incidents");
    expect(resolveNextPath("/app/runs/run-1?tab=evidence")).toBe("/app/runs/run-1?tab=evidence");
  });

  it("rejects a protocol-relative URL (//evil.com)", () => {
    expect(resolveNextPath("//evil.com")).toBe("/app");
  });

  it("rejects an absolute URL (https://evil.com)", () => {
    expect(resolveNextPath("https://evil.com")).toBe("/app");
  });

  it("rejects a backslash-prefixed path some browsers normalize to protocol-relative", () => {
    expect(resolveNextPath("/\\evil.com")).toBe("/app");
  });

  it("rejects a path that does not start with a single slash", () => {
    expect(resolveNextPath("app/incidents")).toBe("/app");
    expect(resolveNextPath("javascript:alert(1)")).toBe("/app");
  });

  it("honours a custom fallback", () => {
    expect(resolveNextPath("//evil.com", "/login")).toBe("/login");
  });
});

describe("withNextParam", () => {
  it("appends the next param when present", () => {
    expect(withNextParam("/login", "/app/incidents")).toBe("/login?next=%2Fapp%2Fincidents");
  });

  it("returns the bare path when next is null or empty", () => {
    expect(withNextParam("/login", null)).toBe("/login");
    expect(withNextParam("/login", "")).toBe("/login");
  });
});
