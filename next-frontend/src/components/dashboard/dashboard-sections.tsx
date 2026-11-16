import type { ReactNode } from "react";
import { ArrowRight, CircleAlert, Info, ShieldCheck } from "lucide-react";

import { Money } from "@/components/directory/money";
import { SignedMoney } from "@/components/salary/salary-ui";
import type { components } from "@/generated/api";
import {
  BREAKDOWN_LABELS,
  COUNTRIES,
  CURRENCIES,
  DEPARTMENTS,
  LEVELS,
  STATUSES,
  barPercent,
  dashboardHref,
  directoryLinkFor,
  employeeLinkFor,
  isOneOf,
  requestListLinkFor,
  withDashboardChanges,
  type BreakdownKey,
  type DashboardQuery,
} from "@/lib/dashboard-url";
import { FILTER_LABELS } from "@/lib/directory-choices";
import type { DirectoryQuery, FilterKey } from "@/lib/directory-url";
import { CHANGE_REASON_LABELS, LEVEL_LABELS, STATUS_LABELS, formatCount, formatDate, formatDateTime, type Currency } from "@/lib/format";
import { countryName, scopeSummary } from "@/lib/hr-scope";
import { cn } from "@/lib/utils";

import { DashboardLink } from "@/app/dashboard/dashboard-link";
import { FocusHeading } from "@/app/dashboard/focus-heading";
import { UsdDisclosure } from "@/app/dashboard/usd-disclosure";

// Dashboard sections. Every figure is a backend value rendered as text: money is the backend's
// exact decimal string with its currency code, counts are the backend's counts, and nothing here
// adds, averages, or converts compensation. The only arithmetic is the width of decorative bars.

type Schemas = components["schemas"];
export type DashboardSummary = Schemas["DashboardSummaryResponse"];
export type DashboardFigures = NonNullable<DashboardSummary["figures"]>;
export type DashboardBreakdown = Schemas["DashboardBreakdownResponse"];
export type DashboardRecentChanges = Schemas["DashboardRecentChangesResponse"];
export type DashboardWithoutAdjustment = Schemas["DashboardWithoutAdjustmentResponse"];
type FilterNote = Schemas["DashboardFilterNote"];
type UsdComparison = Schemas["DashboardUsdComparison"];
type Access = Schemas["DashboardAccess"];
type Group = Schemas["DashboardBreakdownGroup"];
type Compensation = { annualBaseSalary: string; annualBonus: string; annualCashCompensation: string };

const NOTE_FILTER_LABELS: Record<FilterNote["filter"], string> = {
  department: FILTER_LABELS.department,
  country: FILTER_LABELS.country,
  currency: FILTER_LABELS.currency,
  level: FILTER_LABELS.level,
  employmentStatus: FILTER_LABELS.status,
};

const linkClass = "font-medium text-primary underline-offset-4 hover:underline";
const sectionTitle = "text-[1.0625rem] font-semibold tracking-[-0.005em] outline-none";
const th = "px-2.5 py-2.5 align-bottom text-[0.75rem] font-semibold";
const td = "px-2.5 py-2.5 align-top";

function byCurrency<T extends { currency: Currency }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency));
}

/* ------------------------------------------------------------------ shared pieces */

/** Filters a section could not apply, with the backend's reason. Never silent. */
export function NotAppliedNotes({ notes }: { notes: readonly FilterNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Filters not applied to this section">
      {notes.map((note) => (
        <li key={`${note.filter}-${note.reason}`} className="flex items-start gap-1.5 text-[0.8125rem] text-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            <span className="font-medium">{NOTE_FILTER_LABELS[note.filter]} filter not applied here.</span> {note.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A section whose request failed: no figures, a plain reason, and a retry link. */
export function SectionFailure({ title, retryHref, kind }: { title: string; retryHref: string; kind: string }) {
  const unexpected = kind === "INVALID_RESPONSE";
  return (
    <div role="alert" className="flex max-w-2xl items-start gap-2.5 rounded-md border border-[#e3b3ae] bg-[#fcf1f0] px-3.5 py-3 text-sm text-[#7d1a14]">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold">{title} could not be loaded.</p>
        <p>
          {unexpected
            ? "The response was not in the expected format, so nothing is shown rather than something that may be wrong."
            : "The service did not respond. No figures are shown for this section; the rest of the dashboard is unaffected."}
        </p>
        <p>
          <a href={retryHref} className="font-medium underline underline-offset-4">
            Try again
          </a>
        </p>
      </div>
    </div>
  );
}

/** Rate context for USD comparison: rate, direction, source, effective date, disclaimer. */
export function RateContext({ usd }: { usd: UsdComparison }) {
  const rate = usd.exchangeRate;
  if (!rate) return null;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Comparison currency</dt>
        <dd>{rate.baseCurrency} (US dollar)</dd>
        <dt className="text-muted-foreground">Rate</dt>
        <dd className="tabular-nums">
          1&nbsp;{rate.baseCurrency} = {rate.rate}&nbsp;{rate.quoteCurrency}
        </dd>
        <dt className="text-muted-foreground">Direction</dt>
        <dd>
          {rate.quoteCurrency} per one US dollar; an {rate.quoteCurrency} amount is divided by the rate.
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>
          <a href={rate.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
            {rate.sourceName}
          </a>
        </dd>
        <dt className="text-muted-foreground">Effective date</dt>
        <dd>{formatDate(rate.effectiveDate)}</dd>
      </dl>
      <p>{usd.disclaimer}</p>
    </div>
  );
}

/** The USD controls beside a section: the disclosure and the show/hide link, or why USD is off. */
export function UsdControls({ usd, query }: { usd: UsdComparison; query: DashboardQuery }) {
  if (!usd.available) {
    return (
      <p className="flex items-start gap-1.5 text-[0.8125rem] text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>{usd.unavailableReason ?? "USD comparison is unavailable. Native totals are unaffected."}</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <DashboardLink href={dashboardHref(withDashboardChanges(query, { usd: !query.usd }))} className={cn(linkClass, "text-[0.8125rem]")}>
          {query.usd ? "Hide USD comparison" : "Show USD comparison"}
        </DashboardLink>
      </div>
      <UsdDisclosure>
        <RateContext usd={usd} />
      </UsdDisclosure>
    </div>
  );
}

function MoneyOrDash({ amount, currency, className }: { amount: string | null; currency: Currency; className?: string }) {
  if (amount === null) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not applicable</span>
      </span>
    );
  }
  return <Money amount={amount} currency={currency} className={className} />;
}

function CompensationChange({ label, before, after, currency }: { label: string; before: string | null; after: string; currency: Currency }) {
  return (
    <span className="block whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>{" "}
      {before === null ? <span className="text-muted-foreground">none</span> : <Money amount={before} currency={currency} />}{" "}
      <span aria-hidden="true">→</span>
      <span className="sr-only">to</span>{" "}
      <Money amount={after} currency={currency} className="font-medium" />
    </span>
  );
}

function ChangePair({ previous, next, currency }: { previous: Compensation | null; next: Compensation; currency: Currency }) {
  return (
    <>
      <CompensationChange label="Base" before={previous?.annualBaseSalary ?? null} after={next.annualBaseSalary} currency={currency} />
      <CompensationChange label="Cash" before={previous?.annualCashCompensation ?? null} after={next.annualCashCompensation} currency={currency} />
    </>
  );
}

/* ------------------------------------------------------------------ page states */

export function NoAccessState() {
  return (
    <div role="status" className="flex max-w-2xl items-start gap-2.5 rounded-md border border-[#c3d0ec] bg-accent px-3.5 py-3 text-sm">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">Your HR account has no employee access.</p>
        <p>Ask an Admin HR user to assign the countries and departments you work with.</p>
      </div>
    </div>
  );
}

export function NoDataState({ query }: { query: DashboardQuery }) {
  return (
    <div role="status" className="flex max-w-2xl flex-col gap-2 rounded-md border border-line bg-surface px-4 py-4 text-sm">
      <p className="font-semibold">No compensation data matches these filters.</p>
      <p>
        <DashboardLink href={dashboardHref(withDashboardChanges(query, { department: undefined, country: undefined, currency: undefined, level: undefined, status: undefined }))} className={linkClass}>
          Clear filters
        </DashboardLink>
      </p>
    </div>
  );
}

export function InvalidLinkState() {
  return (
    <div role="status" className="flex max-w-2xl flex-col gap-2 rounded-md border border-[#c3d0ec] bg-accent px-4 py-4 text-sm">
      <p className="font-semibold">Some filters in this link are not valid</p>
      <p>The address contains values the dashboard does not accept, so no figures were requested or shown.</p>
      <p>
        <a href="/dashboard" className={linkClass}>
          Reset filters
        </a>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ first viewport */

/** Scope and as-of date, as one ruled record (the access-record form from DESIGN.md). */
export function ScopeLine({ access, asOf }: { access: Access; asOf: string }) {
  const scoped = access.scope.kind === "SCOPED";
  const scope = scopeSummary(scoped ? "SCOPED" : "ADMIN", access.scope.countries, access.scope.departments);
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-2 border-y border-line py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-wrap gap-x-2">
        <dt className="text-muted-foreground">Scope</dt>
        <dd className="font-medium">
          {scope}
          {scoped ? <span className="font-normal text-muted-foreground"> (permission filtered)</span> : null}
        </dd>
      </div>
      <div className="flex flex-wrap gap-x-2">
        <dt className="text-muted-foreground">As of</dt>
        <dd className="font-medium">
          {formatDate(asOf)} <span className="font-normal text-muted-foreground">(UTC business date)</span>
        </dd>
      </div>
    </dl>
  );
}

/** People line: currently working is the primary headcount; soon to join and left follow. */
export function HeadcountLine({ headcount, query }: { headcount: DashboardFigures["headcount"]; query: DashboardQuery }) {
  const items = [
    { status: "CURRENTLY_WORKING" as const, count: headcount.currentlyWorking, primary: true },
    { status: "SOON_TO_JOIN" as const, count: headcount.soonToJoin, primary: false },
    { status: "LEFT" as const, count: headcount.left, primary: false },
  ];
  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-2">
      <h2 id="people-heading" className="sr-only">
        People
      </h2>
      <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
        {items.map((item) => (
          <div key={item.status} className="flex flex-col">
            <dt className={cn("text-[0.8125rem]", item.primary ? "font-medium text-foreground" : "text-muted-foreground")}>{STATUS_LABELS[item.status]}</dt>
            <dd>
              <a
                href={directoryLinkFor(query, { status: item.status })}
                className={cn(
                  "tabular-nums underline-offset-4 hover:underline",
                  item.primary ? "text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]" : "text-[1.0625rem] font-medium",
                )}
              >
                {formatCount(item.count)}{" "}
                <span className="sr-only">{STATUS_LABELS[item.status].toLowerCase()} employees, open in Employees</span>
              </a>
            </dd>
          </div>
        ))}
      </dl>
      <NotAppliedNotes notes={headcount.notApplied} />
    </section>
  );
}

type LedgerRow = {
  currency: Currency;
  spending: DashboardFigures["currentSpending"]["byCurrency"][number] | undefined;
  upcoming: DashboardFigures["upcomingCommitment"]["byCurrency"][number] | undefined;
};

function ledgerRows(figures: DashboardFigures): LedgerRow[] {
  return CURRENCIES.flatMap((currency) => {
    const spending = figures.currentSpending.byCurrency.find((row) => row.currency === currency);
    const upcoming = figures.upcomingCommitment.byCurrency.find((row) => row.currency === currency);
    return spending || upcoming ? [{ currency, spending, upcoming }] : [];
  });
}

function UpcomingDetail({ row }: { row: NonNullable<LedgerRow["upcoming"]> }) {
  return (
    <span className="mt-0.5 block text-[0.75rem] text-muted-foreground" data-ledger={`${row.currency}:upcoming-detail`}>
      {formatCount(row.soonToJoinCount)} soon to join: <Money amount={row.soonToJoinAnnualCashCompensation} currency={row.currency} />
      <br />
      {formatCount(row.approvedFutureChangeCount)} approved {row.approvedFutureChangeCount === 1 ? "change" : "changes"}:{" "}
      <SignedMoney amount={row.approvedFutureChangeAnnualCashImpact} currency={row.currency} />
    </span>
  );
}

/**
 * The commitment ledger: one row per native currency, no total row. Currency separation is
 * structural, so INR and USD can never be read as one figure.
 */
export function CommitmentLedger({ figures, query }: { figures: DashboardFigures; query: DashboardQuery }) {
  const rows = ledgerRows(figures);
  const usd = figures.usdComparison;
  const showUsd = Boolean(query.usd) && usd.available;
  const workingLink = (currency: Currency) => directoryLinkFor(query, { currency, status: "CURRENTLY_WORKING" });
  return (
    <section aria-labelledby="commitment-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="commitment-heading" className={sectionTitle}>
          Compensation by currency
        </h2>
        <p className="text-[0.8125rem] text-muted-foreground">Current spending covers currently working employees only. Currencies are never added together.</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No currently working or upcoming compensation in this view.</p>
      ) : (
        <>
          {/* Desktop and tablet: one table row per currency. */}
          <div className="hidden overflow-x-auto rounded-md border border-line bg-surface md:block" role="region" aria-label="Compensation by currency table" tabIndex={0}>
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Annual compensation by native currency. There is no total across currencies.</caption>
              <thead className="border-b border-line bg-[#f3f1ec] text-left">
                <tr>
                  <th scope="col" className={th}>Currency</th>
                  <th scope="col" className={cn(th, "text-right")}>Currently working</th>
                  <th scope="col" className={cn(th, "text-right")}>Annual base salary</th>
                  <th scope="col" className={cn(th, "text-right")}>Annual cash compensation</th>
                  <th scope="col" className={cn(th, "text-right")}>Upcoming approved commitment</th>
                  {showUsd ? (
                    <th scope="col" className={cn(th, "text-right text-muted-foreground")}>
                      USD equivalent, cash (comparison only)
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ currency, spending, upcoming }) => (
                  <tr key={currency} className="border-b border-line last:border-b-0">
                    <th scope="row" className={cn(td, "text-left font-semibold")} translate="no">
                      {currency}
                    </th>
                    <td className={cn(td, "text-right tabular-nums")}>
                      <a href={workingLink(currency)} className={linkClass}>
                        {formatCount(spending?.employeeCount ?? 0)}{" "}
                        <span className="sr-only">currently working employees paid in {currency}, open in Employees</span>
                      </a>
                    </td>
                    <td className={cn(td, "text-right")}>
                      <MoneyOrDash amount={spending?.annualBaseSalary ?? null} currency={currency} className="font-medium" />
                    </td>
                    <td className={cn(td, "text-right")}>
                      <span data-ledger={`${currency}:cash`}>
                        <MoneyOrDash amount={spending?.annualCashCompensation ?? null} currency={currency} className="font-medium" />
                      </span>
                    </td>
                    <td className={cn(td, "text-right")}>
                      <span data-ledger={`${currency}:upcoming`}>
                        <MoneyOrDash amount={upcoming?.totalAnnualCashCommitment ?? null} currency={currency} className="font-medium" />
                      </span>
                      {upcoming ? <UpcomingDetail row={upcoming} /> : null}
                    </td>
                    {showUsd ? (
                      <td className={cn(td, "text-right text-muted-foreground")}>
                        <MoneyOrDash amount={spending?.usdEquivalent?.annualCashCompensation ?? null} currency="USD" />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one ruled block per currency. */}
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface md:hidden" aria-label="Compensation by currency">
            {rows.map(({ currency, spending, upcoming }) => (
              <li key={currency} className="px-4 py-3">
                <p className="text-sm font-semibold" translate="no">
                  {currency}
                </p>
                <dl className="mt-1.5 grid grid-cols-1 gap-y-1.5 text-sm">
                  <LedgerFact label="Currently working">
                    <a href={workingLink(currency)} className={linkClass}>
                      {formatCount(spending?.employeeCount ?? 0)}
                    </a>
                  </LedgerFact>
                  <LedgerFact label="Annual base salary">
                    <MoneyOrDash amount={spending?.annualBaseSalary ?? null} currency={currency} className="font-medium" />
                  </LedgerFact>
                  <LedgerFact label="Annual cash compensation">
                    <span data-ledger={`${currency}:cash`}>
                      <MoneyOrDash amount={spending?.annualCashCompensation ?? null} currency={currency} className="font-medium" />
                    </span>
                  </LedgerFact>
                  <LedgerFact label="Upcoming approved commitment">
                    <span data-ledger={`${currency}:upcoming`}>
                      <MoneyOrDash amount={upcoming?.totalAnnualCashCommitment ?? null} currency={currency} className="font-medium" />
                    </span>
                    {upcoming ? <UpcomingDetail row={upcoming} /> : null}
                  </LedgerFact>
                  {showUsd ? (
                    <LedgerFact label="USD equivalent, cash (comparison only)">
                      <span className="text-muted-foreground">
                        <MoneyOrDash amount={spending?.usdEquivalent?.annualCashCompensation ?? null} currency="USD" />
                      </span>
                    </LedgerFact>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      {showUsd && usd.currentSpending ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          USD comparison of current spending (sum of each currency&rsquo;s USD equivalent, informational only): base{" "}
          <Money amount={usd.currentSpending.annualBaseSalary} currency="USD" />, cash <Money amount={usd.currentSpending.annualCashCompensation} currency="USD" />.
        </p>
      ) : null}
      <p className="text-[0.8125rem] text-muted-foreground">
        <span className="font-medium text-foreground">Upcoming approved commitment:</span> {figures.upcomingCommitment.definition}
      </p>
      <NotAppliedNotes notes={[...figures.currentSpending.notApplied, ...figures.upcomingCommitment.notApplied]} />
      <UsdControls usd={usd} query={query} />
    </section>
  );
}

function LedgerFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** Needs attention: counts that lead to the page where the work happens. */
export function AttentionList({ figures, query, isAdmin }: { figures: DashboardFigures; query: DashboardQuery; isAdmin: boolean }) {
  const pending = requestListLinkFor(query, "PENDING", isAdmin);
  const stale = requestListLinkFor(query, "STALE", isAdmin);
  const items: { label: string; count: number; href: string; action: string; internal: boolean }[] = [
    { label: "Pending salary requests", count: figures.requests.pending, href: pending.href, action: isAdmin ? "Review queue" : "View requests", internal: false },
    { label: "Requests out of date", count: figures.requests.stale, href: stale.href, action: "View requests", internal: false },
    {
      label: `Salary changes recorded in the last ${figures.recentChanges.periodDays} days`,
      count: figures.recentChanges.count,
      href: "#recent-changes",
      action: "View below",
      internal: true,
    },
    { label: "Upcoming approved changes", count: figures.upcomingCommitment.upcomingChanges.total, href: "#upcoming-changes", action: "View below", internal: true },
    {
      label: `No recorded adjustment in ${figures.withoutRecentAdjustment.months} months`,
      count: figures.withoutRecentAdjustment.count,
      href: "#without-adjustment",
      action: "View below",
      internal: true,
    },
  ];
  return (
    <section aria-labelledby="attention-heading" className="flex flex-col gap-2">
      <h2 id="attention-heading" className={sectionTitle}>
        Needs attention
      </h2>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {items.map((item) => (
          <li key={item.label}>
            <a href={item.href} className="group flex items-baseline gap-3 py-2.5 text-sm hover:bg-[#faf9f6]">
              <span className="min-w-0 flex-1">{item.label}</span>
              <span className={cn("tabular-nums", item.count === 0 ? "text-muted-foreground" : "text-[0.9375rem] font-semibold")}>{formatCount(item.count)}</span>
              <span className="inline-flex w-28 shrink-0 items-center justify-end gap-1 text-[0.8125rem] font-medium text-primary group-hover:underline">
                {item.action}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </span>
            </a>
          </li>
        ))}
      </ul>
      {pending.note ? <p className="text-[0.8125rem] text-muted-foreground">Request links: {pending.note}</p> : null}
      <NotAppliedNotes notes={[...figures.requests.notApplied, ...figures.recentChanges.notApplied, ...figures.withoutRecentAdjustment.notApplied]} />
      <p className="text-[0.8125rem] text-muted-foreground">The dashboard does not approve, cancel, or apply changes; each link opens the workflow where that happens.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ breakdown */

function groupFilter(breakdown: BreakdownKey, group: Group): Partial<Pick<DirectoryQuery, FilterKey>> {
  // A group's directory link matches the employees the group counts.
  const status = group.basis === "FUTURE_COMMITMENT" ? "SOON_TO_JOIN" : group.basis === "COUNT_ONLY" ? "LEFT" : "CURRENTLY_WORKING";
  const result: Partial<Pick<DirectoryQuery, FilterKey>> = { currency: group.currency, status };
  const value = group.group;
  if (breakdown === "department" && isOneOf(DEPARTMENTS, value)) result.department = value;
  if (breakdown === "country" && isOneOf(COUNTRIES, value)) result.country = value;
  if (breakdown === "level" && isOneOf(LEVELS, value)) result.level = value;
  if (breakdown === "status" && isOneOf(STATUSES, value)) result.status = value;
  return result;
}

const BASIS_LABELS: Record<Group["basis"], string> = {
  CURRENT_SPENDING: "Current spending",
  FUTURE_COMMITMENT: "Future commitment",
  COUNT_ONLY: "Count only",
};

/** Accessible CSS bars: the exact value is text; the bar is decorative and sized for that chart. */
export function BarChart({ title, rows }: { title: string; rows: { label: string; value: string | number; display: ReactNode }[] }) {
  const max = rows.reduce((current, row) => (Number(row.value) > Number(current) ? row.value : current), rows[0]?.value ?? 0);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-[0.8125rem] font-semibold">{title}</figcaption>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-1 gap-1 text-[0.8125rem] sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <span className="flex justify-between gap-3 sm:block">
              <span className="font-medium">{row.label}</span>
              <span className="whitespace-nowrap tabular-nums sm:hidden">{row.display}</span>
            </span>
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[#ece8e0]">
                <span data-bar="" className="block h-full rounded-sm bg-primary" style={{ width: `${barPercent(row.value, max)}%` }} />
              </span>
              <span className="hidden whitespace-nowrap tabular-nums sm:inline">{row.display}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function BreakdownCharts({ data, breakdown }: { data: DashboardBreakdown; breakdown: BreakdownKey }) {
  if (breakdown !== "department" && breakdown !== "status") return null;
  const currencies = CURRENCIES.filter((currency) => data.groups.some((group) => group.currency === currency));
  const charts = currencies.flatMap((currency) => {
    const groups = data.groups.filter((group) => group.currency === currency);
    if (breakdown === "department") {
      const spending = groups.filter((group) => group.basis === "CURRENT_SPENDING" && group.annualCashCompensation !== null);
      if (spending.length === 0) return [];
      return [
        <BarChart
          key={currency}
          title={`Annual cash compensation by department, ${currency}`}
          rows={spending.map((group) => ({
            label: group.label,
            value: group.annualCashCompensation ?? "0",
            display: <Money amount={group.annualCashCompensation ?? "0.00"} currency={currency} />,
          }))}
        />,
      ];
    }
    return [
      <BarChart
        key={currency}
        title={`Employees by employment status, paid in ${currency}`}
        rows={groups.map((group) => ({ label: group.label, value: group.employeeCount, display: formatCount(group.employeeCount) }))}
      />,
    ];
  });
  if (charts.length === 0) return null;
  return <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{charts}</div>;
}

const POPULATION_LABELS: Record<string, string> = {
  CURRENTLY_WORKING: "currently working employees only",
  ALL_STATUSES: "employees in every employment status. Money is current spending for currently working employees and future commitment for soon-to-join employees; left employees are counted only",
};

export function BreakdownPanel({ data, breakdown, query }: { data: DashboardBreakdown; breakdown: BreakdownKey; query: DashboardQuery }) {
  const showUsd = Boolean(query.usd) && data.usdComparison.available;
  const groups = byCurrency(data.groups);
  const currencies = CURRENCIES.filter((currency) => groups.some((group) => group.currency === currency));
  const showBasis = breakdown === "status";
  const label = BREAKDOWN_LABELS[breakdown];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-muted-foreground">
        <span className="font-medium text-foreground">Covers</span> {POPULATION_LABELS[data.population] ?? data.population}. Each currency has its own
        table; money is never combined across currencies.
      </p>
      <NotAppliedNotes notes={data.notApplied} />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No compensation data matches these filters.</p>
      ) : (
        <>
          <BreakdownCharts data={data} breakdown={breakdown} />
          {currencies.map((currency) => (
            <div
              key={currency}
              className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block"
              role="region"
              aria-label={`${label} breakdown, ${currency}`}
              tabIndex={0}
            >
              <table className="w-full border-collapse text-[0.8125rem]">
                <caption className="border-b border-line px-2.5 py-2 text-left text-[0.8125rem] font-semibold">
                  {label} breakdown, <span translate="no">{currency}</span>
                  <span className="sr-only">. One row per group. Average, median, and range are of annual cash compensation.</span>
                </caption>
                <thead className="border-b border-line bg-[#f3f1ec] text-left">
                  <tr>
                    <th scope="col" className={th}>{label}</th>
                    {showBasis ? <th scope="col" className={th}>Basis</th> : null}
                    <th scope="col" className={cn(th, "text-right")}>Employees</th>
                    <th scope="col" className={cn(th, "text-right")}>Annual base salary</th>
                    <th scope="col" className={cn(th, "text-right")}>Annual cash compensation</th>
                    <th scope="col" className={cn(th, "text-right")}>Average cash</th>
                    <th scope="col" className={cn(th, "text-right")}>Median cash</th>
                    <th scope="col" className={cn(th, "text-right")}>Cash range (minimum to maximum)</th>
                    {showUsd ? <th scope="col" className={cn(th, "text-right text-muted-foreground")}>USD equivalent, cash</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {groups
                    .filter((group) => group.currency === currency)
                    .map((group) => (
                      <tr key={`${group.group}-${group.basis}`} className="border-b border-line last:border-b-0 hover:bg-[#faf9f6]">
                        <th scope="row" className={cn(td, "text-left font-medium")}>
                          <a href={directoryLinkFor(query, groupFilter(breakdown, group))} className={linkClass}>
                            {group.label}
                          </a>
                        </th>
                        {showBasis ? <td className={td}>{BASIS_LABELS[group.basis]}</td> : null}
                        <td className={cn(td, "text-right tabular-nums")}>{formatCount(group.employeeCount)}</td>
                        <td className={cn(td, "text-right")}><MoneyOrDash amount={group.annualBaseSalary} currency={group.currency} /></td>
                        <td className={cn(td, "text-right")}><MoneyOrDash amount={group.annualCashCompensation} currency={group.currency} className="font-medium" /></td>
                        <td className={cn(td, "text-right")}><MoneyOrDash amount={group.averageAnnualCashCompensation} currency={group.currency} /></td>
                        <td className={cn(td, "text-right")}><MoneyOrDash amount={group.medianAnnualCashCompensation} currency={group.currency} /></td>
                        <td className={cn(td, "text-right")}>
                          {group.minimumAnnualCashCompensation === null || group.maximumAnnualCashCompensation === null ? (
                            <MoneyOrDash amount={null} currency={group.currency} />
                          ) : (
                            <>
                              <Money amount={group.minimumAnnualCashCompensation} currency={group.currency} className="block" />{" "}
                              <span className="sr-only">to</span>{" "}
                              <Money amount={group.maximumAnnualCashCompensation} currency={group.currency} className="block" />
                            </>
                          )}
                        </td>
                        {showUsd ? (
                          <td className={cn(td, "text-right text-muted-foreground")}>
                            <MoneyOrDash amount={group.usdEquivalent?.annualCashCompensation ?? null} currency="USD" />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label={`${label} breakdown`}>
            {groups.map((group) => (
              <li key={`${group.group}-${group.currency}-${group.basis}`} className="px-4 py-3 text-[0.8125rem]">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <a href={directoryLinkFor(query, groupFilter(breakdown, group))} className={cn(linkClass, "text-sm")}>
                    {group.label}
                  </a>
                  <span className="text-muted-foreground">
                    <span translate="no">{group.currency}</span>
                    {showBasis ? `, ${BASIS_LABELS[group.basis].toLowerCase()}` : ""}, {formatCount(group.employeeCount)}{" "}
                    {group.employeeCount === 1 ? "employee" : "employees"}
                  </span>
                </p>
                {group.basis === "COUNT_ONLY" ? (
                  <p className="mt-1 text-muted-foreground">Count only: left employees add no spending.</p>
                ) : (
                  <dl className="mt-1.5 grid grid-cols-1 gap-y-1">
                    <LedgerFact label="Annual base salary"><MoneyOrDash amount={group.annualBaseSalary} currency={group.currency} /></LedgerFact>
                    <LedgerFact label="Annual cash compensation"><MoneyOrDash amount={group.annualCashCompensation} currency={group.currency} className="font-medium" /></LedgerFact>
                    <LedgerFact label="Average cash"><MoneyOrDash amount={group.averageAnnualCashCompensation} currency={group.currency} /></LedgerFact>
                    <LedgerFact label="Median cash"><MoneyOrDash amount={group.medianAnnualCashCompensation} currency={group.currency} /></LedgerFact>
                    <LedgerFact label="Minimum cash"><MoneyOrDash amount={group.minimumAnnualCashCompensation} currency={group.currency} /></LedgerFact>
                    <LedgerFact label="Maximum cash"><MoneyOrDash amount={group.maximumAnnualCashCompensation} currency={group.currency} /></LedgerFact>
                    {showUsd ? (
                      <LedgerFact label="USD equivalent, cash">
                        <span className="text-muted-foreground"><MoneyOrDash amount={group.usdEquivalent?.annualCashCompensation ?? null} currency="USD" /></span>
                      </LedgerFact>
                    ) : null}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <UsdControls usd={data.usdComparison} query={query} />
    </div>
  );
}

/* ------------------------------------------------------------------ activity */

function EmployeeCell({ employee, query }: { employee: { employeeCode: string; name: string; department: string; country: string }; query: DashboardQuery }) {
  return (
    <>
      <a href={employeeLinkFor(employee.employeeCode, query)} className={linkClass}>
        {employee.name}
      </a>
      <span className="block text-muted-foreground">
        <span translate="no">{employee.employeeCode}</span>, {employee.department}, {countryName(employee.country)}
      </span>
    </>
  );
}

function RequestLink({ requestId }: { requestId: string | null }) {
  if (!requestId) return <span className="text-muted-foreground">Direct change</span>;
  return (
    <a href={`/salary-requests/${requestId}`} className={linkClass}>
      View request
    </a>
  );
}

function UpcomingTag() {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-state-upcoming" />
      Upcoming
    </span>
  );
}

export function RecentChangesList({ data, query }: { data: DashboardRecentChanges; query: DashboardQuery }) {
  if (data.changes.length === 0) return <p className="text-sm text-muted-foreground">{data.emptyMessage}</p>;
  const shown = data.changes.length;
  const total = data.page.totalRows;
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block" role="region" aria-label="Recorded salary changes table" tabIndex={0}>
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">Salary changes recorded in the last {data.periodDays} days, newest recorded first</caption>
          <thead className="border-b border-line bg-[#f3f1ec] text-left">
            <tr>
              <th scope="col" className={th}>Employee</th>
              <th scope="col" className={th}>Previous → new</th>
              <th scope="col" className={th}>Reason</th>
              <th scope="col" className={th}>Recorded</th>
              <th scope="col" className={th}>Effective</th>
              <th scope="col" className={th}>Recorded by</th>
              <th scope="col" className={th}>Request</th>
            </tr>
          </thead>
          <tbody>
            {data.changes.map((change) => (
              <tr key={`${change.employee.employeeCode}-${change.recordedAt}`} className="border-b border-line last:border-b-0">
                <th scope="row" className={cn(td, "text-left font-medium")}>
                  <EmployeeCell employee={change.employee} query={query} />
                </th>
                <td className={td}>
                  <ChangePair previous={change.previous} next={change.new} currency={change.currency} />
                </td>
                <td className={td}>{CHANGE_REASON_LABELS[change.changeReason]}</td>
                <td className={cn(td, "whitespace-nowrap")}>{formatDateTime(change.recordedAt)}</td>
                <td className={cn(td, "whitespace-nowrap")}>
                  {formatDate(change.effectiveFrom)}
                  {change.effectiveInFuture ? <UpcomingTag /> : null}
                </td>
                <td className={td}>{change.changedBy?.displayName ?? <span className="text-muted-foreground">Not recorded</span>}</td>
                <td className={td}>
                  <RequestLink requestId={change.requestId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label="Recorded salary changes">
        {data.changes.map((change) => (
          <li key={`${change.employee.employeeCode}-${change.recordedAt}`} className="flex flex-col gap-1 px-4 py-3 text-[0.8125rem]">
            <div>
              <EmployeeCell employee={change.employee} query={query} />
            </div>
            <ChangePair previous={change.previous} next={change.new} currency={change.currency} />
            <p>
              {CHANGE_REASON_LABELS[change.changeReason]}. Recorded {formatDateTime(change.recordedAt)} by {change.changedBy?.displayName ?? "an unrecorded user"}.
            </p>
            <p>
              Effective {formatDate(change.effectiveFrom)}
              {change.effectiveInFuture ? <UpcomingTag /> : null}. <RequestLink requestId={change.requestId} />
            </p>
          </li>
        ))}
      </ul>
      {total > shown ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          Showing the {formatCount(shown)} most recently recorded of {formatCount(total)} changes. Each employee&rsquo;s full history is on their record.
        </p>
      ) : null}
    </div>
  );
}

export function UpcomingChangesList({ upcoming, query }: { upcoming: DashboardFigures["upcomingCommitment"]["upcomingChanges"]; query: DashboardQuery }) {
  if (upcoming.items.length === 0) return <p className="text-sm text-muted-foreground">No approved future changes.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block" role="region" aria-label="Upcoming approved changes table" tabIndex={0}>
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">Approved changes with a future effective date, soonest first</caption>
          <thead className="border-b border-line bg-[#f3f1ec] text-left">
            <tr>
              <th scope="col" className={th}>Employee</th>
              <th scope="col" className={th}>Effective</th>
              <th scope="col" className={th}>Before → scheduled</th>
              <th scope="col" className={th}>Reason</th>
              <th scope="col" className={th}>Approved by</th>
              <th scope="col" className={th}>Request</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.items.map((item) => (
              <tr key={`${item.employee.employeeCode}-${item.effectiveFrom}`} className="border-b border-line last:border-b-0">
                <th scope="row" className={cn(td, "text-left font-medium")}>
                  <EmployeeCell employee={item.employee} query={query} />
                  {item.employee.employmentStatus !== "CURRENTLY_WORKING" ? (
                    <span className="block text-[0.75rem] text-muted-foreground">{STATUS_LABELS[item.employee.employmentStatus]}</span>
                  ) : null}
                </th>
                <td className={cn(td, "whitespace-nowrap")}>{formatDate(item.effectiveFrom)}</td>
                <td className={td}>
                  <ChangePair previous={item.previous} next={item.scheduled} currency={item.currency} />
                </td>
                <td className={td}>{CHANGE_REASON_LABELS[item.changeReason]}</td>
                <td className={td}>{item.approvedBy?.displayName ?? <span className="text-muted-foreground">Not recorded</span>}</td>
                <td className={td}>
                  <RequestLink requestId={item.requestId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label="Upcoming approved changes">
        {upcoming.items.map((item) => (
          <li key={`${item.employee.employeeCode}-${item.effectiveFrom}`} className="flex flex-col gap-1 px-4 py-3 text-[0.8125rem]">
            <div>
              <EmployeeCell employee={item.employee} query={query} />
              {item.employee.employmentStatus !== "CURRENTLY_WORKING" ? (
                <span className="block text-[0.75rem] text-muted-foreground">{STATUS_LABELS[item.employee.employmentStatus]}</span>
              ) : null}
            </div>
            <p>Effective {formatDate(item.effectiveFrom)}</p>
            <ChangePair previous={item.previous} next={item.scheduled} currency={item.currency} />
            <p>
              {CHANGE_REASON_LABELS[item.changeReason]}. Approved by {item.approvedBy?.displayName ?? "an unrecorded user"}. <RequestLink requestId={item.requestId} />
            </p>
          </li>
        ))}
      </ul>
      {upcoming.total > upcoming.items.length ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          Showing the {formatCount(upcoming.items.length)} soonest of {formatCount(upcoming.total)} approved future changes.
        </p>
      ) : null}
    </div>
  );
}

export function WithoutAdjustmentList({ data, query }: { data: DashboardWithoutAdjustment; query: DashboardQuery }) {
  const { page } = data;
  if (data.employees.length === 0) return <p className="text-sm text-muted-foreground">No employees to list for this period and these filters.</p>;
  const pageHref = (number: number) => dashboardHref(withDashboardChanges(query, { noAdjustmentPage: number > 1 ? number : undefined }));
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block" role="region" aria-label="Employees without a recorded adjustment table" tabIndex={0}>
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">
            Currently working employees with no recorded salary adjustment since import or during the selected period, page {page.number} of {page.totalPages}
          </caption>
          <thead className="border-b border-line bg-[#f3f1ec] text-left">
            <tr>
              <th scope="col" className={th}>Employee</th>
              <th scope="col" className={th}>Level</th>
              <th scope="col" className={cn(th, "text-right")}>Annual cash compensation</th>
              <th scope="col" className={th}>Last recorded adjustment</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.map((row) => (
              <tr key={row.employee.employeeCode} className="border-b border-line last:border-b-0">
                <th scope="row" className={cn(td, "text-left font-medium")}>
                  <EmployeeCell employee={row.employee} query={query} />
                </th>
                <td className={td}>{LEVEL_LABELS[row.employee.level]}</td>
                <td className={cn(td, "text-right")}>
                  <Money amount={row.annualCashCompensation} currency={row.currency} />
                </td>
                <td className={td}>
                  {row.lastRecordedAdjustmentAt ? formatDateTime(row.lastRecordedAdjustmentAt) : <span className="text-muted-foreground">None since import</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label="Employees without a recorded adjustment">
        {data.employees.map((row) => (
          <li key={row.employee.employeeCode} className="flex flex-col gap-1 px-4 py-3 text-[0.8125rem]">
            <div>
              <EmployeeCell employee={row.employee} query={query} />
            </div>
            <p className="flex justify-between gap-3">
              <span>{LEVEL_LABELS[row.employee.level]}</span>
              <Money amount={row.annualCashCompensation} currency={row.currency} />
            </p>
            <p className="text-muted-foreground">
              Last recorded adjustment: {row.lastRecordedAdjustmentAt ? formatDateTime(row.lastRecordedAdjustmentAt) : "none since import"}
            </p>
          </li>
        ))}
      </ul>
      <nav aria-label="Employees without a recorded adjustment, pages" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          Page {formatCount(page.number)} of {formatCount(Math.max(page.totalPages, 1))}, {formatCount(page.totalRows)} {page.totalRows === 1 ? "employee" : "employees"}
        </p>
        <div className="flex gap-2">
          {page.number > 1 ? (
            <DashboardLink href={pageHref(page.number - 1)} className="inline-flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-medium hover:bg-muted">
              Previous
            </DashboardLink>
          ) : (
            <span aria-disabled="true" className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm text-muted-foreground">
              Previous
            </span>
          )}
          {page.number < page.totalPages ? (
            <DashboardLink href={pageHref(page.number + 1)} className="inline-flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-medium hover:bg-muted">
              Next
            </DashboardLink>
          ) : (
            <span aria-disabled="true" className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm text-muted-foreground">
              Next
            </span>
          )}
        </div>
      </nav>
    </div>
  );
}

/** Section frame for the activity lists: heading, description, controls, then content. */
export function ActivitySection({
  id,
  title,
  description,
  controls,
  children,
  focusKey,
}: {
  id: string;
  title: string;
  description: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  /** When set, the heading takes focus after this value changes (pagination). */
  focusKey?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex min-w-0 scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex max-w-2xl flex-col gap-1">
          {focusKey !== undefined ? (
            <FocusHeading id={`${id}-heading`} focusKey={focusKey} className={sectionTitle}>
              {title}
            </FocusHeading>
          ) : (
            <h2 id={`${id}-heading`} className={sectionTitle}>
              {title}
            </h2>
          )}
          <div className="text-[0.8125rem] text-muted-foreground">{description}</div>
        </div>
        {controls}
      </div>
      {children}
    </section>
  );
}
