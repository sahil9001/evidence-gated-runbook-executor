import { describe, expect, it } from "vitest";
import { matchRunbook } from "./matchRunbook";
import type { Runbook } from "./types";

function makeRunbook(overrides: Partial<Runbook> = {}): Runbook {
  return {
    id: "rb-1",
    title: "Checkout payment-service failure",
    trigger: { service: "payment-service", signals: ["timeout", "error_rate"] },
    allowedSources: ["logs", "metrics", "deploys"],
    steps: [{ id: "s1", label: "Alert received", detail: "..." }],
    proposedAction: {
      kind: "rollback",
      target: "payment-service",
      params: {},
      reversible: true,
      description: "Roll back payment-service"
    },
    ...overrides
  };
}

describe("matchRunbook", () => {
  it("returns null when no runbook targets the given service", () => {
    const runbooks = [makeRunbook({ trigger: { service: "payment-service", signals: ["timeout"] } })];

    const result = matchRunbook(runbooks, { service: "checkout-service", signals: ["timeout"] });

    expect(result).toBeNull();
  });

  it("returns the single runbook that overlaps on at least one signal", () => {
    const runbook = makeRunbook({ trigger: { service: "payment-service", signals: ["timeout", "error_rate"] } });

    const result = matchRunbook([runbook], { service: "payment-service", signals: ["timeout"] });

    expect(result).toBe(runbook);
  });

  it("returns null when the service matches but zero signals overlap", () => {
    const runbook = makeRunbook({ trigger: { service: "payment-service", signals: ["timeout", "error_rate"] } });

    const result = matchRunbook([runbook], { service: "payment-service", signals: ["memory_leak"] });

    expect(result).toBeNull();
  });

  it("returns null when the service matches but no signals were selected", () => {
    const runbook = makeRunbook({ trigger: { service: "payment-service", signals: ["timeout", "error_rate"] } });

    const result = matchRunbook([runbook], { service: "payment-service", signals: [] });

    expect(result).toBeNull();
  });

  it("picks the candidate with the strictly higher signal overlap", () => {
    const weak = makeRunbook({ id: "rb-weak", trigger: { service: "payment-service", signals: ["timeout"] } });
    const strong = makeRunbook({
      id: "rb-strong",
      trigger: { service: "payment-service", signals: ["timeout", "error_rate"] }
    });

    const result = matchRunbook([weak, strong], {
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });

    expect(result).toBe(strong);
  });

  it("returns null on a tie between two equally-matching runbooks (mirrors the backend rule)", () => {
    const first = makeRunbook({ id: "rb-a", trigger: { service: "payment-service", signals: ["timeout"] } });
    const second = makeRunbook({ id: "rb-b", trigger: { service: "payment-service", signals: ["error_rate"] } });

    const result = matchRunbook([first, second], {
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });

    expect(result).toBeNull();
  });

  it("returns null on a three-way tie, not just two", () => {
    const a = makeRunbook({ id: "rb-a", trigger: { service: "svc", signals: ["x"] } });
    const b = makeRunbook({ id: "rb-b", trigger: { service: "svc", signals: ["y"] } });
    const c = makeRunbook({ id: "rb-c", trigger: { service: "svc", signals: ["z"] } });

    const result = matchRunbook([a, b, c], { service: "svc", signals: ["x", "y", "z"] });

    expect(result).toBeNull();
  });
});
