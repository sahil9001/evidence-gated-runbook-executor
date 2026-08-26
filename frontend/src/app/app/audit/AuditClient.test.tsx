// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntry } from "../../../lib/types";

const push = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParamsValue
}));

const listAuditLog = vi.fn();
vi.mock("../../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api")>("../../../lib/api");
  return {
    ...actual,
    listAuditLog: (...args: unknown[]) => listAuditLog(...args)
  };
});

// Imported after the mocks above so the module under test picks them up.
import { AuditClient } from "./AuditClient";

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    runId: "run-1",
    at: "2026-08-26T09:00:00.000Z",
    kind: "run_created",
    detail: "Run run-1 created for payment-service.",
    ...overrides
  };
}

describe("AuditClient", () => {
  beforeEach(() => {
    push.mockClear();
    listAuditLog.mockReset();
    searchParamsValue = new URLSearchParams();
  });

  it("renders entries from a mocked client as plain-language sentences", async () => {
    listAuditLog.mockResolvedValue([
      makeEntry({ id: "audit-1", kind: "gate_approved", detail: "Gate run-1 approved by lead@runproof.dev" }),
      makeEntry({ id: "audit-2", kind: "evidence_partial", detail: "Evidence collection had failures for run-1" })
    ]);

    render(<AuditClient />);

    expect(await screen.findByText(/approval granted/i)).toBeInTheDocument();
    expect(screen.getByText("Evidence collection had failures")).toBeInTheDocument();
    expect(screen.getByText("Gate run-1 approved by lead@runproof.dev")).toBeInTheDocument();
  });

  it("declares the log append-only", async () => {
    listAuditLog.mockResolvedValue([makeEntry()]);
    render(<AuditClient />);

    await screen.findByText(/run started/i);
    expect(screen.getByText(/append-only/i)).toBeInTheDocument();
  });

  it("sorts entries newest first even when the API returns them oldest first", async () => {
    listAuditLog.mockResolvedValue([
      makeEntry({ id: "audit-old", at: "2026-08-26T09:00:00.000Z", kind: "run_created" }),
      makeEntry({ id: "audit-new", at: "2026-08-26T10:00:00.000Z", kind: "gate_approved" })
    ]);

    render(<AuditClient />);

    await screen.findByText(/run started/i);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(/approval granted/i)).toBeInTheDocument();
    expect(within(items[1]).getByText(/run started/i)).toBeInTheDocument();
  });

  it("reads the initial runId filter from the URL and requests that run", async () => {
    searchParamsValue = new URLSearchParams("runId=run-42");
    listAuditLog.mockResolvedValue([makeEntry({ runId: "run-42" })]);

    render(<AuditClient />);

    await screen.findByText(/run started/i);
    expect(listAuditLog).toHaveBeenCalledWith({ runId: "run-42", limit: expect.any(Number) });

    const input = screen.getByLabelText(/run id/i) as HTMLInputElement;
    expect(input.value).toBe("run-42");
  });

  it("updates the URL when the run filter is submitted", async () => {
    listAuditLog.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AuditClient />);

    await screen.findByText(/no audit entries/i);
    await user.type(screen.getByLabelText(/run id/i), "run-99");
    await user.click(screen.getByRole("button", { name: /filter/i }));

    expect(push).toHaveBeenCalledWith("/app/audit?runId=run-99");
  });

  it("each entry links to its run", async () => {
    listAuditLog.mockResolvedValue([makeEntry({ runId: "run-77" })]);
    render(<AuditClient />);

    const link = await screen.findByRole("link", { name: /run-77/i });
    expect(link).toHaveAttribute("href", "/app/runs/run-77");
  });

  it("renders a loading skeleton before the response resolves", () => {
    listAuditLog.mockReturnValue(new Promise(() => {}));
    render(<AuditClient />);

    expect(screen.getByRole("status", { name: /loading audit/i })).toBeInTheDocument();
  });

  it("renders an error state with a working retry button", async () => {
    listAuditLog.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    render(<AuditClient />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();

    listAuditLog.mockResolvedValueOnce([makeEntry()]);
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText(/run started/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
  });

  it("renders a calm empty state when there are no entries", async () => {
    listAuditLog.mockResolvedValue([]);
    render(<AuditClient />);

    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
  });
});
