// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfirmOutcome, DecisionOutcome, PreviewOutcome } from "@/server/actions/salary";

import { REQUEST_ID, compensationRecord, preview, requestView, selectedCompensation } from "../support/salary-fixtures";

const previewAction = vi.fn<(code: unknown, command: unknown) => Promise<PreviewOutcome>>();
const confirmAction = vi.fn<(input: Record<string, unknown>) => Promise<ConfirmOutcome>>();
const approveAction = vi.fn<(id: unknown, key: unknown) => Promise<DecisionOutcome>>();
const cancelAction = vi.fn<(id: unknown, note: unknown, key: unknown) => Promise<DecisionOutcome>>();
vi.mock("@/server/actions/salary", () => ({
  previewSalaryAdjustment: (code: unknown, command: unknown) => previewAction(code, command),
  confirmSalaryAdjustment: (input: Record<string, unknown>) => confirmAction(input),
  approveSalaryRequest: (id: unknown, key: unknown) => approveAction(id, key),
  cancelSalaryRequest: (id: unknown, note: unknown, key: unknown) => cancelAction(id, note, key),
}));
const push = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AdjustmentWorkspace } = await import("@/app/employees/[employeeCode]/adjust/adjustment-workspace");
const { RequestDecision } = await import("@/app/salary-requests/[requestId]/request-decision");
const { CompensationSnapshot, RequestOutcomeNotice } = await import("@/components/salary/salary-ui");

type Preview = Extract<PreviewOutcome, { ok: true }>["preview"];
const ok = (overrides: Record<string, unknown> = {}): PreviewOutcome => ({ ok: true, preview: preview(overrides) as unknown as Preview });

const props = {
  employee: { code: "ACME02345", name: "Aarav Banerjee", jobTitle: "Support Associate", department: "Support", countryName: "India" },
  current: { annualBaseSalary: "1052700.00", annualBonus: "84952.89", annualCashCompensation: "1137652.89", currency: "INR" as const, version: 1, stateLabel: "Current" },
  role: "ADMIN" as const,
  todayUtc: "2026-11-16",
  backHref: "/employees/ACME02345",
  pendingRequest: null,
  detailSearch: "",
};

async function fillAndPreview(user: ReturnType<typeof userEvent.setup>, value = "10") {
  await user.click(screen.getByRole("radio", { name: "Annual base salary" }));
  await user.click(screen.getByRole("radio", { name: "Percentage increase" }));
  await user.type(screen.getByLabelText("Increase (%)"), value);
  await user.selectOptions(screen.getByLabelText("Reason"), "PERFORMANCE");
  await user.click(screen.getByRole("button", { name: "Preview" }));
}

beforeEach(() => {
  previewAction.mockReset();
  confirmAction.mockReset();
  approveAction.mockReset();
  cancelAction.mockReset();
  push.mockReset();
  replace.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe("AdjustmentWorkspace", () => {
  it("shows the backend's exact preview and the confirmation the backend chose", async () => {
    previewAction.mockResolvedValueOnce(ok());
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} />);
    await fillAndPreview(user);

    expect(previewAction).toHaveBeenCalledWith("ACME02345", {
      target: "BASE_SALARY",
      method: "PERCENTAGE_INCREASE",
      value: "10",
      effectiveFrom: "2026-11-16",
      reason: "PERFORMANCE",
      note: null,
    });
    const panel = await screen.findByRole("region", { name: "Preview: nothing has changed yet" });
    expect(within(panel).getByText("INR 11,57,970.00")).toBeVisible();
    expect(within(panel).getAllByText("INR 1,05,270.00").length).toBeGreaterThan(0);
    expect(within(panel).getByText("(+10.00%)")).toBeVisible();
    expect(within(panel).getByText(/Within the salary band/)).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Apply salary change" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Preview: nothing has changed yet" })).toHaveFocus());
  });

  it("labels the confirmation Submit for approval when the backend says SUBMIT_REQUEST", async () => {
    previewAction.mockResolvedValueOnce(ok({ confirmationMode: "SUBMIT_REQUEST" }));
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} role="SCOPED" />);
    await fillAndPreview(user);
    expect(await screen.findByRole("button", { name: "Submit for approval" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Apply salary change" })).toBeNull();
  });

  it("marks the preview out of date when any input changes and removes the confirm action", async () => {
    previewAction.mockResolvedValueOnce(ok());
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} />);
    await fillAndPreview(user);
    await screen.findByRole("button", { name: "Apply salary change" });
    await user.type(screen.getByLabelText("Increase (%)"), "5");
    expect(screen.getByText(/Out of date: your inputs changed/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Apply salary change" })).toBeNull();
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("confirms with the previewed token and command, reusing one idempotency key for a retry", async () => {
    previewAction.mockResolvedValueOnce(ok());
    confirmAction.mockResolvedValueOnce({ ok: false, kind: "SERVICE_UNAVAILABLE" }).mockResolvedValueOnce({
      ok: true,
      mode: "DIRECT_APPLY",
      compensation: compensationRecord(2) as never,
    });
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} detailSearch="from=%2Femployees%3Fdepartment%3DSupport" />);
    await fillAndPreview(user);
    await user.click(await screen.findByRole("button", { name: "Apply salary change" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("may or may not have been applied");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(2));
    const [first, second] = confirmAction.mock.calls.map(([input]) => input);
    expect(first).toMatchObject({ employeeCode: "ACME02345", mode: "DIRECT_APPLY", previewToken: preview().previewToken, adjustment: { value: "10" } });
    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(push).toHaveBeenCalledWith("/employees/ACME02345?from=%2Femployees%3Fdepartment%3DSupport&applied=2");
  });

  it("on a stale conflict shows the fresh preview and the earlier one struck through, and waits for a new click", async () => {
    previewAction.mockResolvedValueOnce(ok());
    confirmAction.mockResolvedValueOnce({ ok: false, kind: "STALE_VERSION", fresh: ok({ expectedCompensationVersion: 2, proposed: { annualBaseSalary: "1180000.00", annualBonus: "84952.89", annualCashCompensation: "1264952.89" } }) });
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} />);
    await fillAndPreview(user);
    await user.click(await screen.findByRole("button", { name: "Apply salary change" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Compensation changed while you were reviewing");
    expect(alert).toHaveTextContent("fresh preview based on compensation version 2");
    expect(alert.querySelector("s")).toHaveTextContent("INR 11,57,970.00");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.getByText("INR 11,80,000.00")).toBeVisible();
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apply salary change" })).toBeEnabled();
  });

  it("maps backend reasons to the field or to a form-level message", async () => {
    previewAction
      .mockResolvedValueOnce({ ok: false, kind: "VALIDATION_ERROR", reason: "FUTURE_CHANGE_EXISTS" })
      .mockResolvedValueOnce({ ok: false, kind: "VALIDATION_ERROR", reason: "SALARY_BAND" });
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} />);
    await fillAndPreview(user);
    expect(await screen.findByLabelText("Effective date")).toHaveAccessibleDescription(/already has an approved future change/);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/outside the salary band/)).toBeVisible();
    expect(screen.queryByRole("region", { name: /Preview/ })).toBeNull();
  });

  it("checks format before calling the backend and lists errors in a focused summary", async () => {
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} />);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Choose what to change.");
    expect(summary).toHaveTextContent("Choose a reason.");
    expect(previewAction).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Reason"), "CORRECTION");
    expect(screen.getByLabelText("Note (required for corrections)")).toBeVisible();
  });

  it("disables percentage methods for a zero bonus", async () => {
    const user = userEvent.setup();
    render(<AdjustmentWorkspace {...props} current={{ ...props.current, annualBonus: "0.00" }} />);
    await user.click(screen.getByRole("radio", { name: "Annual bonus" }));
    expect(screen.getByRole("radio", { name: "Percentage increase" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Fixed amount increase" })).toBeEnabled();
    expect(screen.getByText(/Bonus is zero/)).toBeVisible();
  });

  it("shows expiry, future-change, and pending-request warnings, and renders the note as text", async () => {
    previewAction.mockResolvedValueOnce(
      ok({
        previewExpiresAt: new Date(Date.now() - 1000).toISOString(),
        adjustment: { ...preview().adjustment, note: "<b>raise</b>" },
        warnings: {
          futureChange: { effectiveFrom: "2027-01-01", annualBaseSalary: "1300000.00", annualBonus: "84952.89", message: "x" },
          pendingRequestWillBecomeStale: true,
        },
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<AdjustmentWorkspace {...props} />);
    await fillAndPreview(user);
    expect(await screen.findByText(/This preview has expired/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Apply salary change" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Preview again" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/An approved change takes effect on 1 Jan 2027/)).toBeVisible();
    expect(screen.getByText(/will make that request out of date/)).toBeVisible();
    expect(screen.getByText("<b>raise</b>")).toBeVisible();
    expect(container.querySelector("dd b")).toBeNull();
  });
});

describe("RequestDecision", () => {
  it("approves after an explicit confirmation step, with an idempotency key", async () => {
    approveAction.mockResolvedValueOnce({ ok: true, request: requestView({ status: "APPROVED" }) as never });
    const user = userEvent.setup();
    render(<RequestDecision requestId={REQUEST_ID} nextVersion={2} behind={false} />);
    await user.click(screen.getByRole("button", { name: "Approve request" }));
    expect(approveAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Compensation version 2 will be created/)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(approveAction).toHaveBeenCalledTimes(1));
    expect(approveAction.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
    // The page is re-read from the backend; no completion flag is put in the URL.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("requires a cancellation reason, and Back returns focus to the opening button", async () => {
    cancelAction.mockResolvedValueOnce({ ok: true, request: requestView({ status: "CANCELLED" }) as never });
    const user = userEvent.setup();
    render(<RequestDecision requestId={REQUEST_ID} nextVersion={2} behind={false} />);
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    const note = screen.getByLabelText("Reason for cancelling");
    expect(note).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(cancelAction).not.toHaveBeenCalled();
    expect(note).toHaveAccessibleDescription(/Enter a reason for cancelling/);
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Cancel request" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    await user.type(screen.getByLabelText("Reason for cancelling"), "Budget freeze");
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() => expect(cancelAction).toHaveBeenCalledWith(REQUEST_ID, "Budget freeze", expect.stringMatching(/^[0-9a-f-]{36}$/)));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(replace).not.toHaveBeenCalled();
  });

  it("explains a request that became out of date or was already decided", async () => {
    approveAction.mockResolvedValueOnce({ ok: false, kind: "STALE_VERSION" }).mockResolvedValueOnce({ ok: false, kind: "REQUEST_NOT_PENDING" });
    const user = userEvent.setup();
    render(<RequestDecision requestId={REQUEST_ID} nextVersion={2} behind />);
    await user.click(screen.getByRole("button", { name: "Approve request" }));
    expect(screen.getByText(/approval will be refused/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This request can no longer be approved");
    await user.click(screen.getByRole("button", { name: "Approve request" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Already decided"));
  });
});

describe("CompensationSnapshot", () => {
  it("shows the full backend compensation record: base, bonus, cash, currency, version, and state", () => {
    render(<CompensationSnapshot compensation={selectedCompensation()} employeeLeft={false} headingId="snapshot" />);
    const section = screen.getByRole("region", { name: "Current compensation" });
    const value = (label: string) => within(section).getByText(label).nextElementSibling;
    expect(value("Annual base salary")).toHaveTextContent("INR 11,57,970.00");
    expect(value("Annual bonus")).toHaveTextContent("INR 84,952.89");
    expect(value("Annual cash compensation")).toHaveTextContent("INR 12,42,922.89");
    expect(value("Compensation version")).toHaveTextContent("2, effective 16 Nov 2026");
    expect(section).toHaveTextContent("Current");
    expect(section).toHaveTextContent("Amounts are in INR");
  });

  it("names an upcoming record as upcoming rather than current", () => {
    render(<CompensationSnapshot compensation={selectedCompensation({ state: "UPCOMING", effectiveFrom: "2027-01-01" })} employeeLeft={false} headingId="snapshot" />);
    expect(screen.getByRole("region", { name: "Upcoming compensation" })).toHaveTextContent("Upcoming from 1 Jan 2027");
  });
});

describe("RequestOutcomeNotice", () => {
  // The notice takes only the persisted request, so no URL value can change what it says, and
  // it never claims that the current browser performed the action.
  const FIRST_PERSON = /Request (submitted|approved|cancelled)|Salary change applied|You (approved|cancelled|submitted)/;

  it("describes a pending request from its record without implying compensation changed", () => {
    render(<RequestOutcomeNotice request={requestView() as never} />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Pending approval since 16 Nov 2026, 13:00 UTC. Compensation has not changed.");
    expect(notice.textContent).not.toMatch(FIRST_PERSON);
  });

  it("describes approval and cancellation in the third person, with the decider and time", () => {
    const decided = { decidedBy: { displayName: "Meera Iyer", email: "meera.iyer@acme.com" }, decidedAt: "2026-11-16T14:00:00.000Z" };
    const { unmount } = render(<RequestOutcomeNotice request={requestView({ status: "APPROVED", resultingCompensationVersion: 2, ...decided }) as never} />);
    expect(screen.getByRole("status")).toHaveTextContent("Approved by Meera Iyer on 16 Nov 2026, 14:00 UTC. Compensation version 2 was created.");
    expect(screen.getByRole("link", { name: "View compensation history" })).toHaveAttribute("href", "/employees/ACME02345?from=%2Fsalary-requests");
    expect(screen.getByRole("status").textContent).not.toMatch(FIRST_PERSON);
    unmount();

    render(<RequestOutcomeNotice request={requestView({ status: "CANCELLED", decisionNote: "Budget freeze", ...decided }) as never} />);
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled by Meera Iyer on 16 Nov 2026, 14:00 UTC. Compensation did not change.");
    expect(screen.getByRole("status").textContent).not.toMatch(FIRST_PERSON);
  });

  it("leaves out-of-date requests to their own notice", () => {
    const { container } = render(<RequestOutcomeNotice request={requestView({ status: "STALE" }) as never} />);
    expect(container).toBeEmptyDOMElement();
  });
});
