import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheck, Info } from "lucide-react";

import { CompensationStateLabel, Money } from "@/components/directory/money";
import type { components } from "@/generated/api";
import { formatDate, formatDateTime, type Currency } from "@/lib/format";
import { STATUS_DOT, STATUS_LABELS, type RequestStatus, type SalaryRequestView } from "@/lib/salary";
import { cn } from "@/lib/utils";

// Small presentation pieces shared by the adjustment page and the request pages.

type SelectedCompensation = components["schemas"]["SelectedCompensation"];

/**
 * What the persisted request says happened, in the third person. It reads the same whether this
 * browser just made the change or someone opened the link later, and it takes no URL input, so a
 * crafted link cannot produce a completion claim. STALE has its own out-of-date notice.
 */
export function RequestOutcomeNotice({ request }: { request: SalaryRequestView }) {
  const by = request.decidedBy ? ` by ${request.decidedBy.displayName}` : "";
  const at = request.decidedAt ? ` on ${formatDateTime(request.decidedAt)}` : "";
  const box = (className: string, icon: ReactNode, text: ReactNode) => (
    <p role="status" className={cn("flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-sm", className)}>
      {icon}
      <span>{text}</span>
    </p>
  );
  if (request.status === "PENDING") {
    return box(
      "border-[#c3d0ec] bg-accent",
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />,
      `Pending approval since ${formatDateTime(request.createdAt)}. Compensation has not changed. An Admin HR user will approve or cancel this request.`,
    );
  }
  if (request.status === "APPROVED") {
    return box(
      "border-[#b9dcc8] bg-[#eef7f1]",
      <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-current" />,
      <>
        Approved{by}
        {at}. Compensation version {request.resultingCompensationVersion} was created.{" "}
        <Link
          href={`/employees/${request.employee.employeeCode}?from=${encodeURIComponent("/salary-requests")}`}
          className="font-medium text-primary underline underline-offset-4"
        >
          View compensation history
        </Link>
      </>,
    );
  }
  if (request.status === "CANCELLED") {
    return box(
      "border-line bg-muted",
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-historical" />,
      `Cancelled${by}${at}. Compensation did not change.`,
    );
  }
  return null;
}

/**
 * The employee's compensation as the backend selected it (current, upcoming, or last recorded):
 * all three annual values in native currency, plus version and state. Used on request detail so
 * an Admin sees the whole record, not only the changed value, before deciding.
 */
export function CompensationSnapshot({
  compensation,
  employeeLeft,
  headingId,
}: {
  compensation: SelectedCompensation;
  employeeLeft: boolean;
  headingId: string;
}) {
  const heading =
    compensation.state === "UPCOMING"
      ? "Upcoming compensation"
      : compensation.state === "HISTORICAL"
        ? employeeLeft
          ? "Last recorded compensation"
          : "Historical compensation"
        : "Current compensation";
  const { currency } = compensation;
  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-[0.9375rem] font-semibold">
          {heading}
        </h2>
        <CompensationStateLabel compensation={compensation} employeeLeft={employeeLeft} className="text-[0.8125rem]" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Annual base salary</dt>
          <dd className="font-medium">
            <Money amount={compensation.annualBaseSalary} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Annual bonus</dt>
          <dd className="font-medium">
            <Money amount={compensation.annualBonus} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Annual cash compensation</dt>
          <dd className="font-medium">
            <Money amount={compensation.annualCashCompensation} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Compensation version</dt>
          <dd className="font-medium">
            <span className="tabular-nums">{compensation.version}</span>, effective {formatDate(compensation.effectiveFrom)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">Amounts are in {currency}, the employee&rsquo;s native currency.</p>
    </section>
  );
}

/** Request status as text; the dot only repeats it. */
export function RequestStatusLabel({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] font-medium whitespace-nowrap", className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABELS[status]}
    </span>
  );
}

/** A signed money amount: "+INR 2,50,000.00" or "−INR 10,000.00". */
export function SignedMoney({ amount, currency, className }: { amount: string; currency: Currency; className?: string }) {
  const negative = amount.startsWith("-");
  const magnitude = negative ? amount.slice(1) : amount;
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      <span aria-hidden="true">{negative ? "−" : "+"}</span>
      <span className="sr-only">{negative ? "minus " : "plus "}</span>
      <Money amount={magnitude} currency={currency} />
    </span>
  );
}

/** "+10.00%" from the backend's signed two-decimal percentage. */
export function SignedPercent({ value }: { value: string | null }) {
  if (value === null) return null;
  const negative = value.startsWith("-");
  return (
    <span className="whitespace-nowrap tabular-nums">
      ({negative ? "−" : "+"}
      {negative ? value.slice(1) : value}%)
    </span>
  );
}

/**
 * The change record: one ruled line with fixed Before | After | Change columns, the adjustment
 * extension of DESIGN.md's access record. Stacks into labelled rows on phones.
 */
export function ChangeRecord({
  label,
  before,
  after,
  change,
  percentage,
  currency,
  emphasis = true,
}: {
  label: string;
  before: string;
  after: string;
  change?: string;
  percentage?: string | null;
  currency: Currency;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("border-t border-line pt-2.5", !emphasis && "text-muted-foreground")}>
      <p className={cn("text-[0.8125rem]", emphasis ? "font-semibold text-foreground" : "font-medium")}>{label}</p>
      <dl className={cn("mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1", change ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-[0.75rem] text-muted-foreground">Before</dt>
          <dd className={emphasis ? "text-[0.9375rem]" : "text-sm"}>
            <Money amount={before} currency={currency} />
          </dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-[0.75rem] text-muted-foreground">After</dt>
          <dd className={emphasis ? "text-[1.0625rem] font-semibold" : "text-sm"}>
            <Money amount={after} currency={currency} />
          </dd>
        </div>
        {/* The change column appears only when the backend supplied the change amount. */}
        {change ? (
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-[0.75rem] text-muted-foreground">Change</dt>
            <dd className={emphasis ? "text-[0.9375rem]" : "text-sm"}>
              <SignedMoney amount={change} currency={currency} /> <SignedPercent value={percentage ?? null} />
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
