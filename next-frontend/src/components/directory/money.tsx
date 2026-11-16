import type { components } from "@/generated/api";
import { COMPENSATION_STATE_LABELS, formatDate, formatMoney, type Currency } from "@/lib/format";
import { cn } from "@/lib/utils";

type SelectedCompensation = components["schemas"]["SelectedCompensation"];

/** One monetary value: tabular figures, never wrapped, currency code always shown. */
export function Money({ amount, currency, className }: { amount: string; currency: Currency; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} translate="no">
      {formatMoney(amount, currency)}
    </span>
  );
}

const STATE_DOT: Record<SelectedCompensation["state"], string> = {
  CURRENT: "bg-state-current",
  UPCOMING: "bg-state-upcoming",
  HISTORICAL: "bg-state-historical",
};

/**
 * Compensation state as text, with a colour dot that only repeats the text. A historical record
 * for someone who has left is "Last recorded compensation", never current spending.
 */
export function CompensationStateLabel({
  compensation,
  employeeLeft,
  className,
}: {
  compensation: Pick<SelectedCompensation, "state" | "effectiveFrom">;
  employeeLeft: boolean;
  className?: string;
}) {
  let text: string = COMPENSATION_STATE_LABELS[compensation.state];
  if (compensation.state === "UPCOMING") text = `Upcoming from ${formatDate(compensation.effectiveFrom)}`;
  if (compensation.state === "HISTORICAL" && employeeLeft) text = "Last recorded compensation";
  return (
    <span className={cn("text-[0.75rem] text-muted-foreground", className)}>
      <span aria-hidden="true" className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", STATE_DOT[compensation.state])} />
      {text}
    </span>
  );
}
