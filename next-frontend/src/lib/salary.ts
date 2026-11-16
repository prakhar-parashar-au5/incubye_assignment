import type { components, operations } from "@/generated/api";

// Salary adjustment presentation and form rules, shared by server pages and client components.
// Every type comes from the generated contract. The browser never calculates a salary: it checks
// input format only, and every number shown as a result comes from the backend preview.

type Schemas = components["schemas"];
export type SalaryAdjustmentCommand = Schemas["SalaryAdjustmentCommand"];
export type SalaryAdjustmentPreview = Schemas["SalaryAdjustmentPreview"];
export type SalaryRequestView = Schemas["SalaryRequestView"];
export type CompensationRecordView = Schemas["CompensationRecordView"];
export type AdjustmentTarget = SalaryAdjustmentCommand["target"];
export type AdjustmentMethod = SalaryAdjustmentCommand["method"];
export type AdjustmentReason = SalaryAdjustmentCommand["reason"];
export type RequestStatus = SalaryRequestView["status"];
export type ConfirmationMode = SalaryAdjustmentPreview["confirmationMode"];
export type ErrorReason = NonNullable<Schemas["ErrorResponse"]["error"]["reason"]>;
export type RequestListQuery = NonNullable<operations["listSalaryAdjustmentRequests"]["parameters"]["query"]>;

export const TARGET_LABELS: Record<AdjustmentTarget, string> = {
  BASE_SALARY: "Annual base salary",
  ANNUAL_BONUS: "Annual bonus",
};

export const METHOD_LABELS: Record<AdjustmentMethod, string> = {
  PERCENTAGE_INCREASE: "Percentage increase",
  PERCENTAGE_DECREASE: "Percentage decrease",
  FIXED_INCREASE: "Fixed amount increase",
  FIXED_DECREASE: "Fixed amount decrease",
  REPLACEMENT: "Replacement amount",
};

export const METHODS: readonly AdjustmentMethod[] = [
  "PERCENTAGE_INCREASE",
  "PERCENTAGE_DECREASE",
  "FIXED_INCREASE",
  "FIXED_DECREASE",
  "REPLACEMENT",
];

export const REASON_LABELS: Record<AdjustmentReason, string> = {
  PERFORMANCE: "Performance",
  MARKET_ADJUSTMENT: "Market adjustment",
  PROMOTION: "Promotion",
  ROLE_CHANGE: "Role change",
  CORRECTION: "Correction",
};

export const REASONS: readonly AdjustmentReason[] = ["PERFORMANCE", "MARKET_ADJUSTMENT", "PROMOTION", "ROLE_CHANGE", "CORRECTION"];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
  STALE: "Out of date",
};

/** Dot colour classes for request status; always shown next to the label text. */
export const STATUS_DOT: Record<RequestStatus, string> = {
  PENDING: "bg-state-upcoming",
  APPROVED: "bg-state-current",
  CANCELLED: "bg-state-historical",
  STALE: "bg-state-historical",
};

export const CONFIRM_LABELS: Record<ConfirmationMode, { action: string; pending: string }> = {
  DIRECT_APPLY: { action: "Apply salary change", pending: "Applying…" },
  SUBMIT_REQUEST: { action: "Submit for approval", pending: "Submitting…" },
};

export const NOTE_MAX_LENGTH = 2000;
export const PERCENT_LIMITS: Record<"PERCENTAGE_INCREASE" | "PERCENTAGE_DECREASE", { min: number; max: number }> = {
  PERCENTAGE_INCREASE: { min: 1, max: 200 },
  PERCENTAGE_DECREASE: { min: 1, max: 50 },
};

export function isPercentageMethod(method: AdjustmentMethod): method is "PERCENTAGE_INCREASE" | "PERCENTAGE_DECREASE" {
  return method === "PERCENTAGE_INCREASE" || method === "PERCENTAGE_DECREASE";
}

/** "+10%", "−5%", "+INR 50,000.00"-style input description, without formatting money here. */
export function describeInput(method: AdjustmentMethod, value: string): string {
  switch (method) {
    case "PERCENTAGE_INCREASE":
      return `+${value}%`;
    case "PERCENTAGE_DECREASE":
      return `−${value}%`;
    case "FIXED_INCREASE":
      return `+${value}`;
    case "FIXED_DECREASE":
      return `−${value}`;
    default:
      return `set to ${value}`;
  }
}

export type FormField = "target" | "method" | "value" | "effectiveFrom" | "reason" | "note";
export type FormErrors = Partial<Record<FormField, string>>;

export type AdjustmentDraft = {
  target: AdjustmentTarget | "";
  method: AdjustmentMethod | "";
  value: string;
  effectiveFrom: string;
  reason: AdjustmentReason | "";
  note: string;
};

/**
 * Format checks before calling preview. These catch typing mistakes only; the backend validates
 * every rule again, including the salary band, and its answer decides.
 */
export function validateDraft(
  draft: AdjustmentDraft,
  context: { todayUtc: string; currentBonusIsZero: boolean },
): { errors: FormErrors; command?: SalaryAdjustmentCommand } {
  const errors: FormErrors = {};
  if (!draft.target) errors.target = "Choose what to change.";
  if (!draft.method) errors.method = "Choose how to change it.";
  const value = draft.value.trim();
  if (draft.method && isPercentageMethod(draft.method)) {
    const { min, max } = PERCENT_LIMITS[draft.method];
    if (!/^\d+$/.test(value)) errors.value = "Enter a whole number of percent, without decimals.";
    else if (Number(value) < min || Number(value) > max) errors.value = `Enter a whole number from ${min} to ${max}.`;
    if (draft.target === "ANNUAL_BONUS" && context.currentBonusIsZero) {
      errors.method = "Bonus is zero. Use a fixed amount increase or a replacement amount.";
    }
  } else if (draft.method) {
    if (!/^\d{1,13}(\.\d{1,2})?$/.test(value)) errors.value = "Enter an amount with at most two decimal places.";
    else if (/^0+(\.0+)?$/.test(value) && draft.method !== "REPLACEMENT") errors.value = "Enter an amount greater than zero.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) errors.effectiveFrom = "Enter an effective date.";
  else if (draft.effectiveFrom < context.todayUtc) errors.effectiveFrom = "Choose today or a future date. Past dates are not supported.";
  if (!draft.reason) errors.reason = "Choose a reason.";
  const note = draft.note.trim();
  if (note.length > NOTE_MAX_LENGTH) errors.note = `Shorten the note to ${NOTE_MAX_LENGTH.toLocaleString("en-US")} characters.`;
  else if (draft.reason === "CORRECTION" && note.length === 0) errors.note = "A note is required for a correction.";

  if (Object.keys(errors).length > 0 || !draft.target || !draft.method || !draft.reason) return { errors };
  return {
    errors,
    command: {
      target: draft.target,
      method: draft.method,
      value,
      effectiveFrom: draft.effectiveFrom,
      reason: draft.reason,
      note: note.length > 0 ? note : null,
    },
  };
}

export function sameCommand(a: SalaryAdjustmentCommand | undefined, b: SalaryAdjustmentCommand | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.target === b.target &&
    a.method === b.method &&
    a.value === b.value &&
    a.effectiveFrom === b.effectiveFrom &&
    a.reason === b.reason &&
    (a.note ?? null) === (b.note ?? null)
  );
}

/** Messages for backend VALIDATION_ERROR reasons, and the field each belongs to. */
export const REASON_MESSAGES: Record<ErrorReason, { field?: FormField; message: string }> = {
  PREVIEW_EXPIRED: { message: "This preview has expired. Preview again to see the current result." },
  PREVIEW_INVALID: { message: "This preview is no longer valid. Preview again." },
  PREVIEW_MISMATCH: { message: "The adjustment no longer matches its preview. Preview again." },
  PERCENTAGE_RANGE: { field: "value", message: "This percentage is outside the allowed range for this employee." },
  INVALID_AMOUNT: { field: "value", message: "Enter a valid amount with at most two decimal places." },
  NEGATIVE_RESULT: { field: "value", message: "This change would make the value negative." },
  NO_CHANGE: { field: "value", message: "This change would leave the value the same. Enter a different value." },
  ZERO_BONUS_PERCENTAGE: { field: "method", message: "Bonus is zero. Use a fixed amount increase or a replacement amount." },
  BASE_NOT_POSITIVE: { field: "value", message: "Annual base salary must stay greater than zero." },
  SALARY_BAND: { message: "The result is outside the salary band for this role and country. Change the adjustment." },
  PAST_EFFECTIVE_DATE: { field: "effectiveFrom", message: "Choose today or a future date. Past dates are not supported." },
  EFFECTIVE_BEFORE_CURRENT: { field: "effectiveFrom", message: "Choose a date on or after the employee's current compensation starts." },
  FUTURE_CHANGE_EXISTS: {
    field: "effectiveFrom",
    message: "This employee already has an approved future change. Choose today as the effective date, or wait until that change takes effect.",
  },
  NOTE_REQUIRED: { field: "note", message: "A note is required." },
  IDEMPOTENCY_KEY_REQUIRED: { message: "The request could not be sent safely. Try again." },
};

/** URL for the request list. Defaults (sort by created time, newest first, page 1) are left out. */
export function requestListHref(query: RequestListQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.department) params.set("department", query.department);
  if (query.status) params.set("status", query.status);
  if (query.direction && query.direction !== "desc") params.set("direction", query.direction);
  if (query.pageSize && query.pageSize !== 25) params.set("pageSize", String(query.pageSize));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return `/salary-requests${text ? `?${text}` : ""}`;
}

/** The Admin queue: pending requests, oldest first. */
export const ADMIN_QUEUE_HREF = requestListHref({ status: "PENDING", direction: "asc" });

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}
