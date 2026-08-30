// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  ApprovalGate,
  Action,
  AuditEntry,
  EvidenceCard,
  EvidencePacket,
  ExecutionResult,
  RunDetailResponse
} from "../../../../lib/types";

const push = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue
}));

const getRun = vi.fn();
const listAudit = vi.fn();
const approve = vi.fn();
const reject = vi.fn();
vi.mock("../../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/api")>("../../../../lib/api");
  return {
    ...actual,
    getRun: (...args: unknown[]) => getRun(...args),
    listAudit: (...args: unknown[]) => listAudit(...args),
    approve: (...args: unknown[]) => approve(...args),
    reject: (...args: unknown[]) => reject(...args)
  };
});

// Imported after the mocks above so the module under test picks them up.
import { ApiClientError } from "../../../../lib/api";
import { RunDetailClient } from "./RunDetailClient";

function makeCard(overrides: Partial<EvidenceCard> = {}): EvidenceCard {
  return {
    id: "card-1",
    source: "logs",
    claim: "5xx rate spiked to 42% at 09:03 UTC",
    raw: { level: "error", count: 47, service: "payment-service" },
    collectedAt: "2026-08-26T09:03:00.000Z",
    confidence: "high",
    ...overrides
  };
}

function makePacket(overrides: Partial<EvidencePacket> = {}): EvidencePacket {
  return {
    id: "pk-1",
    incidentId: "inc-1",
    runbookId: "checkout-failure",
    cards: [makeCard()],
    summary: "1 evidence card from 1 source: logs",
    builtAt: "2026-08-26T09:05:00.000Z",
    ...overrides
  };
}

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "run-1",
    kind: "rollback",
    target: "payment-service",
    params: {},
    reversible: true,
    description: "rollback payment-service to the last known-good deploy",
    isStateChanging: true,
    ...overrides
  };
}

function makeGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id: "run-1",
    actionId: "run-1",
    createdAt: "2026-08-26T09:05:00.000Z",
    expiresAt: "2026-08-26T10:05:00.000Z",
    state: "locked",
    ...overrides
  };
}

function makeDetail(overrides: Partial<RunDetailResponse> = {}): RunDetailResponse {
  return {
    run: {
      id: "run-1",
      incidentId: "inc-1",
      runbookId: "checkout-failure",
      service: "payment-service",
      state: "awaiting_approval",
      createdAt: "2026-08-26T09:00:00.000Z",
      updatedAt: "2026-08-26T09:05:00.000Z",
      createdBy: "oncall@runproof.dev"
    },
    incident: {
      id: "inc-1",
      title: "Checkout errors spiking",
      service: "payment-service",
      signals: ["timeout", "error_rate"],
      status: "open",
      createdBy: "oncall@runproof.dev",
      createdAt: "2026-08-26T09:00:00.000Z"
    },
    packet: makePacket(),
    action: makeAction(),
    gate: makeGate(),
    failures: [],
    confidence: "high",
    ...overrides
  };
}

function makeExecution(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    actionId: "run-1",
    executed: true,
    dryRun: false,
    output: "rollback executed for payment-service",
    at: "2026-08-26T09:10:00.000Z",
    ...overrides
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    at: "2026-08-26T09:00:00.000Z",
    kind: "run_created",
    detail: "Run run-1 created for payment-service",
    ...overrides
  };
}

describe("RunDetailClient", () => {
  beforeEach(() => {
    push.mockClear();
    getRun.mockReset();
    listAudit.mockReset();
    approve.mockReset();
    reject.mockReset();
    searchParamsValue = new URLSearchParams();
    listAudit.mockResolvedValue([]);
  });

  it("renders a loading state before the response resolves", () => {
    getRun.mockReturnValue(new Promise(() => {}));
    render(<RunDetailClient runId="run-1" />);

    expect(screen.getByRole("status", { name: /loading run/i })).toBeInTheDocument();
  });

  it("renders a not-found state (distinct from a generic error) on a 404", async () => {
    getRun.mockRejectedValue(new ApiClientError("No run found", "not_found", 404));
    render(<RunDetailClient runId="missing" />);

    expect(await screen.findByText(/run not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to incidents/i })).toHaveAttribute(
      "href",
      "/app/incidents"
    );
  });

  it("renders an error state with a working retry button on a non-404 failure", async () => {
    getRun.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<RunDetailClient runId="run-1" />);

    expect(await screen.findByText(/could not load this run/i)).toBeInTheDocument();

    getRun.mockResolvedValueOnce(makeDetail());
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("tablist")).toBeInTheDocument();
  });

  it("renders an accessible tablist with four tabs", async () => {
    getRun.mockResolvedValue(makeDetail());
    render(<RunDetailClient runId="run-1" />);

    const tablist = await screen.findByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Evidence", "Diagnostics", "Approval", "Audit"]);
  });

  it("defaults to the Approval tab when the gate is locked", async () => {
    getRun.mockResolvedValue(makeDetail({ gate: makeGate({ state: "locked" }) }));
    render(<RunDetailClient runId="run-1" />);

    await screen.findByRole("tablist");
    expect(screen.getByRole("tab", { name: "Approval" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/approval gate/i)).toBeInTheDocument();
  });

  it("defaults to the Evidence tab when the gate is already decided", async () => {
    getRun.mockResolvedValue(makeDetail({ gate: makeGate({ state: "approved", decidedBy: "a@b.com", decidedAt: "t" }) }));
    render(<RunDetailClient runId="run-1" />);

    await screen.findByRole("tablist");
    expect(screen.getByRole("tab", { name: "Evidence" })).toHaveAttribute("aria-selected", "true");
  });

  it("reads the active tab from the URL and renders that tab's content", async () => {
    searchParamsValue = new URLSearchParams("tab=diagnostics");
    getRun.mockResolvedValue(makeDetail());
    render(<RunDetailClient runId="run-1" />);

    await screen.findByRole("tablist");
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/no sandbox runs in this build/i)).toBeInTheDocument();
  });

  it("clicking a tab writes the new tab to the URL", async () => {
    getRun.mockResolvedValue(makeDetail());
    const user = userEvent.setup();
    render(<RunDetailClient runId="run-1" />);

    await screen.findByRole("tablist");
    await user.click(screen.getByRole("tab", { name: "Audit" }));

    expect(push).toHaveBeenCalledWith("/app/runs/run-1?tab=audit");
  });

  it("supports arrow-key navigation between tabs", async () => {
    getRun.mockResolvedValue(makeDetail({ gate: makeGate({ state: "approved" }) }));
    const user = userEvent.setup();
    render(<RunDetailClient runId="run-1" />);

    await screen.findByRole("tablist");
    screen.getByRole("tab", { name: "Evidence" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(push).toHaveBeenCalledWith("/app/runs/run-1?tab=diagnostics");
  });

  describe("Evidence tab", () => {
    it("shows the failures banner when failures is non-empty", async () => {
      getRun.mockResolvedValue(
        makeDetail({
          gate: makeGate({ state: "approved" }),
          failures: [{ source: "metrics", message: 'No evidence collected from source "metrics"' }]
        })
      );
      render(<RunDetailClient runId="run-1" />);

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent(/incomplete/i);
      expect(banner).toHaveTextContent(/No evidence collected from source "metrics"/i);
    });

    it("does not show a failures banner when failures is empty", async () => {
      getRun.mockResolvedValue(makeDetail({ gate: makeGate({ state: "approved" }), failures: [] }));
      render(<RunDetailClient runId="run-1" />);

      await screen.findByRole("tablist");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("groups cards by source and expands to reveal the raw payload", async () => {
      getRun.mockResolvedValue(
        makeDetail({
          gate: makeGate({ state: "approved" }),
          packet: makePacket({ cards: [makeCard({ id: "card-1", claim: "5xx rate spiked" })] })
        })
      );
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      const claimButton = await screen.findByRole("button", { name: /5xx rate spiked/i });
      expect(screen.queryByText(/"count": 47/)).not.toBeInTheDocument();

      await user.click(claimButton);

      expect(screen.getByText(/"count": 47/)).toBeInTheDocument();
    });
  });

  describe("Diagnostics tab", () => {
    it("labels the sandbox output as a fixture, not live output", async () => {
      searchParamsValue = new URLSearchParams("tab=diagnostics");
      getRun.mockResolvedValue(
        makeDetail({
          packet: makePacket({
            cards: [makeCard({ id: "sbx-1", source: "sandbox", claim: "timeout reproduced in isolation" })]
          })
        })
      );
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/no sandbox runs in this build/i)).toBeInTheDocument();
      expect(screen.getByText(/timeout reproduced in isolation/i)).toBeInTheDocument();
    });
  });

  describe("Approval tab", () => {
    it("disables Approve when the packet has zero cards", async () => {
      getRun.mockResolvedValue(makeDetail({ packet: makePacket({ cards: [] }) }));
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByRole("button", { name: /approve/i })).toBeDisabled();
    });

    it("disables Approve when the gate is already decided", async () => {
      getRun.mockResolvedValue(
        makeDetail({ gate: makeGate({ state: "approved", decidedBy: "a@b.com", decidedAt: "t" }) })
      );
      searchParamsValue = new URLSearchParams("tab=approval");
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByRole("button", { name: /approve/i })).toBeDisabled();
    });

    it("clicking Approve calls the API and renders the execution result", async () => {
      getRun.mockResolvedValue(makeDetail());
      const execution = makeExecution();
      approve.mockResolvedValue({
        gate: makeGate({ state: "approved", decidedBy: "a@b.com", decidedAt: "t" }),
        execution,
        runState: "executed"
      });
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      await user.click(await screen.findByRole("button", { name: /approve/i }));

      expect(approve).toHaveBeenCalledWith("run-1");
      expect(await screen.findByText(/rollback executed for payment-service/i)).toBeInTheDocument();
      expect(screen.getByText(/executed=true/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    });

    // Qodo finding: the header showed "awaiting approval" even after a
    // successful decision, because only `data.gate` was updated — the run's
    // own `state` (which the header renders) was left untouched.
    it("updates the header's run state after a successful approve", async () => {
      getRun.mockResolvedValue(makeDetail());
      const execution = makeExecution();
      approve.mockResolvedValue({
        gate: makeGate({ state: "approved", decidedBy: "a@b.com", decidedAt: "t" }),
        execution,
        runState: "executed"
      });
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/awaiting approval/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /approve/i }));

      expect(await screen.findByText(/^executed$/i)).toBeInTheDocument();
      expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument();
    });

    it("updates the header's run state after a successful reject", async () => {
      getRun.mockResolvedValue(makeDetail());
      reject.mockResolvedValue({
        gate: makeGate({ state: "rejected", decidedBy: "a@b.com", decidedAt: "t", reason: "nope" }),
        runState: "rejected"
      });
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/awaiting approval/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^reject$/i }));
      await user.type(screen.getByLabelText(/reason for rejecting/i), "nope");
      await user.click(screen.getByRole("button", { name: /confirm reject/i }));

      expect(await screen.findByText(/^rejected$/i)).toBeInTheDocument();
      expect(screen.queryByText(/awaiting approval/i)).not.toBeInTheDocument();
    });

    it("prevents rejecting without a reason", async () => {
      getRun.mockResolvedValue(makeDetail());
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      await user.click(await screen.findByRole("button", { name: /^reject$/i }));
      const submit = screen.getByRole("button", { name: /confirm reject/i });
      expect(submit).toBeDisabled();

      await user.type(screen.getByLabelText(/reason for rejecting/i), "  ");
      expect(submit).toBeDisabled();

      expect(reject).not.toHaveBeenCalled();
    });

    it("submitting a reject reason calls the API and shows the outcome", async () => {
      getRun.mockResolvedValue(makeDetail());
      reject.mockResolvedValue({
        gate: makeGate({ state: "rejected", decidedBy: "a@b.com", decidedAt: "t", reason: "not enough evidence" }),
        runState: "rejected"
      });
      const user = userEvent.setup();
      render(<RunDetailClient runId="run-1" />);

      await user.click(await screen.findByRole("button", { name: /^reject$/i }));
      await user.type(screen.getByLabelText(/reason for rejecting/i), "not enough evidence");
      await user.click(screen.getByRole("button", { name: /confirm reject/i }));

      expect(reject).toHaveBeenCalledWith("run-1", "not enough evidence");
      expect(await screen.findByText(/not enough evidence/i)).toBeInTheDocument();
    });
  });

  describe("Audit tab", () => {
    it("renders this run's audit entries as readable sentences, in order", async () => {
      searchParamsValue = new URLSearchParams("tab=audit");
      getRun.mockResolvedValue(makeDetail());
      listAudit.mockResolvedValue([
        makeAuditEntry({ id: "a1", kind: "run_created", detail: "Run run-1 created" }),
        makeAuditEntry({ id: "a2", kind: "gate_approved", detail: "Gate run-1 approved by a@b.com" })
      ]);
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/run started/i)).toBeInTheDocument();
      expect(screen.getByText(/approval granted/i)).toBeInTheDocument();
      expect(listAudit).toHaveBeenCalledWith("run-1");
    });
  });

  describe("stage strip", () => {
    it("reports a run whose collectors all came back empty as blocked, not idle", async () => {
      // Zero cards AND a full set of failures is reachable: every allowed
      // source returning nothing leaves a packet with no cards and one failure
      // per source. Showing the neutral "Nothing collected" for that hid a
      // known evidence gap behind a state that reads as "nothing yet".
      getRun.mockResolvedValue(
        makeDetail({
          packet: makePacket({ cards: [] }),
          failures: [
            { source: "logs", message: 'No evidence collected from source "logs"' },
            { source: "metrics", message: 'No evidence collected from source "metrics"' }
          ]
        })
      );
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/No cards — 2 source gaps/i)).toBeInTheDocument();
      expect(screen.queryByText("Nothing collected")).toBeNull();
    });

    it("still reports a genuinely empty run with no failures as idle", async () => {
      getRun.mockResolvedValue(makeDetail({ packet: makePacket({ cards: [] }), failures: [] }));
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText("Nothing collected")).toBeInTheDocument();
    });

    it("reports a partially collected packet with its gap count", async () => {
      getRun.mockResolvedValue(
        makeDetail({
          failures: [{ source: "sandbox", message: 'No evidence collected from source "sandbox"' }]
        })
      );
      render(<RunDetailClient runId="run-1" />);

      expect(await screen.findByText(/1 card, 1 source gap/i)).toBeInTheDocument();
    });
  });
});
