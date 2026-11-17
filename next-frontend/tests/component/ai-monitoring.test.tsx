// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RAW_WARNING, type TraceDetail, type TraceReview } from "@/lib/ai-monitoring";
import type { DeleteResult, RawTraceResult, ReviewResult } from "@/server/actions/ai-monitoring";

import { TRACE_ID, review, traceDetail } from "../support/monitoring-fixtures";

const loadRawTrace = vi.fn<(id: unknown) => Promise<RawTraceResult>>();
const saveTraceReview = vi.fn<(input: unknown) => Promise<ReviewResult>>();
const deleteTrace = vi.fn<(id: unknown) => Promise<DeleteResult>>();
vi.mock("@/server/actions/ai-monitoring", () => ({
  loadRawTrace: (id: unknown) => loadRawTrace(id),
  loadRawMcpCall: vi.fn(),
  saveTraceReview: (input: unknown) => saveTraceReview(input),
  deleteTrace: (id: unknown) => deleteTrace(id),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ViewSwitch } = await import("@/components/ai-monitoring/view-switch");
const { TurnLedger } = await import("@/components/ai-monitoring/turn-ledger");
const { ReviewPanel } = await import("@/components/ai-monitoring/review-panel");
const { DeletePanel, DeletionFrame } = await import("@/components/ai-monitoring/delete-panel");
const { JsonSection } = await import("@/components/ai-monitoring/json-section");

const formatted = traceDetail() as unknown as TraceDetail;
const raw = traceDetail({
  view: "raw",
  warning: RAW_WARNING,
  redaction: { identities: "NONE", note: null },
  toolCalls: [
    {
      ...(traceDetail().toolCalls[0] as object),
      result: { employees: [{ name: "Sneha Singh", employeeCode: "ACME00042" }] },
    },
  ],
}) as unknown as TraceDetail;

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  loadRawTrace.mockReset();
  saveTraceReview.mockReset();
  deleteTrace.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(cleanup);

describe("TurnLedger", () => {
  it("renders an ordered list of named steps with status words, the prompt, and the final answer as text", () => {
    render(<TurnLedger detail={formatted} mode="formatted" />);
    const list = screen.getByRole("list", { name: "Turn timeline" });
    const headings = within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Step 1 of 6: User prompt",
      "Step 2 of 6: Model call 1Succeeded",
      "Step 3 of 6: Tool call 1: search_employeesSucceeded",
      "Step 4 of 6: Tool call 2: search_employeesRejected (not run)",
      "Step 5 of 6: Model call 2Succeeded",
      "Step 6 of 6: Final response",
    ]);
    expect(screen.getByText("Who are the top earners in Tech?")).toBeVisible();
    expect(screen.getByText("Employee 1 (EMPLOYEE-1) earns INR 25,00,000.00.")).toBeVisible();
    expect(screen.getByText(/Not executed: rejected by validation/)).toBeVisible();
    expect(screen.getByText("No tool requested.")).toBeVisible();
  });

  it("marks the exact failure stage and the outcome that was not recorded", () => {
    const failed = traceDetail(
      {
        finalResponse: null,
        toolCalls: [{ ...(traceDetail().toolCalls[0] as object), status: "FAILED", result: null, validationStatus: "PENDING", errorCategory: "OUTCOME_NOT_RECORDED" }],
      },
      { status: "FAILED", failureStage: "TOOL_TRACE_WRITE", errorCategory: "persistence_unavailable" },
    ) as unknown as TraceDetail;
    render(<TurnLedger detail={failed} mode="formatted" />);
    expect(screen.getByRole("heading", { name: /Stopped here/ })).toBeVisible();
    expect(screen.getByText("Recording · Recording the tool result failed")).toBeVisible();
    expect(screen.getAllByText("Outcome not recorded").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /Final response/ })).toBeNull();
  });
});

describe("ViewSwitch raw view", () => {
  function setup() {
    return render(<ViewSwitch kind="trace" id={TRACE_ID} formatted={<TurnLedger detail={formatted} mode="formatted" />} />);
  }

  it("shows the warning first; raw data is loaded only after Show and shows complete identities", async () => {
    loadRawTrace.mockResolvedValue({ ok: true, detail: raw });
    setup();
    expect(screen.queryByText(/Sneha Singh/)).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    const warning = screen.getByRole("heading", { name: "Raw trace data" });
    await waitFor(() => expect(warning).toHaveFocus());
    expect(screen.getByText(RAW_WARNING)).toBeVisible();
    expect(loadRawTrace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Show raw trace data" }));
    await waitFor(() => expect(loadRawTrace).toHaveBeenCalledWith(TRACE_ID));
    expect(await screen.findByRole("list", { name: "Turn timeline, raw data" })).toBeVisible();
    // The small result section starts open: complete identities are in the raw view only.
    expect(screen.getByRole("region", { name: "Result JSON" })).toHaveTextContent("Sneha Singh");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("going back to Formatted clears the raw data and the warning returns next time", async () => {
    loadRawTrace.mockResolvedValue({ ok: true, detail: raw });
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await userEvent.click(screen.getByRole("button", { name: "Show raw trace data" }));
    await screen.findByRole("list", { name: "Turn timeline, raw data" });
    await userEvent.click(screen.getByRole("tab", { name: "Formatted" }));
    expect(screen.queryByRole("list", { name: "Turn timeline, raw data" })).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    expect(screen.getByRole("button", { name: "Show raw trace data" })).toBeVisible();
  });

  it("a raw display failure keeps the formatted view available", async () => {
    loadRawTrace.mockResolvedValue({ ok: false, error: "UNREADABLE" });
    setup();
    await userEvent.click(screen.getByRole("tab", { name: "Raw JSON" }));
    await userEvent.click(screen.getByRole("button", { name: "Show raw trace data" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Raw trace data could not be displayed.");
    await userEvent.click(within(alert).getByRole("button", { name: "Back to formatted" }));
    expect(screen.getByRole("list", { name: "Turn timeline" })).toBeVisible();
    // Focus moves on the next animation frame.
    await waitFor(() => expect(screen.getByRole("tab", { name: "Formatted" })).toHaveFocus());
  });

  it("tabs use manual activation: arrows move focus without switching", async () => {
    setup();
    const formattedTab = screen.getByRole("tab", { name: "Formatted" });
    formattedTab.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toHaveFocus();
    expect(formattedTab).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Raw JSON" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ReviewPanel", () => {
  it("saves a first review with expectedVersion 0 and announces the saved verdict", async () => {
    saveTraceReview.mockResolvedValue({ ok: true, review: review({ verdict: "INCORRECT", note: "Wrong currency", nominated: true }) as unknown as TraceReview });
    render(<ReviewPanel traceId={TRACE_ID} review={null} inProgress={false} />);
    expect(screen.getByText("Not reviewed yet.")).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Incorrect" }));
    await userEvent.type(screen.getByLabelText("Note (optional)"), "Wrong currency");
    await userEvent.click(screen.getByRole("checkbox", { name: /Nominate as an evaluation-fixture candidate/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(saveTraceReview).toHaveBeenCalledWith({ traceId: TRACE_ID, verdict: "INCORRECT", note: "Wrong currency", nominated: true, expectedVersion: 0 }));
    expect(await screen.findByText("Review saved: Incorrect.")).toBeVisible();
    expect(screen.getByText(/reviewed by Meera Iyer/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Replace review" })).toBeVisible();
  });

  it("a stale review shows the other review, keeps the draft, and the retry sends the new version", async () => {
    saveTraceReview
      .mockResolvedValueOnce({ ok: false, error: "STALE", current: review({ verdict: "CORRECT", version: 4, reviewer: { id: 3, displayName: "Asha Rao" } }) as unknown as TraceReview })
      .mockResolvedValueOnce({ ok: true, review: review({ verdict: "PARTIAL", version: 5 }) as unknown as TraceReview });
    render(<ReviewPanel traceId={TRACE_ID} review={review({ version: 3 }) as unknown as TraceReview} inProgress={false} />);
    await userEvent.click(screen.getByRole("radio", { name: "Partially correct" }));
    await userEvent.click(screen.getByRole("button", { name: "Replace review" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Another review was saved while you were editing.");
    expect(alert).toHaveTextContent("Correct by Asha Rao");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByRole("radio", { name: "Partially correct" })).toBeChecked();
    expect(saveTraceReview).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Replace with my review" }));
    await waitFor(() => expect(saveTraceReview).toHaveBeenCalledTimes(2));
    expect((saveTraceReview.mock.calls[1][0] as { expectedVersion: number }).expectedVersion).toBe(4);
  });

  it("blocks a note over 2,000 characters and shows no form for a running turn", async () => {
    const { unmount } = render(<ReviewPanel traceId={TRACE_ID} review={null} inProgress={false} />);
    await userEvent.click(screen.getByRole("radio", { name: "Correct" }));
    await userEvent.click(screen.getByLabelText("Note (optional)"));
    await userEvent.paste("x".repeat(2001));
    expect(screen.getByText(/2,001 of 2,000 characters/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Save review" })).toBeDisabled();
    unmount();
    render(<ReviewPanel traceId={TRACE_ID} review={null} inProgress />);
    expect(screen.getByText("Reviews open when the turn finishes.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
  });
});

describe("DeletePanel", () => {
  function setup() {
    return render(
      <DeletionFrame startedAt="17 Nov 2026, 07:26 UTC" hrUser="Meera Iyer">
        <p>Trace detail content</p>
        <DeletePanel traceId={TRACE_ID} startedAt="17 Nov 2026, 07:26 UTC" hrUser="Meera Iyer" status="Completed" modelCalls={2} toolCalls={2} hasReview />
      </DeletionFrame>,
    );
  }

  it("confirms inline with time, HR user, status, and scope; Back returns focus", async () => {
    setup();
    const opener = screen.getByRole("button", { name: "Delete this trace…" });
    await userEvent.click(opener);
    const question = screen.getByRole("heading", { name: "Delete this trace permanently?" });
    await waitFor(() => expect(question).toHaveFocus());
    expect(screen.getByText("Meera Iyer")).toBeVisible();
    expect(screen.getByText("Completed")).toBeVisible();
    expect(screen.getByText(/its 2 model calls and 2 tool calls, and its review. Other turns in this conversation are kept. This cannot be undone./)).toBeVisible();
    expect(deleteTrace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete this trace…" })).toHaveFocus());
  });

  it("success replaces the detail with the backend's deletion record", async () => {
    deleteTrace.mockResolvedValue({ ok: true, deleted: { modelCalls: 2, toolCalls: 2, messages: 2, review: true } });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete this trace…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete trace" }));
    const heading = await screen.findByRole("heading", { name: "Trace deleted" });
    expect(screen.queryByText("Trace detail content")).toBeNull();
    expect(screen.getByText(/2 messages, 2 model calls, 2 tool calls, and its review/)).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("an already deleted trace says so and changes nothing else", async () => {
    deleteTrace.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete this trace…" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete trace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This trace was already deleted or does not exist.");
    expect(screen.getByText("Trace detail content")).toBeVisible();
  });
});

describe("JsonSection", () => {
  it("collapses large values, renders JSON as text in a labelled region, and copies only on request", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const big = { rows: Array.from({ length: 200 }, (_, i) => ({ i, html: "<img src=x onerror=alert(1)>" })) };
    const { container } = render(<JsonSection label="Result" value={big} />);
    expect(screen.queryByRole("region", { name: "Result JSON" })).toBeNull();
    expect(screen.getByText(/KB · /)).toBeVisible();
    expect(writeText).not.toHaveBeenCalled();
    await userEvent.click(container.querySelector("summary")!);
    expect(screen.getByRole("region", { name: "Result JSON" })).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Copy JSON: Result" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(big, null, 2));
    expect(await screen.findByText("Copied")).toBeVisible();
  });
});
