import Link from "next/link";
import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";

import { CompensationStateLabel, Money } from "@/components/directory/money";
import type { components } from "@/generated/api";
import type { AssistantCard } from "@/lib/assistant";
import { CHANGE_REASON_LABELS, LEVEL_LABELS, STATUS_LABELS, formatCount, formatDate, formatDateTime } from "@/lib/format";
import { countryName } from "@/lib/hr-scope";

// Structured results from the assistant's tools. Every value is rendered as text by React (no
// HTML from the response is ever inserted), money keeps its native currency, and USD figures
// appear only as labelled context with their rate.

type Schemas = components["schemas"];
type Rate = Schemas["ExchangeRateContext"];

function CardFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface" aria-label={title}>
      <h3 className="border-b border-line px-4 py-2.5 text-[0.875rem] font-semibold">{title}</h3>
      <div className="px-4 py-3">{children}</div>
      {footer ? <div className="border-t border-line px-4 py-2.5 text-[0.75rem] text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

function RateLine({ rate }: { rate: Rate | null }) {
  if (!rate) return <>No saved exchange rate: INR figures have no USD equivalent.</>;
  return (
    <>
      USD figures use 1&nbsp;USD = {rate.rate}&nbsp;INR, effective {formatDate(rate.effectiveDate)}, from{" "}
      <a href={rate.sourceUrl} rel="noreferrer" target="_blank" className="text-primary underline underline-offset-4">
        {rate.sourceName}
      </a>
      . Native amounts are authoritative.
    </>
  );
}

function EmployeeListCardView({ card }: { card: Schemas["EmployeeListCard"] }) {
  return (
    <CardFrame title={card.title} footer={card.exchangeRate ? <RateLine rate={card.exchangeRate} /> : undefined}>
      {card.employees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No employees in your access matched.</p>
      ) : (
        <ul className="divide-y divide-line">
          {card.employees.map((employee) => (
            <li key={employee.employeeCode} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link href={`/employees/${encodeURIComponent(employee.employeeCode)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                  {employee.name}
                </Link>
                <span className="text-[0.8125rem] tabular-nums text-muted-foreground" translate="no">
                  {employee.employeeCode}
                </span>
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                {employee.jobTitle}, {employee.department}. {LEVEL_LABELS[employee.level]}, {countryName(employee.country)}. {STATUS_LABELS[employee.employmentStatus]}.
              </p>
              {employee.compensation ? (
                <dl className="mt-1.5 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[0.8125rem] sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Annual base salary</dt>
                    <dd className="font-medium">
                      <Money {...employee.compensation.annualBaseSalary} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Annual cash compensation</dt>
                    <dd className="font-medium">
                      <Money {...employee.compensation.annualCashCompensation} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">USD equivalent (cash)</dt>
                    <dd>
                      {employee.compensation.usdEquivalent ? (
                        <Money amount={employee.compensation.usdEquivalent.annualCashCompensation} currency="USD" />
                      ) : (
                        <span className="text-muted-foreground">No rate</span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-[0.8125rem] text-muted-foreground">No compensation record</p>
              )}
              {employee.compensation ? (
                <CompensationStateLabel
                  className="mt-1 block"
                  compensation={employee.compensation}
                  employeeLeft={employee.employmentStatus === "LEFT"}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}

const GROUP_LABELS: Record<Schemas["CompensationSummaryCard"]["groupBy"], string> = {
  DEPARTMENT: "Department",
  COUNTRY: "Country",
  CURRENCY: "Currency",
};

function SummaryCardView({ card }: { card: Schemas["CompensationSummaryCard"] }) {
  const metric = card.metric === "ANNUAL_CASH" ? "annual cash compensation" : "annual base salary";
  return (
    <CardFrame
      title={card.title}
      footer={
        <>
          Currently working employees only, {metric}. One row per group and native currency; currencies are never added together. USD
          figures are context, not totals. <RateLine rate={card.exchangeRate} />
        </>
      }
    >
      {card.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups in your access.</p>
      ) : (
        <>
        {/* Phones: one block per group, so no column is hidden behind a sideways scroll. */}
        <ul className="divide-y divide-line text-[0.8125rem] sm:hidden">
          {card.groups.map((group) => (
            <li key={`${group.group}-${group.currency}`} className="py-2.5 first:pt-0 last:pb-0">
              <p className="flex justify-between gap-3 font-medium">
                <span>
                  {group.group} <span className="text-muted-foreground">({group.currency})</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{formatCount(group.employeeCount)} employees</span>
              </p>
              <dl className="mt-1 grid grid-cols-1 gap-0.5">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Total</dt><dd><Money {...group.total} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Average</dt><dd><Money {...group.average} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Lowest</dt><dd><Money {...group.minimum} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Highest</dt><dd><Money {...group.maximum} /></dd></div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">USD average</dt>
                  <dd className="text-muted-foreground">{group.usdEquivalent ? <Money amount={group.usdEquivalent.average} currency="USD" /> : "No rate"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div tabIndex={0} role="region" aria-label={`${card.title} table`} className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[40rem] text-[0.8125rem]">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-3 font-medium">{GROUP_LABELS[card.groupBy]}</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Employees</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Total</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Average</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Range</th>
                <th scope="col" className="py-1.5 text-right font-medium">USD average</th>
              </tr>
            </thead>
            <tbody>
              {card.groups.map((group) => (
                <tr key={`${group.group}-${group.currency}`} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-medium">
                    {group.group} <span className="text-muted-foreground">({group.currency})</span>
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatCount(group.employeeCount)}</td>
                  <td className="py-2 pr-3 text-right"><Money {...group.total} /></td>
                  <td className="py-2 pr-3 text-right"><Money {...group.average} /></td>
                  <td className="py-2 pr-3 text-right">
                    <Money {...group.minimum} className="block" />
                    <Money {...group.maximum} className="block text-muted-foreground" />
                  </td>
                  <td className="py-2 text-right text-muted-foreground">
                    {group.usdEquivalent ? <Money amount={group.usdEquivalent.average} currency="USD" /> : "No rate"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </CardFrame>
  );
}

function RecentChangesCardView({ card }: { card: Schemas["RecentChangesCard"] }) {
  return (
    <CardFrame
      title={card.title}
      footer={`${formatCount(card.totalMatching)} ${card.totalMatching === 1 ? "change" : "changes"} recorded in the last ${card.days} days, including any that take effect later. The initial import is not counted as a change.`}
    >
      {card.changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No compensation changes were recorded in this period. The initial import is not counted.</p>
      ) : (
        <ul className="divide-y divide-line">
          {card.changes.map((change) => (
            <li key={`${change.employeeCode}-${change.version}`} className="py-2.5 text-[0.8125rem] first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link href={`/employees/${encodeURIComponent(change.employeeCode)}`} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  {change.name}
                </Link>
                <span className="text-muted-foreground">
                  {CHANGE_REASON_LABELS[change.changeReason]}, version {change.version}
                </span>
              </div>
              {/* "Recent" means recently recorded; the effective date can be later (a future raise). */}
              <p className="mt-0.5 text-muted-foreground">
                Recorded{" "}
                <time dateTime={change.recordedAt} className="whitespace-nowrap">
                  {formatDateTime(change.recordedAt)}
                </time>
                . Effective{" "}
                <time dateTime={change.effectiveFrom} className="whitespace-nowrap">
                  {formatDate(change.effectiveFrom)}
                </time>
                .
              </p>
              <p className="mt-1">
                Annual base salary{" "}
                {change.previous ? (
                  <>
                    <Money {...change.previous.annualBaseSalary} className="text-muted-foreground" /> to{" "}
                  </>
                ) : null}
                <Money {...change.annualBaseSalary} className="font-medium" />
                {change.annualBaseSalaryChange ? (
                  <span className="text-muted-foreground">
                    {" "}
                    (change <Money {...change.annualBaseSalaryChange} />)
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}

function NoticeCardView({ card }: { card: Schemas["NoticeCard"] }) {
  const Icon = card.level === "warning" ? CircleAlert : Info;
  return (
    <p
      className={
        card.level === "warning"
          ? "flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3 py-2.5 text-sm"
          : "flex items-start gap-2 rounded-md border border-[#c3d0ec] bg-accent px-3 py-2.5 text-sm"
      }
    >
      <Icon aria-hidden="true" className={card.level === "warning" ? "mt-0.5 size-4 shrink-0 text-state-upcoming" : "mt-0.5 size-4 shrink-0 text-primary"} />
      <span className="whitespace-pre-wrap">{card.message}</span>
    </p>
  );
}

export function AssistantCardView({ card }: { card: AssistantCard }) {
  switch (card.type) {
    case "employee_list":
      return <EmployeeListCardView card={card} />;
    case "compensation_summary":
      return <SummaryCardView card={card} />;
    case "recent_changes":
      return <RecentChangesCardView card={card} />;
    case "notice":
      return <NoticeCardView card={card} />;
    default:
      return null;
  }
}
