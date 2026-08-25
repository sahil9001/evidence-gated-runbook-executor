import { describe, it, expect } from "vitest";
import { createAction, isStateChanging } from "./action";

describe("createAction", () => {
  it("marks a rollback as state-changing", () => {
    const action = createAction({
      id: "a1", kind: "rollback", target: "payment-service",
      params: { commit: "8f31c2b" }, reversible: true,
      description: "Roll back payment-service to 8f31c2b"
    });
    expect(action.isStateChanging).toBe(true);
    expect(isStateChanging(action)).toBe(true);
  });

  it("marks reading logs as not state-changing", () => {
    const action = createAction({
      id: "a2", kind: "read_logs", target: "payment-service",
      params: {}, reversible: true, description: "Read logs"
    });
    expect(action.isStateChanging).toBe(false);
  });

  it("ignores a caller trying to declare a rollback harmless", () => {
    const action = createAction({
      id: "a3", kind: "rollback", target: "payment-service",
      params: {}, reversible: true, description: "Sneaky",
      isStateChanging: false
    } as never);
    expect(action.isStateChanging).toBe(true);
  });
});
