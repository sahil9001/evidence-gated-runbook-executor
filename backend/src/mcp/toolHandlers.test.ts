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

vi.mock("./runbooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runbooks")>();
  return { ALL_RUNBOOKS: [...actual.ALL_RUNBOOKS, NARROW_SCOPE_RUNBOOK] };
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
    expect(result.runbook.allowedSources).toEqual(["logs", "metrics", "deploys"]);
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

describe("handleProposeRollback", () => {
  it("never marks the rollback as executed", () => {
    const result = handleProposeRollback({ service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" });
    expect(result.executed).toBe(false);
  });

  it("mints a locked approval gate bound to the proposed action's id", () => {
    const result = handleProposeRollback({ service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" });
    expect(result.gate.state).toBe("locked");
    expect(result.gate.actionId).toBe(result.action.id);
  });

  it("builds a state-changing rollback action carrying the commit and reason", () => {
    const result = handleProposeRollback({ service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" });
    expect(result.action.kind).toBe("rollback");
    expect(result.action.isStateChanging).toBe(true);
    expect(result.action.target).toBe("payment-service");
    expect(result.action.params).toEqual({ commit: "8f31c2b", reason: "revert risky deploy" });
  });

  it("describes the proposal as locked and unexecuted in the message", () => {
    const result = handleProposeRollback({ service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" });
    expect(result.message).toContain("not executed");
    expect(result.message).toContain("LOCKED");
  });

  it("mints a fresh action id (and gate) on every call, even for identical arguments", () => {
    const args = { service: "payment-service", commit: "8f31c2b", reason: "revert risky deploy" };
    const first = handleProposeRollback(args);
    const second = handleProposeRollback(args);
    expect(first.action.id).not.toBe(second.action.id);
    expect(first.gate.id).not.toBe(second.gate.id);
  });
});
