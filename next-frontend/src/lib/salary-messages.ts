import { REASON_MESSAGES, type ErrorReason, type FormField } from "@/lib/salary";

// Public copy for salary-adjustment failures. Backend messages are not shown; the code and the
// optional reason pick this app's own text.

export type FailureKind = string;

export type FailureCopy = {
  title: string;
  body: string;
  /** Field the message belongs to, when it is a correctable input problem. */
  field?: FormField;
  /** Whether "Try again" is meaningful (transport problems only). */
  retry?: boolean;
  /** The preview must be refreshed before confirming. */
  needsPreview?: boolean;
  /** The current session ended. */
  signIn?: boolean;
};

export function failureCopy(kind: FailureKind, reason?: ErrorReason, context: "preview" | "confirm" = "confirm"): FailureCopy {
  if (kind === "VALIDATION_ERROR" && reason) {
    const mapped = REASON_MESSAGES[reason];
    const needsPreview = reason === "PREVIEW_EXPIRED" || reason === "PREVIEW_INVALID" || reason === "PREVIEW_MISMATCH";
    return { title: needsPreview ? "Preview again" : "Check the adjustment", body: mapped.message, field: mapped.field, needsPreview };
  }
  switch (kind) {
    case "VALIDATION_ERROR":
    case "INVALID_INPUT":
      return { title: "Check the adjustment", body: "The adjustment was not accepted. Check the values and try again." };
    case "EMPLOYEE_INELIGIBLE":
      return { title: "Not eligible", body: "This employee is not eligible for a compensation adjustment." };
    case "PENDING_REQUEST_EXISTS":
      return { title: "A request is already pending", body: "A salary change request for this employee is already waiting for approval." };
    case "FORBIDDEN":
      return { title: "Not allowed", body: "Your HR role cannot do this." };
    case "NOT_FOUND":
      return { title: "Not found", body: "This employee or request is not available to your HR account." };
    case "DUPLICATE_OPERATION":
      return {
        title: "Already submitted with different details",
        body: "This action was already submitted with different details. Reload the page to see the current state.",
      };
    case "REQUEST_NOT_PENDING":
      return { title: "Already decided", body: "This request is no longer pending. Another Admin HR user may have decided it." };
    case "STALE_VERSION":
      return { title: "Compensation changed", body: "Compensation changed after this was prepared. Nothing was applied." };
    case "UNAUTHENTICATED":
      return { title: "Your session has ended", body: "Sign in again to continue. Nothing was changed by this attempt.", signIn: true };
    case "RATE_LIMITED":
      return { title: "Too many requests", body: "Wait and try again later.", retry: true };
    case "TIMEOUT":
    case "UNAVAILABLE":
    case "SERVICE_UNAVAILABLE":
    case "INTERNAL_ERROR":
      if (context === "preview") {
        return { title: "The compensation service is not responding", body: "Nothing was changed. Try again in a moment.", retry: true };
      }
      return {
        title: "The compensation service did not confirm this action",
        body: "It may or may not have been applied. Try again: a retry is safe and cannot apply the change twice.",
        retry: true,
      };
    default:
      return { title: "Something went wrong", body: "The compensation service sent a response this page cannot read. Nothing is shown as applied.", retry: true };
  }
}
