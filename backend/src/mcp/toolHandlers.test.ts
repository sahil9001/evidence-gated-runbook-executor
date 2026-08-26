import { describe, it, expect } from "vitest";
import {
  handleCollectLogs,
  handleCollectMetrics,
  handleCollectDeploys,
  handleGetRunbook,
  handleProposeRollback
} from "./toolHandlers";

const INCIDENT = { incidentId: "inc-mcp-1", service: "payment-service" };

describe("handleCollectLogs", () => {
  it("returns log evidence cards scoped to the requested service", async () => {
    const cards = await handleCollectLogs(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "logs")).toBe(true);
  });

  it("returns no cards for a service with no matching fixtures", async () => {
    const cards = await handleCollectLogs({ incidentId: "inc-mcp-1", service: "nonexistent-service" });
    expect(cards).toEqual([]);
  });
});

describe("handleCollectMetrics", () => {
  it("returns metric evidence cards scoped to the requested service", async () => {
    const cards = await handleCollectMetrics(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "metrics")).toBe(true);
  });
});

describe("handleCollectDeploys", () => {
  it("returns deploy evidence cards scoped to the requested service", async () => {
    const cards = await handleCollectDeploys(INCIDENT);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.source === "deploys")).toBe(true);
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
