import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Runbook } from "../domain/runbook";

const NARROW_SCOPE_RUNBOOK: Runbook = {
  id: "metrics-only-test-runbook",
  title: "Metrics-only scope for testing",
  trigger: { service: "narrow-scope-service", signals: ["timeout"] },
  allowedSources: ["metrics"],
  steps: [{ id: "step-1", label: "step", detail: "only metrics are authorized for this incident" }],
  proposedAction: {
    kind: "rollback",
    target: "narrow-scope-service",
    params: {},
    reversible: true,
    description: "n/a"
  }
};

const RESTART_ONLY_RUNBOOK: Runbook = {
  id: "restart-only-test-runbook",
  title: "Restart-only proposedAction for testing propose_rollback authorization",
  trigger: { service: "restart-only-service", signals: ["timeout"] },
  allowedSources: ["logs"],
  steps: [{ id: "step-1", label: "step", detail: "this runbook only authorizes a restart, never a rollback" }],
  proposedAction: {
    kind: "restart",
    target: "restart-only-service",
    params: {},
    reversible: true,
    description: "Restart restart-only-service"
  }
};

const MISMATCHED_TARGET_RUNBOOK: Runbook = {
  id: "mismatched-target-test-runbook",
  title: "proposedAction targets a different service than the trigger, for testing propose_rollback authorization",
  trigger: { service: "mismatched-target-service", signals: ["timeout"] },
  allowedSources: ["logs"],
  steps: [{ id: "step-1", label: "step", detail: "the proposed rollback targets a downstream service, not this one" }],
  proposedAction: {
    kind: "rollback",
    target: "some-other-downstream-service",
    params: {},
    reversible: true,
    description: "Roll back some-other-downstream-service"
  }
};

const SANDBOX_NO_DIAGNOSTIC_RUNBOOK: Runbook = {
  id: "sandbox-no-diagnostic-test-runbook",
  title: "Sandbox-authorized but no diagnostic authored yet",
  trigger: { service: "no-diagnostic-service", signals: ["timeout"] },
  allowedSources: ["sandbox"],
  steps: [{ id: "step-1", label: "step", detail: "sandbox is authorized, but no diagnostic script exists" }],
  proposedAction: {
    kind: "rollback",
    target: "no-diagnostic-service",
    params: {},
    reversible: true,
    description: "n/a"
  }
  // deliberately no `diagnostic` field
};

vi.mock("./runbooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runbooks")>();
  return {
    ALL_RUNBOOKS: [
      ...actual.ALL_RUNBOOKS,
      NARROW_SCOPE_RUNBOOK,
      SANDBOX_NO_DIAGNOSTIC_RUNBOOK,
      RESTART_ONLY_RUNBOOK,
      MISMATCHED_TARGET_RUNBOOK
    ]
  };
});

vi.mock("./logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./logs")>();
  return { ...actual, createLogSource: vi.fn(actual.createLogSource) };
});

vi.mock("./metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./metrics")>();
  return { ...actual, createMetricSource: vi.fn(actual.createMetricSource) };
});

vi.mock("./deploys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deploys")>();
  return { ...actual, createDeploySource: vi.fn(actual.createDeploySource) };
});

const {
  handleCollectLogs,
  handleCollectMetrics,
  handleCollectDeploys,
  handleGetRunbook,
  handleGetDiagnosticScript,
  handleProposeRollback
} = await import("./toolHandlers");
const { createLogSource } = await import("./logs");
const { createMetricSource } = await import("./metrics");
const { createDeploySource } = await import("./deploys");

const INCIDENT = { incidentId: "inc-mcp-1", service: "payment-service", signals: ["timeout", "error_rate"] };

beforeEach(() => {
  vi.mocked(createLogSource).mockClear();
  vi.mocked(createMetricSource).mockClear();
  vi.mocked(createDeploySource).mockClear();
});

describe("handleCollectLogs", () => {
  it("returns log evidence cards scoped to the requested service when the runbook authorizes logs", async () => {
    const cards = await handleCollectLogs(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "logs")).toBe(true);
  });

  it("returns no cards for an authorized service with no matching fixtures", async () => {
    const cards = await handleCollectLogs({
      incidentId: "inc-mcp-1",
      service: "payment-service",
      signals: ["timeout", "error_rate"]
    });
    expect(cards).toEqual(cards.filter((card) => card.source === "logs"));
  });

  it("refuses and never invokes the collector when the matched runbook does not authorize logs", async () => {
    await expect(
      handleCollectLogs({ incidentId: "inc-narrow-1", service: "narrow-scope-service", signals: ["timeout"] })
    ).rejects.toThrow(/does not authorize the "logs" source/);
    expect(createLogSource).not.toHaveBeenCalled();
  });

  it("refuses and never invokes the collector when no runbook matches", async () => {
    await expect(
      handleCollectLogs({ incidentId: "inc-none-1", service: "totally-unknown-service", signals: ["nope"] })
    ).rejects.toThrow(/No runbook matches/);
    expect(createLogSource).not.toHaveBeenCalled();
  });
});

describe("handleCollectMetrics", () => {
  it("returns metric evidence cards scoped to the requested service when authorized", async () => {
    const cards = await handleCollectMetrics(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "metrics")).toBe(true);
  });

  it("works when the matched runbook's allowedSources authorizes metrics only", async () => {
    const cards = await handleCollectMetrics({
      incidentId: "inc-narrow-2",
      service: "narrow-scope-service",
      signals: ["timeout"]
    });
    expect(createMetricSource).toHaveBeenCalledTimes(1);
    expect(cards.every((card) => card.source === "metrics")).toBe(true);
  });

  it("refuses and never invokes the collector when no runbook matches", async () => {
    await expect(
      handleCollectMetrics({ incidentId: "inc-none-2", service: "totally-unknown-service", signals: ["nope"] })
    ).rejects.toThrow(/No runbook matches/);
    expect(createMetricSource).not.toHaveBeenCalled();
  });
});

describe("handleCollectDeploys", () => {
  it("returns deploy evidence cards scoped to the requested service when authorized", async () => {
    const cards = await handleCollectDeploys(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "deploys")).toBe(true);
  });

  it("refuses and never invokes the collector when the matched runbook does not authorize deploys", async () => {
    await expect(
      handleCollectDeploys({ incidentId: "inc-narrow-3", service: "narrow-scope-service", signals: ["timeout"] })
    ).rejects.toThrow(/does not authorize the "deploys" source/);
    expect(createDeploySource).not.toHaveBeenCalled();
  });

  it("refuses and never invokes the collector when no runbook matches", async () => {
    await expect(
      handleCollectDeploys({ incidentId: "inc-none-3", service: "totally-unknown-service", signals: ["nope"] })
    ).rejects.toThrow(/No runbook matches/);
    expect(createDeploySource).not.toHaveBeenCalled();
  });
});

describe("handleGetRunbook", () => {
  it("matches the checkout-failure runbook and surfaces allowedSources", () => {
    const result = handleGetRunbook({ service: "payment-service", signals: ["timeout", "error_rate"] });
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("expected a match");
    expect(result.runbook.id).toBe("checkout-failure");
    expect(result.runbook.allowedSources).toEqual(["logs", "metrics", "deploys", "sandbox"]);
    expect(result.runbook.proposedAction.kind).toBe("rollback");
  });

  it("reports no match for a service with no runbook", () => {
    const result = handleGetRunbook({ service: "unknown-service", signals: ["timeout"] });
    expect(result).toEqual({ matched: false });
  });

  it("reports no match when signals share nothing with any runbook's trigger", () => {
    const result = handleGetRunbook({ service: "payment-service", signals: ["unrelated_signal"] });
    expect(result).toEqual({ matched: false });
  });
});

describe("handleGetDiagnosticScript", () => {
  it("returns the matched runbook's diagnostic script, description, and expected output", () => {
    const result = handleGetDiagnosticScript({ service: "payment-service", signals: ["timeout", "error_rate"] });
    expect(result.runbookId).toBe("checkout-failure");
    expect(result.script).toContain("timeout_ms=");
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.expectedOutput.length).toBeGreaterThan(0);
  });

  it("returns a script that is deterministic Python with no third-party imports", () => {
    const result = handleGetDiagnosticScript({ service: "payment-service", signals: ["timeout", "error_rate"] });
    expect(result.script).toMatch(/^#!\/usr\/bin\/env python3/);
    expect(result.script).toContain("import re");
    expect(result.script).not.toMatch(/^\s*import\s+(?!re\b)\w+/m);
  });

  it("refuses and does not return a script when no runbook matches", () => {
    expect(() =>
      handleGetDiagnosticScript({ service: "totally-unknown-service", signals: ["nope"] })
    ).toThrow(/No runbook matches/);
  });

  it("refuses when the matched runbook does not authorize the sandbox source", () => {
    expect(() =>
      handleGetDiagnosticScript({ service: "narrow-scope-service", signals: ["timeout"] })
    ).toThrow(/does not authorize the "sandbox" source/);
  });

  it("refuses when the matched runbook authorizes sandbox but has no diagnostic authored", () => {
    expect(() =>
      handleGetDiagnosticScript({ service: "no-diagnostic-service", signals: ["timeout"] })
    ).toThrow(/no diagnostic script/i);
  });
});

describe("handleProposeRollback", () => {
  const VALID_ARGS = {
    service: "payment-service",
    commit: "8f31c2b",
    reason: "revert risky deploy",
    signals: ["timeout", "error_rate"]
  };

  it("never marks the rollback as executed", () => {
    const result = handleProposeRollback(VALID_ARGS);
    expect(result.executed).toBe(false);
  });

  it("mints a locked approval gate bound to the proposed action's id", () => {
    const result = handleProposeRollback(VALID_ARGS);
    expect(result.gate.state).toBe("locked");
    expect(result.gate.actionId).toBe(result.action.id);
  });

  it("builds a state-changing rollback action carrying the commit and reason", () => {
    const result = handleProposeRollback(VALID_ARGS);
    expect(result.action.kind).toBe("rollback");
    expect(result.action.isStateChanging).toBe(true);
    expect(result.action.target).toBe("payment-service");
    expect(result.action.params).toEqual({ commit: "8f31c2b", reason: "revert risky deploy" });
  });

  it("describes the proposal as locked and unexecuted in the message", () => {
    const result = handleProposeRollback(VALID_ARGS);
    expect(result.message).toContain("not executed");
    expect(result.message).toContain("LOCKED");
  });

  it("mints a fresh action id (and gate) on every call, even for identical arguments", () => {
    const first = handleProposeRollback(VALID_ARGS);
    const second = handleProposeRollback(VALID_ARGS);
    expect(first.action.id).not.toBe(second.action.id);
    expect(first.gate.id).not.toBe(second.gate.id);
  });

  it("refuses and creates no action or gate when no runbook matches the service/signals", () => {
    expect(() =>
      handleProposeRollback({
        service: "totally-unknown-service",
        commit: "deadbee",
        reason: "no runbook backs this",
        signals: ["nope"]
      })
    ).toThrow(/No runbook matches/);
  });

  it("refuses when the matched runbook's proposedAction is not a rollback", () => {
    expect(() =>
      handleProposeRollback({
        service: "restart-only-service",
        commit: "deadbee",
        reason: "trying to rollback anyway",
        signals: ["timeout"]
      })
    ).toThrow(/does not authorize a rollback of "restart-only-service"/);
  });

  it("refuses when the matched runbook's proposedAction targets a different service", () => {
    expect(() =>
      handleProposeRollback({
        service: "mismatched-target-service",
        commit: "deadbee",
        reason: "trying to rollback the wrong target",
        signals: ["timeout"]
      })
    ).toThrow(/does not authorize a rollback of "mismatched-target-service"/);
  });

  it("still produces a locked gate for the runbook's prescribed commit", () => {
    const result = handleProposeRollback(VALID_ARGS);
    expect(result.gate.state).toBe("locked");
    expect(result.action.params).toEqual({ commit: "8f31c2b", reason: "revert risky deploy" });
  });

  it("refuses and creates no action or gate when the requested commit differs from the runbook's prescribed commit", () => {
    expect(() =>
      handleProposeRollback({
        service: "payment-service",
        commit: "deadbee",
        reason: "revert risky deploy",
        signals: ["timeout", "error_rate"]
      })
    ).toThrow(/proposedAction\.params\.commit/);
  });

  it("names the requested and authorized commit values in the refusal message", () => {
    expect(() =>
      handleProposeRollback({
        service: "payment-service",
        commit: "deadbee",
        reason: "revert risky deploy",
        signals: ["timeout", "error_rate"]
      })
    ).toThrow(/deadbee/);
    expect(() =>
      handleProposeRollback({
        service: "payment-service",
        commit: "deadbee",
        reason: "revert risky deploy",
        signals: ["timeout", "error_rate"]
      })
    ).toThrow(/8f31c2b/);
  });

  it("authorizes the prescribed commit regardless of the caller-supplied reason text", () => {
    const result = handleProposeRollback({
      service: "payment-service",
      commit: "8f31c2b",
      reason: "a completely different operator-supplied reason",
      signals: ["timeout", "error_rate"]
    });
    expect(result.gate.state).toBe("locked");
    expect(result.action.params).toEqual({
      commit: "8f31c2b",
      reason: "a completely different operator-supplied reason"
    });
  });
});
