import { describe, expect, it } from "vitest";
import { activityLabel, activityPresentation, shortId, shortenIds } from "./audit-format";

describe("activityPresentation", () => {
  it("gives every known kind a plain-language label", () => {
    expect(activityLabel("gate_approved")).toBe("Approval granted");
    expect(activityLabel("gate_rejected")).toBe("Approval rejected");
    expect(activityLabel("run_created")).toBe("Run started");
    expect(activityLabel("action_executed")).toBe("Action executed");
    expect(activityLabel("evidence_partial")).toBe("Evidence incomplete");
  });

  it("renders an unknown kind as words rather than a raw enum", () => {
    expect(activityLabel("some_future_kind")).toBe("some future kind");
    expect(activityPresentation("some_future_kind").icon).toBeDefined();
  });
});

describe("shortenIds", () => {
  it("truncates embedded UUIDs so the readable half of the sentence survives", () => {
    expect(shortenIds("Gate 7814bdea-f883-4b95-b478-496d59607512 rejected by sam")).toBe(
      "Gate 7814bdea… rejected by sam"
    );
  });

  it("shortens every id in a detail line, not just the first", () => {
    const detail =
      "Evidence collected for incident dd809c19-4abb-4ce5-8c26-c27f5a057b40; action 7814bdea-f883-4b95-b478-496d59607512 locked";
    expect(shortenIds(detail)).toBe("Evidence collected for incident dd809c19…; action 7814bdea… locked");
  });

  it("leaves details with no ids untouched", () => {
    expect(shortenIds("Approved by oncall@runproof.dev")).toBe("Approved by oncall@runproof.dev");
  });
});

describe("shortId", () => {
  it("truncates a long id and leaves a short one alone", () => {
    expect(shortId("7814bdea-f883-4b95-b478-496d59607512")).toBe("7814bdea…");
    expect(shortId("run-42")).toBe("run-42");
  });
});
