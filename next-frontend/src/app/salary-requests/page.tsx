import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { Money } from "@/components/directory/money";
import { RequestStatusLabel } from "@/components/salary/salary-ui";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { NoticeAlert, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";
import { scopeSummary } from "@/lib/hr-scope";
import {
  METHOD_LABELS,
  TARGET_LABELS,
  describeInput,
  isPercentageMethod,
  requestListHref,
  type RequestListQuery,
  type SalaryRequestView,
} from "@/lib/salary";
import { api } from "@/server/api/client";
import { parseRequestListQuery } from "@/server/directory-query";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { DirectoryNavigationProvider, PendingRegion } from "../employees/directory-navigation";
import { RequestControls } from "./request-controls";

export const metadata: Metadata = { title: "Salary requests" };

export default function SalaryRequestsPage({ searchParams }: PageProps<"/salary-requests">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton current="requests">
          <Heading />
          <div className="mt-6 flex flex-col gap-3" aria-busy="true">
            <p role="status" className="sr-only">
              Loading salary requests…
            </p>
            <Skeleton className="h-10 w-full max-w-xl animate-none bg-muted" />
            <Skeleton className="h-64 w-full animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <SalaryRequests searchParams={searchParams} />
    </Suspense>
  );
}

async function SalaryRequests({ searchParams }: { searchParams: PageProps<"/salary-requests">["searchParams"] }) {
  const [{ session, token }, raw] = await Promise.all([loadSessionAndToken(), searchParams]);
  const parsed = parseRequestListQuery(raw);
  const user = requireUser(session);
  // Scoped HR cannot filter by department (the backend rejects it); treat it as an invalid link.
  if (user?.role === "SCOPED" && parsed.query.department) parsed.invalid.push("department");
  const query = parsed.query;
  const retryHref = requestListHref(query);

  const client = api();
  const [list, options] = await Promise.all([
    token && parsed.invalid.length === 0 && user ? client.listSalaryAdjustmentRequests(token, query) : Promise.resolve(null),
    token && user?.role === "ADMIN" ? client.getDirectoryOptions(token) : Promise.resolve(null),
  ]);
  redirectIfUnauthenticated(list && !list.ok ? list.kind : undefined, options && !options.ok ? options.kind : undefined);

  if (!user) {
    return (
      <AppShell identity={null} current="requests">
        <Heading />
        <ServiceUnavailable retryHref={retryHref} />
      </AppShell>
    );
  }

  const shell = (content: ReactNode) => (
    <AppShell identity={identityOf(user)} current="requests">
      <Heading role={user.role} />
      {user.role === "SCOPED" ? (
        <p className="mt-4 flex max-w-3xl items-start gap-2 text-sm">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          Requests for employees in your access: {scopeSummary(user.role, user.countries, user.departments)}. Admin HR approves or cancels
          them.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-5">{content}</div>
    </AppShell>
  );

  const departments = user.role === "ADMIN" ? (options?.ok ? options.data.departments : []) : null;
  const controls = <RequestControls query={query} departments={departments} />;

  if (parsed.invalid.length > 0) {
    return shell(
      <DirectoryNavigationProvider>
        {controls}
        <NoticeAlert title="Some filters in this link are not valid">
          <p>The address contains values the request list does not accept, so no results are shown.</p>
          <p>
            <Link href="/salary-requests" className="font-medium text-primary underline underline-offset-4">
              Show all requests
            </Link>
          </p>
        </NoticeAlert>
      </DirectoryNavigationProvider>,
    );
  }
  if (!list || !list.ok) {
    if (list?.kind === "INVALID_RESPONSE") return shell(<UnexpectedResponse retryHref={retryHref} />);
    return shell(<ServiceUnavailable retryHref={retryHref} className="max-w-2xl" />);
  }

  return shell(
    <DirectoryNavigationProvider>
      {controls}
      <PendingRegion>
        <RequestResults data={list.data} query={query} role={user.role} />
      </PendingRegion>
    </DirectoryNavigationProvider>,
  );
}

function Heading({ role }: { role?: "ADMIN" | "SCOPED" }) {
  return (
    <div className="max-w-3xl">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Salary requests</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        {role === "ADMIN" ? "Review, approve, or cancel salary change requests" : "Salary change requests and their status"}
      </p>
    </div>
  );
}

function requestHref(request: SalaryRequestView, query: RequestListQuery) {
  return `/salary-requests/${request.requestId}?from=${encodeURIComponent(requestListHref(query))}`;
}

function ChangeSummary({ request }: { request: SalaryRequestView }) {
  const { adjustment } = request;
  return (
    <>
      <span className="block font-medium">{TARGET_LABELS[adjustment.target]}</span>
      <span className="block text-[0.8125rem] text-muted-foreground">
        {METHOD_LABELS[adjustment.method]}, {describeInput(adjustment.method, adjustment.value)}
        {isPercentageMethod(adjustment.method) ? "" : ` ${adjustment.currency}`}
      </span>
    </>
  );
}

function RequestResults({ data, query, role }: { data: { requests: SalaryRequestView[]; page: { number: number; size: number; totalRows: number; totalPages: number } }; query: RequestListQuery; role: "ADMIN" | "SCOPED" }) {
  const filtered = Boolean(query.q || query.status || query.department);
  if (data.page.totalRows === 0) {
    const pendingOnly = query.status === "PENDING" && !query.q && !query.department;
    return (
      <div className="rounded-md border border-line bg-surface px-5 py-8">
        <p className="text-[0.9375rem] font-semibold">
          {pendingOnly
            ? "No requests are waiting for approval."
            : filtered
              ? "No requests match these filters."
              : role === "ADMIN"
                ? "No salary change requests yet."
                : "No salary change requests for employees in your access."}
        </p>
        {filtered ? (
          <p className="mt-4">
            <Link href="/salary-requests" className="text-sm font-medium text-primary underline underline-offset-4">
              {pendingOnly ? "Show all requests" : "Clear all filters"}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }
  const { number, totalPages, totalRows, size } = data.page;
  const first = (number - 1) * size + 1;
  const last = Math.min(number * size, totalRows);
  return (
    <div className="flex flex-col gap-4">
      <div tabIndex={0} role="region" aria-label="Salary requests table" className="hidden overflow-x-auto rounded-md border border-line bg-surface lg:block">
        <table className="w-full border-collapse text-[0.8125rem]">
          <caption className="sr-only">Salary change requests</caption>
          <thead className="border-b border-line bg-[#f3f1ec] text-left text-[0.75rem]">
            <tr>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold">Employee</th>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold">Requested change</th>
              <th scope="col" className="px-2.5 py-2.5 text-right align-bottom font-semibold">Current</th>
              <th scope="col" className="px-2.5 py-2.5 text-right align-bottom font-semibold">Proposed</th>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold">Effective</th>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold">Requested by</th>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold" aria-sort={query.direction === "asc" ? "ascending" : "descending"}>
                Submitted
              </th>
              <th scope="col" className="px-2.5 py-2.5 align-bottom font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.requests.map((request) => (
              <tr key={request.requestId} className="border-b border-line align-top last:border-b-0 hover:bg-[#faf9f6]">
                <th scope="row" className="px-2.5 py-2.5 text-left font-medium">
                  <Link href={requestHref(request, query)} className="text-primary underline-offset-4 hover:underline">
                    {request.employee.name}
                  </Link>
                  <span className="block text-[0.75rem] font-normal text-muted-foreground tabular-nums" translate="no">
                    {request.employee.employeeCode}, {request.employee.department}
                  </span>
                </th>
                <td className="px-2.5 py-2.5">
                  <ChangeSummary request={request} />
                </td>
                <td className="px-2.5 py-2.5 text-right">
                  <Money amount={request.adjustment.previousValue} currency={request.adjustment.currency} />
                </td>
                <td className="px-2.5 py-2.5 text-right font-medium">
                  <Money amount={request.adjustment.proposedValue} currency={request.adjustment.currency} />
                </td>
                <td className="px-2.5 py-2.5 whitespace-nowrap">{formatDate(request.adjustment.effectiveFrom)}</td>
                <td className="px-2.5 py-2.5">{request.requestedBy.displayName}</td>
                <td className="px-2.5 py-2.5 whitespace-nowrap">{formatDateTime(request.createdAt)}</td>
                <td className="px-2.5 py-2.5">
                  <RequestStatusLabel status={request.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line rounded-md border border-line bg-surface lg:hidden" aria-label="Salary requests">
        {data.requests.map((request) => (
          <li key={request.requestId} className="px-4 py-3.5 text-[0.8125rem]">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={requestHref(request, query)} className="min-w-0 text-sm font-semibold text-primary underline-offset-4 hover:underline">
                {request.employee.name}
              </Link>
              <RequestStatusLabel status={request.status} />
            </div>
            <p className="text-muted-foreground tabular-nums" translate="no">
              {request.employee.employeeCode}, {request.employee.department}
            </p>
            <div className="mt-1.5">
              <ChangeSummary request={request} />
            </div>
            <p className="mt-1">
              <Money amount={request.adjustment.previousValue} currency={request.adjustment.currency} className="text-muted-foreground" /> to{" "}
              <Money amount={request.adjustment.proposedValue} currency={request.adjustment.currency} className="font-medium" />
            </p>
            <p className="mt-1 text-muted-foreground">
              Effective {formatDate(request.adjustment.effectiveFrom)}. Submitted {formatDateTime(request.createdAt)} by {request.requestedBy.displayName}.
            </p>
          </li>
        ))}
      </ul>

      <nav aria-label="Pagination" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          Showing {formatCount(first)}–{formatCount(last)} of {formatCount(totalRows)}
          <span className="ml-4">
            Page {formatCount(number)} of {formatCount(Math.max(totalPages, 1))}
          </span>
        </p>
        <div className="flex gap-2">
          {number > 1 ? (
            <Link href={requestListHref({ ...query, page: number - 1 })} className="inline-flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-medium hover:bg-muted">
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm font-medium text-muted-foreground opacity-60">
              Previous
            </span>
          )}
          {number < totalPages ? (
            <Link href={requestListHref({ ...query, page: number + 1 })} className="inline-flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-medium hover:bg-muted">
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm font-medium text-muted-foreground opacity-60">
              Next
            </span>
          )}
        </div>
      </nav>
    </div>
  );
}
