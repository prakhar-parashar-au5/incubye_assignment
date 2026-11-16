import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";

import { CompensationStateLabel, Money } from "@/components/directory/money";
import type { components } from "@/generated/api";
import { FILTER_LABELS, filterValueLabel, type FilterChoices } from "@/lib/directory-choices";
import {
  FILTER_KEYS,
  PAGE_SIZE_CHOICES,
  clearFilters,
  directoryHref,
  isSalarySort,
  withChanges,
  type DirectoryQuery,
  type SortField,
} from "@/lib/directory-url";
import { countryName } from "@/lib/hr-scope";
import { LEVEL_LABELS, STATUS_LABELS, SORT_LABELS, formatCount, formatDate, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

import { PageSizeSelect } from "./page-size-select";

type Schemas = components["schemas"];
type DirectoryResponse = Schemas["DirectoryResponse"];
type Row = Schemas["DirectoryRow"];
type Rate = Schemas["ExchangeRateContext"];

function detailHref(row: Row, query: DirectoryQuery) {
  return `/employees/${encodeURIComponent(row.employeeCode)}?from=${encodeURIComponent(directoryHref(query))}`;
}

/** Which USD figure the USD column shows: the one the current salary sort compares. */
function usdMetric(query: DirectoryQuery): "annualBaseSalary" | "annualCashCompensation" {
  return query.sort === "annualCashCompensation" ? "annualCashCompensation" : "annualBaseSalary";
}

export function ActiveFilters({ query, choices }: { query: DirectoryQuery; choices: FilterChoices }) {
  const chips: { label: string; href: string }[] = [];
  if (query.q?.trim()) chips.push({ label: `Search: “${query.q.trim()}”`, href: directoryHref(withChanges(query, { q: undefined })) });
  for (const key of FILTER_KEYS) {
    const value = query[key];
    if (value) chips.push({ label: `${FILTER_LABELS[key]}: ${filterValueLabel(choices, key, value)}`, href: directoryHref(withChanges(query, { [key]: undefined })) });
  }
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {chips.map((chip) => (
        <Link
          key={chip.href}
          href={chip.href}
          scroll={false}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface pr-2 pl-3 text-[0.8125rem] font-medium hover:border-input"
        >
          <span className="max-w-[18rem] truncate">{chip.label}</span>
          <X aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">(remove filter)</span>
        </Link>
      ))}
      <Link href={directoryHref(clearFilters(query))} scroll={false} className="px-1 text-[0.8125rem] font-medium text-primary underline underline-offset-4">
        Clear all
      </Link>
    </div>
  );
}

export function RateNote({ rate, salarySort, query }: { rate: Rate | null; salarySort: boolean; query: DirectoryQuery }) {
  if (!rate) {
    return (
      <p className="text-[0.8125rem] text-muted-foreground">
        No saved exchange rate: INR rows have no USD equivalent, and salary sorting is unavailable.
      </p>
    );
  }
  const metric = SORT_LABELS[usdMetric(query)].replace(" (USD equivalent)", "").toLowerCase();
  return (
    <p className="text-[0.8125rem] text-muted-foreground">
      {salarySort ? (
        <strong className="font-semibold text-foreground">Sorted by USD equivalent of {metric}. </strong>
      ) : null}
      USD equivalents use 1&nbsp;USD = {rate.rate}&nbsp;INR, effective {formatDate(rate.effectiveDate)}, from{" "}
      <a href={rate.sourceUrl} className="text-primary underline underline-offset-4" rel="noreferrer" target="_blank">
        {rate.sourceName}
      </a>
      . Native amounts are authoritative; USD is for comparison only.
    </p>
  );
}

function SortHeader({
  field,
  label,
  query,
  sortFields,
  align = "left",
}: {
  field: SortField;
  label: string;
  query: DirectoryQuery;
  sortFields: SortField[];
  align?: "left" | "right";
}) {
  const current = (query.sort ?? "name") === field;
  const direction = query.direction ?? "asc";
  const ariaSort = current ? (direction === "asc" ? "ascending" : "descending") : "none";
  const className = cn("px-2.5 py-2.5 align-bottom text-[0.75rem] font-semibold", align === "right" && "text-right");
  if (!sortFields.includes(field)) {
    return (
      <th scope="col" className={className}>
        {label}
      </th>
    );
  }
  const next = withChanges(query, { sort: field, direction: current && direction === "asc" ? "desc" : "asc" });
  const Icon = current ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  // The icon is set inline after the label's last word, with a non-breaking join, so it wraps
  // with that word and always reads as part of its own label, in left- and right-aligned headers.
  const words = label.split(" ");
  const lastWord = words.pop();
  return (
    <th scope="col" aria-sort={ariaSort} className={className}>
      <Link href={directoryHref(next)} scroll={false} className="rounded-sm text-balance hover:text-primary">
        {words.length > 0 ? `${words.join(" ")} ` : null}
        <span className="whitespace-nowrap">
          {lastWord}
          <Icon
            aria-hidden="true"
            data-sort-icon=""
            className={cn("ml-1 inline-block size-3 align-[-1px]", current ? "text-primary" : "text-muted-foreground/70")}
          />
        </span>
        <span className="sr-only">
          {current ? `, sorted ${direction === "asc" ? "ascending" : "descending"}. Select to reverse.` : ", select to sort."}
        </span>
      </Link>
    </th>
  );
}

function UsdCell({ row, query }: { row: Row; query: DirectoryQuery }) {
  const usd = row.compensation?.usdEquivalent;
  if (!row.compensation) return <span className="text-muted-foreground">—</span>;
  if (!usd) return <span className="text-[0.8125rem] text-muted-foreground">No rate</span>;
  return <Money amount={usd[usdMetric(query)]} currency="USD" className={row.compensation.currency === "USD" ? "text-muted-foreground" : undefined} />;
}

function DesktopTable({ data, query, sortFields }: { data: DirectoryResponse; query: DirectoryQuery; sortFields: SortField[] }) {
  const metric = usdMetric(query) === "annualCashCompensation" ? "cash" : "base";
  return (
    // Focusable so keyboard users can scroll it when narrow desktop widths make it scroll sideways.
    <div tabIndex={0} role="region" aria-label="Employees table" className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block">
      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="sr-only">Employees, page {data.page.number} of {Math.max(data.page.totalPages, 1)}</caption>
        <thead className="border-b border-line bg-[#f3f1ec] text-left">
          <tr>
            <SortHeader field="name" label="Employee" query={query} sortFields={sortFields} />
            <SortHeader field="employeeCode" label="Employee ID" query={query} sortFields={sortFields} />
            <SortHeader field="department" label="Department and job title" query={query} sortFields={sortFields} />
            <SortHeader field="level" label="Level" query={query} sortFields={sortFields} />
            <SortHeader field="country" label="Country" query={query} sortFields={sortFields} />
            <th scope="col" className="px-2.5 py-2.5 align-bottom text-[0.75rem] font-semibold">
              Employment status
            </th>
            <SortHeader field="annualBaseSalary" label="Annual base salary" query={query} sortFields={sortFields} align="right" />
            <SortHeader field="annualCashCompensation" label="Annual cash compensation" query={query} sortFields={sortFields} align="right" />
            <th scope="col" className="px-2.5 py-2.5 text-right align-bottom text-[0.75rem] font-semibold">
              USD equivalent ({metric})
            </th>
          </tr>
        </thead>
        <tbody>
          {data.employees.map((row) => (
            <tr key={row.employeeCode} className="border-b border-line align-top last:border-b-0 hover:bg-[#faf9f6]">
              <th scope="row" className="px-2.5 py-2.5 text-left font-medium whitespace-nowrap">
                <Link href={detailHref(row, query)} className="text-primary underline-offset-4 hover:underline">
                  {fullName(row)}
                </Link>
              </th>
              <td className="px-2.5 py-2.5 whitespace-nowrap tabular-nums" translate="no">
                {row.employeeCode}
              </td>
              <td className="px-2.5 py-2.5">
                <span className="block">{row.department}</span>
                <span className="block text-[0.8125rem] text-muted-foreground">{row.jobTitle}</span>
              </td>
              <td className="px-2.5 py-2.5">{LEVEL_LABELS[row.level]}</td>
              <td className="px-2.5 py-2.5 whitespace-nowrap">{countryName(row.country)}</td>
              <td className="px-2.5 py-2.5 whitespace-nowrap">{STATUS_LABELS[row.employmentStatus]}</td>
              <td className="px-2.5 py-2.5 text-right">
                {row.compensation ? (
                  <>
                    <Money amount={row.compensation.annualBaseSalary} currency={row.compensation.currency} className="block" />
                    <CompensationStateLabel compensation={row.compensation} employeeLeft={row.employmentStatus === "LEFT"} />
                  </>
                ) : (
                  <span className="text-[0.8125rem] text-muted-foreground">No compensation record</span>
                )}
              </td>
              <td className="px-2.5 py-2.5 text-right">
                {row.compensation ? <Money amount={row.compensation.annualCashCompensation} currency={row.compensation.currency} /> : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-2.5 py-2.5 text-right">
                <UsdCell row={row} query={query} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileList({ data, query }: { data: DirectoryResponse; query: DirectoryQuery }) {
  const metric = usdMetric(query) === "annualCashCompensation" ? "cash" : "base";
  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label="Employees">
      {data.employees.map((row) => (
        <li key={row.employeeCode} className="px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <Link href={detailHref(row, query)} className="min-w-0 font-semibold text-primary underline-offset-4 hover:underline">
              {fullName(row)}
            </Link>
            <span className="shrink-0 text-[0.8125rem] tabular-nums text-muted-foreground" translate="no">
              {row.employeeCode}
            </span>
          </div>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            {row.department}, {STATUS_LABELS[row.employmentStatus].toLowerCase()}
          </p>
          {row.compensation ? (
            <>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 text-[0.8125rem]">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Annual base salary</dt>
                <dd className="font-medium">
                  <Money amount={row.compensation.annualBaseSalary} currency={row.compensation.currency} />
                </dd>
              </div>
              <div className="min-w-0 text-right">
                <dt className="text-muted-foreground">USD equivalent ({metric})</dt>
                <dd className="font-medium">
                  <UsdCell row={row} query={query} />
                </dd>
              </div>
            </dl>
            <CompensationStateLabel compensation={row.compensation} employeeLeft={row.employmentStatus === "LEFT"} className="mt-1 block" />
            </>
          ) : (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">No compensation record</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Pagination({ data, query }: { data: DirectoryResponse; query: DirectoryQuery }) {
  const { number, totalPages, totalRows, size } = data.page;
  const first = totalRows === 0 ? 0 : (number - 1) * size + 1;
  const last = Math.min(number * size, totalRows);
  const linkClass = "inline-flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-medium hover:bg-muted";
  const disabledClass = "inline-flex h-9 items-center rounded-md border border-line px-3 text-sm font-medium text-muted-foreground opacity-60";
  return (
    <nav aria-label="Pagination" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground tabular-nums">
        <span>
          Showing {formatCount(first)}–{formatCount(last)} of {formatCount(totalRows)}
        </span>
        <span className="ml-4">
          Page {formatCount(number)} of {formatCount(Math.max(totalPages, 1))}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <PageSizeSelect query={query} choices={[...PAGE_SIZE_CHOICES]} />
        {number > 1 ? (
          <Link href={directoryHref(withChanges(query, { page: Math.min(number - 1, Math.max(totalPages, 1)) }))} scroll={false} className={linkClass}>
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Previous
          </span>
        )}
        {number < totalPages ? (
          <Link href={directoryHref(withChanges(query, { page: number + 1 }))} scroll={false} className={linkClass}>
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

export function DirectoryResults({
  data,
  query,
  sortFields,
  filtered,
}: {
  data: DirectoryResponse;
  query: DirectoryQuery;
  sortFields: SortField[];
  filtered: boolean;
}) {
  if (data.page.totalRows === 0) {
    return filtered ? (
      <EmptyState title="No employees match these filters." action={{ label: "Clear all filters", href: directoryHref(clearFilters(query)) }} />
    ) : (
      <EmptyState title="Your HR account has no employee access." body="Ask an Admin HR user to assign countries and departments to your account." />
    );
  }
  if (data.employees.length === 0) {
    return (
      <EmptyState
        title="This page is past the last page of results."
        action={{ label: "Go to the first page", href: directoryHref(withChanges(query, { page: undefined })) }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {/* Salary sorts state their comparison basis before the rows; otherwise the rate is a footnote. */}
      {isSalarySort(query.sort) ? <RateNote rate={data.exchangeRate} salarySort query={query} /> : null}
      <DesktopTable data={data} query={query} sortFields={sortFields} />
      <MobileList data={data} query={query} />
      <Pagination data={data} query={query} />
      {isSalarySort(query.sort) ? null : <RateNote rate={data.exchangeRate} salarySort={false} query={query} />}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: { label: string; href: string } }) {
  return (
    <div className="rounded-md border border-line bg-surface px-5 py-8">
      <p className="text-[0.9375rem] font-semibold">{title}</p>
      {body ? <p className="mt-1 text-sm text-muted-foreground">{body}</p> : null}
      {action ? (
        <p className="mt-4">
          <Link href={action.href} className="text-sm font-medium text-primary underline underline-offset-4">
            {action.label}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
