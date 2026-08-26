import { describe, it, expect } from "vitest";
import { loadRunbook, matchRunbook, RunbookValidationError, type Runbook } from "./runbook";
import { createAction } from "./action";
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

  it("throws RunbookValidationError naming trigger.signals when signals contain a duplicate", () => {
    const input = validRunbook() as { trigger: { signals: string[] } };
    input.trigger.signals = ["timeout", "timeout"];

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("trigger.signals");
    }
  });

  it("throws RunbookValidationError naming allowedSources when allowedSources contain a duplicate", () => {
    const input = validRunbook() as { allowedSources: string[] };
    input.allowedSources = ["logs", "logs", "metrics"];

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("allowedSources");
    }
  });

  it("throws RunbookValidationError naming proposedAction.params when params contain a non-finite number", () => {
    const input = validRunbook() as { proposedAction: { params: Record<string, unknown> } };
    input.proposedAction.params = { retries: Infinity };

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("proposedAction.params");
    }
  });

  it("loads a runbook whose proposedAction.params are valid JSON-safe values", () => {
    const input = validRunbook() as { proposedAction: { params: Record<string, unknown> } };
    input.proposedAction.params = { commit: "8f31c2b", attempt: 2, forced: true, note: null, tags: ["a", "b"] };

    const runbook = loadRunbook(input);
    expect(runbook.proposedAction.params).toEqual(input.proposedAction.params);
  });

  it("never lets createAction throw on the proposedAction of a runbook that already passed loadRunbook", () => {
    const runbook = loadRunbook(checkoutFailureRaw);
    expect(() =>
      createAction({
        id: `${runbook.id}-proposed-action`,
        ...runbook.proposedAction
      })
    ).not.toThrow();
  });

  it("loads a runbook with no diagnostic field, since diagnostic is optional", () => {
    const input = validRunbook() as { diagnostic?: unknown };
    expect(input.diagnostic).toBeUndefined();
    const runbook = loadRunbook(input);
    expect(runbook.diagnostic).toBeUndefined();
  });

  it("loads a runbook whose diagnostic field round-trips script, description, and expectedOutput", () => {
    const input = validRunbook() as { diagnostic?: unknown };
    input.diagnostic = {
      description: "Reproduces the timeout in isolation and reports the likely bad commit.",
      script: "print('timeout_ms=3000')",
      expectedOutput: "timeout_ms=<int> / failed_requests=<int> / likely_commit=<sha> / recommendation=<rollback|none>"
    };
    const runbook = loadRunbook(input);
    expect(runbook.diagnostic).toEqual(input.diagnostic);
  });

  it("throws RunbookValidationError naming diagnostic.script when script is empty", () => {
    const input = validRunbook() as { diagnostic?: { description: string; script: string; expectedOutput: string } };
    input.diagnostic = { description: "checks something", script: "", expectedOutput: "some output" };

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("diagnostic.script");
    }
  });

  it("throws RunbookValidationError naming diagnostic.script when script is whitespace-only", () => {
    const input = validRunbook() as { diagnostic?: { description: string; script: string; expectedOutput: string } };
    input.diagnostic = { description: "checks something", script: "   ", expectedOutput: "some output" };

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("diagnostic.script");
    }
  });

  it("throws RunbookValidationError naming diagnostic.description when description is whitespace-only", () => {
    const input = validRunbook() as { diagnostic?: { description: string; script: string; expectedOutput: string } };
    input.diagnostic = { description: "\t\n", script: "print(1)", expectedOutput: "some output" };

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("diagnostic.description");
    }
  });

  it("throws RunbookValidationError naming diagnostic.expectedOutput when expectedOutput is whitespace-only", () => {
    const input = validRunbook() as { diagnostic?: { description: string; script: string; expectedOutput: string } };
    input.diagnostic = { description: "checks something", script: "print(1)", expectedOutput: "  \n " };

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("diagnostic.expectedOutput");
    }
  });

  it("throws RunbookValidationError naming title when title is whitespace-only", () => {
    const input = validRunbook() as { title: string };
    input.title = "   ";

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("title");
    }
  });

  it("throws RunbookValidationError naming steps.0.label when a step label is whitespace-only", () => {
    const input = validRunbook() as { steps: Array<{ label: string }> };
    const firstStep = input.steps[0];
    if (!firstStep) throw new Error("expected fixture to have a first step");
    firstStep.label = "   ";

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("steps.0.label");
    }
  });

  it("throws RunbookValidationError naming id when the runbook id is whitespace-only", () => {
    const input = validRunbook() as { id: string };
    input.id = "   ";

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("id");
    }
  });

  it("throws RunbookValidationError naming proposedAction.target when target is whitespace-only", () => {
    const input = validRunbook() as { proposedAction: { target: string } };
    input.proposedAction.target = "   ";

    try {
      loadRunbook(input);
      throw new Error("expected loadRunbook to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RunbookValidationError);
      const message = (error as RunbookValidationError).message;
      expect(message).toContain("proposedAction.target");
    }
  });

  it("loads the shipped checkout-failure runbook's diagnostic and authorizes the sandbox source", () => {
    const runbook = loadRunbook(checkoutFailureRaw);
    expect(runbook.allowedSources).toContain("sandbox");
    expect(runbook.diagnostic).toBeDefined();
    expect(runbook.diagnostic?.script).toContain("timeout_ms=");
    expect(runbook.diagnostic?.description.length).toBeGreaterThan(0);
    expect(runbook.diagnostic?.expectedOutput.length).toBeGreaterThan(0);
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

  it("does not let a runbook with a duplicated signal outrank a runbook with two distinct matching signals", () => {
    // A malformed runbook object bypassing loadRunbook's duplicate rejection
    // (constructed directly, since loadRunbook now rejects this shape) —
    // countOverlap itself must not double-count repeated entries. On a naive
    // count-every-occurrence implementation this would tie or even win
    // against "distinct" (2 vs 2), but should score only 1 distinct match.
    const duplicated: Runbook = {
      ...base,
      id: "duplicated",
      trigger: { service: "payment-service", signals: ["timeout", "timeout"] }
    };
    const distinct = loadRunbook({
      ...base,
      id: "distinct",
      trigger: { service: "payment-service", signals: ["timeout", "error_rate"] }
    });

    const result = matchRunbook(
      [duplicated, distinct],
      { service: "payment-service", signals: ["timeout", "error_rate"] }
    );

    expect(result?.id).toBe("distinct");
  });

  it("counts a duplicated incident signal only once toward overlap", () => {
    const single = loadRunbook({
      ...base,
      id: "single",
      trigger: { service: "payment-service", signals: ["timeout"] }
    });

    const result = matchRunbook(
      [single],
      { service: "payment-service", signals: ["timeout", "timeout", "timeout"] }
    );

    expect(result?.id).toBe("single");
  });
});

describe("checkout-failure.json", () => {
  it("loads as a valid runbook matching the UI timeline and the checkout incident", () => {
    const runbook = loadRunbook(checkoutFailureRaw);

    expect(runbook.trigger.service).toBe("payment-service");
    expect(runbook.trigger.signals).toEqual(expect.arrayContaining(["timeout", "error_rate"]));
    expect(runbook.allowedSources).toEqual(["logs", "metrics", "deploys", "sandbox"]);
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
