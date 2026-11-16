import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, Info } from "lucide-react";

import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { NoticeAlert, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { safeReturnPath } from "@/lib/directory-url";
import { COMPENSATION_STATE_LABELS, formatDateTime, fullName } from "@/lib/format";
import { countryName } from "@/lib/hr-scope";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { AdjustmentWorkspace } from "./adjustment-workspace";

export const metadata: Metadata = { title: "Adjust compensation" };

type Props = PageProps<"/employees/[employeeCode]/adjust">;

export default function AdjustPage({ params, searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <div className="flex max-w-5xl flex-col gap-5" aria-busy="true">
            <p role="status" className="sr-only">
              Loading employee…
            </p>
            {/* No form while loading, so nothing typed can be lost. */}
            <Skeleton className="h-4 w-40 animate-none bg-muted" />
            <Skeleton className="h-8 w-72 animate-none bg-muted" />
            <Skeleton className="h-14 w-full animate-none bg-muted" />
            <Skeleton className="h-72 w-full max-w-md animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <Adjust params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Adjust({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const [{ employeeCode }, { from }, { session, token }] = await Promise.all([params, searchParams, loadSessionAndToken()]);
  const directoryPath = safeReturnPath(from);
  const detailSearch = directoryPath !== "/employees" ? `from=${encodeURIComponent(directoryPath)}` : "";
  const backHref = `/employees/${encodeURIComponent(employeeCode)}${detailSearch ? `?${detailSearch}` : ""}`;

  const client = api();
  const [detail, pending] = await Promise.all([
    token ? client.getEmployee(token, employeeCode) : Promise.resolve(null),
    token ? client.listSalaryAdjustmentRequests(token, { q: employeeCode, status: "PENDING", pageSize: 1 }) : Promise.resolve(null),
  ]);

  const user = requireUser(session);
  redirectIfUnauthenticated(detail && !detail.ok ? detail.kind : undefined, pending && !pending.ok ? pending.kind : undefined);
  if (detail && !detail.ok && detail.kind === "NOT_FOUND") notFound();

  const back = (
    <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to employee
    </Link>
  );

  if (!user) {
    return (
      <AppShell identity={null}>
        {back}
        <ServiceUnavailable retryHref={`/employees/${encodeURIComponent(employeeCode)}/adjust`} />
      </AppShell>
    );
  }
  const shell = (content: ReactNode) => (
    <AppShell identity={identityOf(user)}>
      {back}
      <div className="mt-5 flex max-w-6xl flex-col gap-6">{content}</div>
    </AppShell>
  );
  if (!detail || !detail.ok) {
    const retry = `/employees/${encodeURIComponent(employeeCode)}/adjust`;
    return shell(detail?.kind === "INVALID_RESPONSE" ? <UnexpectedResponse retryHref={retry} /> : <ServiceUnavailable retryHref={retry} className="max-w-2xl" />);
  }

  const { employee, compensation } = detail.data;
  const title = user.role === "ADMIN" ? "Adjust compensation" : "Request compensation change";
  const heading = (
    <header>
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">{title}</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        {fullName(employee)} <span translate="no">({employee.employeeCode})</span>, {employee.jobTitle}, {employee.department},{" "}
        {countryName(employee.country)}
      </p>
    </header>
  );

  if (employee.employmentStatus === "LEFT" || !compensation) {
    return shell(
      <>
        {heading}
        <NoticeAlert title="Not eligible">
          <p>This employee is not eligible for a compensation adjustment.</p>
        </NoticeAlert>
      </>,
    );
  }

  const pendingRequest = pending?.ok ? (pending.data.requests.find((request) => request.employee.employeeCode === employee.employeeCode) ?? null) : null;
  if (pendingRequest && user.role === "SCOPED") {
    return shell(
      <>
        {heading}
        <NoticeAlert title="A request is already pending">
          <p>
            A salary change request for this employee is already waiting for approval (submitted {formatDateTime(pendingRequest.createdAt)} by{" "}
            {pendingRequest.requestedBy.displayName}). Only one pending request is allowed per employee.
          </p>
          <p>
            <Link href={`/salary-requests/${pendingRequest.requestId}`} className="font-medium text-primary underline underline-offset-4">
              View request
            </Link>
          </p>
        </NoticeAlert>
      </>,
    );
  }

  return shell(
    <>
      {heading}
      {user.role === "SCOPED" ? (
        <p className="flex max-w-3xl items-start gap-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          Your request will go to an Admin HR user for approval. Compensation does not change until it is approved.
        </p>
      ) : null}
      <AdjustmentWorkspace
        employee={{
          code: employee.employeeCode,
          name: fullName(employee),
          jobTitle: employee.jobTitle,
          department: employee.department,
          countryName: countryName(employee.country),
        }}
        current={{
          annualBaseSalary: compensation.annualBaseSalary,
          annualBonus: compensation.annualBonus,
          annualCashCompensation: compensation.annualCashCompensation,
          currency: compensation.currency,
          version: compensation.version,
          stateLabel: COMPENSATION_STATE_LABELS[compensation.state],
        }}
        role={user.role}
        // The organisation-wide UTC business date, from the server clock, not the browser's.
        todayUtc={new Date().toISOString().slice(0, 10)}
        backHref={backHref}
        detailSearch={detailSearch}
        pendingRequest={
          pendingRequest
            ? { href: `/salary-requests/${pendingRequest.requestId}`, requestedBy: pendingRequest.requestedBy.displayName, createdAt: pendingRequest.createdAt }
            : null
        }
      />
    </>,
  );
}
