import { describe, it, expect } from "vitest";
import { loadRunbook, matchRunbook, RunbookValidationError, type Runbook } from "./runbook";
import checkoutFailureRaw from "../../../testing/runbooks/checkout-failure.json";

const validRunbook = (): unknown => ({
  id: "checkout-failure",
  title: "Checkout payment-service failure",
  trigger: {
    service: "payment-service",
    signals: ["timeout", "error_rate"]
  },
  allowedSources: ["logs", "metrics", "deploys"],
  steps: [
    { id: "alert-received", label: "Alert received", detail: "Checkout error rate increased." },
    { id: "evidence-gathered", label: "Evidence gathered", detail: "Logs and metrics agree.", source: "logs" },
    { id: "sandbox-check", label: "Sandbox check", detail: "Diagnostic reproduced the failure." },
    { id: "approval-required", label: "Approval required", detail: "Rollback stays locked until approved." }
  ],
  proposedAction: {
    kind: "rollback",
    target: "payment-service",
    params: { commit: "8f31c2b" },
    reversible: true,
    description: "Roll back payment-service to 8f31c2b"
  }
});

describe("loadRunbook", () => {
  it("parses a well-formed runbook and round-trips every field", () => {
    const input = validRunbook();
    const runbook = loadRunbook(input);
    expect(runbook).toEqual(input);
  });

  it("throws RunbookValidationError naming the offending field when allowedSources has an unknown entry", () => {
    const input = validRunbook() as { allowedSources: string[] };
    input.allowedSources = ["logs", "telepathy"];

    expect(() => loadRunbook(input)).toThrow(RunbookValidationError);
    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("allowedSources");
    }
  });

  it("throws RunbookValidationError when steps is empty, because a runbook with no steps authorizes nothing", () => {
    const input = validRunbook() as { steps: unknown[] };
    input.steps = [];

    expect(() => loadRunbook(input)).toThrow(RunbookValidationError);
    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("steps");
    }
  });

  it("throws RunbookValidationError naming the field path for a nested malformed field", () => {
    const input = validRunbook() as { trigger: { service: unknown } };
    input.trigger.service = "";

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("trigger.service");
    }
  });
});

describe("matchRunbook", () => {
  const base = validRunbook() as Omit<Runbook, "id" | "trigger">;

  const runbook = (id: string, service: string, signals: string[]): Runbook =>
    loadRunbook({ ...base, id, trigger: { service, signals } });

  it("picks the candidate sharing the most signals with the incident", () => {
    const lowOverlap = runbook("low-overlap", "payment-service", ["timeout"]);
    const highOverlap = runbook("high-overlap", "payment-service", ["timeout", "error_rate", "latency"]);
    const unrelated = runbook("unrelated", "checkout-service", ["timeout", "error_rate", "latency"]);

    const result = matchRunbook(
      [lowOverlap, highOverlap, unrelated],
      { service: "payment-service", signals: ["timeout", "error_rate", "latency"] }
    );

    expect(result?.id).toBe("high-overlap");
  });

  it("returns null when no runbook targets the incident's service", () => {
    const runbookForOtherService = runbook("other-service-runbook", "checkout-service", ["timeout"]);

    const result = matchRunbook(
      [runbookForOtherService],
      { service: "payment-service", signals: ["timeout"] }
    );

    expect(result).toBeNull();
  });

  it("returns null when the best candidate shares zero signals with the incident", () => {
    const noOverlap = runbook("no-overlap", "payment-service", ["disk_full"]);

    const result = matchRunbook(
      [noOverlap],
      { service: "payment-service", signals: ["timeout", "error_rate"] }
    );

    expect(result).toBeNull();
  });

  it("returns null on an exact tie rather than guessing", () => {
    const a = runbook("a", "checkout", ["timeout"]);
    const b = runbook("b", "checkout", ["timeout"]);

    expect(matchRunbook([a, b], { service: "checkout", signals: ["timeout"] })).toBeNull();
  });

  it("returns null on a genuine multi-way tie, not just a two-way one", () => {
    const a = runbook("a", "checkout", ["timeout", "error_rate"]);
    const b = runbook("b", "checkout", ["timeout", "latency"]);
    const c = runbook("c", "checkout", ["error_rate", "latency"]);

    // Each shares exactly 1 signal with the incident's ["timeout", "error_rate", "latency"]... adjust below.
    const result = matchRunbook(
      [a, b, c],
      { service: "checkout", signals: ["timeout", "error_rate", "latency"] }
    );

    // a: {timeout, error_rate} -> overlap 2, b: {timeout, latency} -> overlap 2, c: {error_rate, latency} -> overlap 2
    expect(result).toBeNull();
  });

  it("returns null when given zero candidates", () => {
    expect(matchRunbook([], { service: "payment-service", signals: ["timeout"] })).toBeNull();
  });
});

describe("checkout-failure.json", () => {
  it("loads as a valid runbook matching the UI timeline and the checkout incident", () => {
    const runbook = loadRunbook(checkoutFailureRaw);

    expect(runbook.trigger.service).toBe("payment-service");
    expect(runbook.trigger.signals).toEqual(expect.arrayContaining(["timeout", "error_rate"]));
    expect(runbook.allowedSources).toEqual(["logs", "metrics", "deploys"]);
    expect(runbook.steps.map((step) => step.label)).toEqual([
      "Alert received",
      "Evidence gathered",
      "Sandbox check",
      "Approval required"
    ]);
    expect(runbook.proposedAction.kind).toBe("rollback");
    expect(runbook.proposedAction.target).toBe("payment-service");
  });

  it("is matched by matchRunbook for the checkout incident the frontend displays", () => {
    const runbook = loadRunbook(checkoutFailureRaw);

    const result = matchRunbook(
      [runbook],
      { service: "payment-service", signals: ["timeout", "error_rate"] }
    );

    expect(result?.id).toBe("checkout-failure");
  });
});
