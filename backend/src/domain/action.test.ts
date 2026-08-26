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

describe("createAction params validation", () => {
  const base = {
    id: "a1", kind: "rollback", target: "payment-service",
    reversible: true, description: "Roll back"
  };

  it("rejects undefined param values", () => {
    expect(() => createAction({ ...base, params: { x: undefined } })).toThrow(/x/);
  });

  it("rejects function param values", () => {
    expect(() => createAction({ ...base, params: { x: () => 1 } })).toThrow(/x/);
  });

  it("rejects NaN param values", () => {
    expect(() => createAction({ ...base, params: { x: NaN } })).toThrow(/x/);
  });

  it("rejects Infinity param values", () => {
    expect(() => createAction({ ...base, params: { x: Infinity } })).toThrow(/x/);
  });

  it("rejects bigint param values instead of letting them reach the serializer", () => {
    expect(() => createAction({ ...base, params: { x: 1n } })).toThrow(/x/);
  });

  it("accepts null param values", () => {
    const action = createAction({ ...base, params: { x: null } });
    expect(action.params.x).toBe(null);
  });

  it("accepts nested objects and arrays", () => {
    const action = createAction({
      ...base,
      params: { list: [1, "two", { three: 3 }], nested: { deep: { value: true } } }
    });
    expect(action.params.list).toEqual([1, "two", { three: 3 }]);
  });
});
