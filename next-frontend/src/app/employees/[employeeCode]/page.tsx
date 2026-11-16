import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { CompensationStateLabel, Money } from "@/components/directory/money";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import type { components } from "@/generated/api";
import { safeReturnPath } from "@/lib/directory-url";
import {
  CHANGE_REASON_LABELS,
  LEVEL_LABELS,
  PAY_FREQUENCY_LABELS,
  STATUS_LABELS,
  formatDate,
  fullName,
} from "@/lib/format";
import { countryName } from "@/lib/hr-scope";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { RateNote } from "../directory-results";

type Schemas = components["schemas"];
type Detail = Schemas["EmployeeDetailResponse"];

export const metadata: Metadata = { title: "Employee" };

export default function EmployeePage({ params, searchParams }: PageProps<"/employees/[employeeCode]">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <DetailSkeleton />
        </AppShellSkeleton>
      }
    >
      <EmployeeDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EmployeeDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/employees/[employeeCode]">["params"];
  searchParams: PageProps<"/employees/[employeeCode]">["searchParams"];
}) {
  const [{ employeeCode }, { from }, { session, token }] = await Promise.all([params, searchParams, loadSessionAndToken()]);
  const returnPath = safeReturnPath(from);
  const result = token ? await api().getEmployee(token, employeeCode) : null;

  const user = requireUser(session);
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  // Unknown and out-of-scope employees get the same backend 404, and the same page here.
  if (result && !result.ok && result.kind === "NOT_FOUND") notFound();

  const back = <BackLink href={returnPath} />;
  if (!user) {
    return (
      <AppShell identity={null}>
        {back}
        <ServiceUnavailable retryHref={`/employees/${encodeURIComponent(employeeCode)}`} />
      </AppShell>
    );
  }
  if (!result || !result.ok) {
    const retry = `/employees/${encodeURIComponent(employeeCode)}`;
    return (
      <AppShell identity={identityOf(user)}>
        {back}
        <div className="mt-6">
          {result?.kind === "INVALID_RESPONSE" ? <UnexpectedResponse retryHref={retry} /> : <ServiceUnavailable retryHref={retry} className="max-w-2xl" />}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell identity={identityOf(user)}>
      {back}
      <EmployeeRecord detail={result.data} />
    </AppShell>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to employees
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-line pt-2">
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium break-words">{children}</dd>
    </div>
  );
}

function compensationHeading(detail: Detail): string {
  const compensation = detail.compensation;
  if (!compensation) return "Compensation";
  if (compensation.state === "UPCOMING") return "Upcoming compensation";
  if (compensation.state === "HISTORICAL") return detail.employee.employmentStatus === "LEFT" ? "Last recorded compensation" : "Historical compensation";
  return "Current compensation";
}

function EmployeeRecord({ detail }: { detail: Detail }) {
  const { employee, compensation, compensationHistory, exchangeRate } = detail;
  // Newest first: the backend returns oldest first (effectiveFrom, then version).
  const history = [...compensationHistory].reverse();
  return (
    <article className="mt-5 flex max-w-5xl flex-col gap-8" aria-labelledby="employee-name">
      <header>
        <h1 id="employee-name" className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
          {fullName(employee)}
        </h1>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Employee ID</dt>
            <dd className="font-medium tabular-nums" translate="no">
              {employee.employeeCode}
            </dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all" translate="no">
              {employee.email}
            </dd>
          </div>
        </dl>
      </header>

      <section aria-labelledby="employment-heading">
        <h2 id="employment-heading" className="text-[0.9375rem] font-semibold">
          Employment
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Fact label="Department">{employee.department}</Fact>
          <Fact label="Job title">{employee.jobTitle}</Fact>
          <Fact label="Level">{LEVEL_LABELS[employee.level]}</Fact>
          <Fact label="Country">{countryName(employee.country)}</Fact>
          <Fact label="Employment status">{STATUS_LABELS[employee.employmentStatus]}</Fact>
          <Fact label="Hire date">{formatDate(employee.hireDate)}</Fact>
          {employee.employmentEndDate ? <Fact label="End date">{formatDate(employee.employmentEndDate)}</Fact> : null}
          <Fact label="Employee version">
            <span className="tabular-nums">{employee.version}</span>
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="compensation-heading" className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          <h2 id="compensation-heading" className="text-[0.9375rem] font-semibold">
            {compensationHeading(detail)}
          </h2>
          {compensation && !(compensation.state === "HISTORICAL" && employee.employmentStatus === "LEFT") ? (
            <CompensationStateLabel compensation={compensation} employeeLeft={employee.employmentStatus === "LEFT"} />
          ) : null}
        </div>
        {compensation ? (
          <div className="px-4 py-4">
            {/* Phones: one block per amount, native first, so two money values never share a line. */}
            <dl className="flex flex-col divide-y divide-line text-sm sm:hidden">
              {(
                [
                  ["Annual base salary", compensation.annualBaseSalary, compensation.usdEquivalent?.annualBaseSalary ?? null, true],
                  ["Annual bonus", compensation.annualBonus, undefined, false],
                  ["Annual cash compensation", compensation.annualCashCompensation, compensation.usdEquivalent?.annualCashCompensation ?? null, true],
                ] as const
              ).map(([label, native, usd, strong]) => (
                <div key={label} className="py-2.5 first:pt-0">
                  <dt className="font-medium">{label}</dt>
                  <dd className={strong ? "mt-0.5 font-semibold" : "mt-0.5"}>
                    <Money amount={native} currency={compensation.currency} />
                  </dd>
                  {compensation.currency !== "USD" ? (
                    <dd className="text-[0.8125rem] text-muted-foreground">
                      {usd === undefined ? "USD equivalent: not converted" : usd === null ? "USD equivalent: no rate" : <>USD equivalent <Money amount={usd} currency="USD" /></>}
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
            <table className="hidden w-full text-sm sm:table">
              <caption className="sr-only">Selected compensation in {compensation.currency} with USD equivalents</caption>
              <thead>
                <tr className="text-left text-[0.8125rem] text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    Native ({compensation.currency})
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    USD equivalent
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <th scope="row" className="py-2.5 text-left font-medium">
                    Annual base salary
                  </th>
                  <td className="py-2.5 text-right font-semibold">
                    <Money amount={compensation.annualBaseSalary} currency={compensation.currency} />
                  </td>
                  <td className="py-2.5 text-right">
                    {compensation.usdEquivalent ? <Money amount={compensation.usdEquivalent.annualBaseSalary} currency="USD" /> : <span className="text-muted-foreground">No rate</span>}
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="py-2.5 text-left font-medium">
                    Annual bonus
                  </th>
                  <td className="py-2.5 text-right">
                    <Money amount={compensation.annualBonus} currency={compensation.currency} />
                  </td>
                  <td className="py-2.5 text-right text-muted-foreground">Not converted</td>
                </tr>
                <tr className="border-t border-line">
                  <th scope="row" className="py-2.5 text-left font-medium">
                    Annual cash compensation
                  </th>
                  <td className="py-2.5 text-right font-semibold">
                    <Money amount={compensation.annualCashCompensation} currency={compensation.currency} />
                  </td>
                  <td className="py-2.5 text-right">
                    {compensation.usdEquivalent ? <Money amount={compensation.usdEquivalent.annualCashCompensation} currency="USD" /> : <span className="text-muted-foreground">No rate</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              {PAY_FREQUENCY_LABELS[compensation.payFrequency]}. Effective from {formatDate(compensation.effectiveFrom)}. Compensation version{" "}
              <span className="tabular-nums">{compensation.version}</span>.
            </p>
            {compensation.currency === "INR" ? (
              <div className="mt-2">
                <RateNote rate={exchangeRate} salarySort={false} query={{}} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">No compensation record applies to this employee&apos;s current status.</p>
        )}
      </section>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-[0.9375rem] font-semibold">
          Compensation history
        </h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">Newest first. Records are never edited; each change adds a version.</p>
        <ol className="mt-3 divide-y divide-line rounded-md border border-line bg-surface md:hidden" aria-label="Compensation history, newest first">
          {history.map((entry) => (
            <li key={entry.version} className="px-4 py-3 text-[0.8125rem]">
              <p className="flex justify-between gap-3 font-medium">
                <span>{formatDate(entry.effectiveFrom)}</span>
                <span className="text-muted-foreground">
                  Version <span className="tabular-nums">{entry.version}</span>
                </span>
              </p>
              <p className="text-muted-foreground">{CHANGE_REASON_LABELS[entry.changeReason]}</p>
              <dl className="mt-2 grid grid-cols-1 gap-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Annual base salary</dt>
                  <dd><Money amount={entry.annualBaseSalary} currency={entry.currency} /></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Annual bonus</dt>
                  <dd><Money amount={entry.annualBonus} currency={entry.currency} /></dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Annual cash compensation</dt>
                  <dd className="font-medium"><Money amount={entry.annualCashCompensation} currency={entry.currency} /></dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
        <div className="mt-3 hidden overflow-x-auto rounded-md border border-line bg-surface md:block">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Compensation history, newest first</caption>
            <thead className="border-b border-line bg-[#f3f1ec] text-left text-[0.8125rem]">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Effective date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Version</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Change reason</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Annual base salary</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Annual bonus</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Annual cash compensation</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Currency</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.version} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(entry.effectiveFrom)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{entry.version}</td>
                  <td className="px-3 py-2.5">{CHANGE_REASON_LABELS[entry.changeReason]}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Money amount={entry.annualBaseSalary} currency={entry.currency} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Money amount={entry.annualBonus} currency={entry.currency} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Money amount={entry.annualCashCompensation} currency={entry.currency} />
                  </td>
                  <td className="px-3 py-2.5" translate="no">
                    {entry.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}

function DetailSkeleton() {
  const bar = "animate-none bg-muted";
  return (
    <div className="flex max-w-5xl flex-col gap-6" aria-busy="true">
      <p role="status" className="sr-only">
        Loading employee…
      </p>
      <Skeleton className={`h-4 w-36 ${bar}`} />
      <Skeleton className={`h-8 w-64 ${bar}`} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((cell) => (
          <Skeleton key={cell} className={`h-10 ${bar}`} />
        ))}
      </div>
      <Skeleton className={`h-44 w-full ${bar}`} />
    </div>
  );
}
