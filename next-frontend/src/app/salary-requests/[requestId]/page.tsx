import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { Money } from "@/components/directory/money";
import { ChangeRecord, CompensationSnapshot, RequestOutcomeNotice, RequestStatusLabel } from "@/components/salary/salary-ui";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { safeReturnPath } from "@/lib/directory-url";
import { formatDate, formatDateTime } from "@/lib/format";
import { countryName } from "@/lib/hr-scope";
import { METHOD_LABELS, REASON_LABELS, TARGET_LABELS, describeInput, isPercentageMethod, isRequestId, type SalaryRequestView } from "@/lib/salary";
import { api } from "@/server/api/client";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { RequestDecision } from "./request-decision";

export const metadata: Metadata = { title: "Salary request" };

type Props = PageProps<"/salary-requests/[requestId]">;

export default function SalaryRequestPage({ params, searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton current="requests">
          <div className="flex max-w-3xl flex-col gap-5" aria-busy="true">
            <p role="status" className="sr-only">
              Loading request…
            </p>
            <Skeleton className="h-4 w-40 animate-none bg-muted" />
            <Skeleton className="h-8 w-72 animate-none bg-muted" />
            <Skeleton className="h-56 w-full animate-none bg-muted" />
          </div>
        </AppShellSkeleton>
      }
    >
      <SalaryRequest params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SalaryRequest({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  // Only `from` is read. Completion notices come from the persisted request, never from the URL.
  const [{ requestId }, { from }, { session, token }] = await Promise.all([params, searchParams, loadSessionAndToken()]);
  const backHref = safeReturnPath(from, ["/salary-requests"], "/salary-requests");
  if (!isRequestId(requestId)) notFound();

  const result = token ? await api().getSalaryAdjustmentRequest(token, requestId) : null;
  // The employee's current versions show whether approval would be refused as out of date.
  const employee =
    token && result?.ok ? await api().getEmployee(token, result.data.request.employee.employeeCode) : null;

  const user = requireUser(session);
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined, employee && !employee.ok ? employee.kind : undefined);
  if (result && !result.ok && result.kind === "NOT_FOUND") notFound();

  const back = (
    <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to salary requests
    </Link>
  );
  if (!user) {
    return (
      <AppShell identity={null} current="requests">
        {back}
        <ServiceUnavailable retryHref={`/salary-requests/${requestId}`} />
      </AppShell>
    );
  }
  const shell = (content: ReactNode) => (
    <AppShell identity={identityOf(user)} current="requests">
      {back}
      <div className="mt-5 flex max-w-3xl flex-col gap-6">{content}</div>
    </AppShell>
  );
  if (!result || !result.ok) {
    const retry = `/salary-requests/${requestId}`;
    return shell(result?.kind === "INVALID_RESPONSE" ? <UnexpectedResponse retryHref={retry} /> : <ServiceUnavailable retryHref={retry} className="max-w-2xl" />);
  }

  const request = result.data.request;
  const latestVersion = employee?.ok ? Math.max(...employee.data.compensationHistory.map((entry) => entry.version)) : null;
  const behind = latestVersion !== null && latestVersion !== request.requestedAgainstVersion;
  const compensation = employee?.ok ? employee.data.compensation : null;
  const employeeLeft = employee?.ok ? employee.data.employee.employmentStatus === "LEFT" : false;

  return shell(
    <>
      <RequestReview
        request={request}
        latestVersion={latestVersion}
        behind={behind}
        current={
          compensation ? (
            <CompensationSnapshot compensation={compensation} employeeLeft={employeeLeft} headingId="current-compensation-heading" />
          ) : (
            <p role="status" className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-2.5 text-sm">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
              <span>
                The employee&rsquo;s current compensation could not be loaded.{" "}
                {request.status === "PENDING" && user.role === "ADMIN" ? "Decisions are unavailable until it can be reviewed. " : ""}
                <Link href={`/salary-requests/${requestId}`} className="font-medium text-primary underline underline-offset-4">
                  Reload
                </Link>
              </span>
            </p>
          )
        }
      />
      {/* Admin decides only with the full current compensation on screen. */}
      {request.status === "PENDING" && user.role === "ADMIN" && compensation ? (
        <RequestDecision requestId={request.requestId} nextVersion={(latestVersion ?? request.requestedAgainstVersion) + 1} behind={behind} />
      ) : null}
    </>,
  );
}

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium break-words">{children}</dd>
    </div>
  );
}

function RequestReview({
  request,
  latestVersion,
  behind,
  current,
}: {
  request: SalaryRequestView;
  latestVersion: number | null;
  behind: boolean;
  current: ReactNode;
}) {
  const { adjustment, employee } = request;
  return (
    <article aria-labelledby="request-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 id="request-heading" className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">
          Salary change request
        </h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          <Link href={`/employees/${employee.employeeCode}?from=${encodeURIComponent("/salary-requests")}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {employee.name}
          </Link>{" "}
          <span translate="no">({employee.employeeCode})</span>, {employee.jobTitle}, {employee.department}, {countryName(employee.country)}
        </p>
        <RequestStatusLabel status={request.status} className="text-sm" />
      </header>

      <RequestOutcomeNotice request={request} />
      {request.status === "STALE" ? (
        <p className="flex items-start gap-2 rounded-md border border-line bg-muted px-3.5 py-2.5 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-historical" />
          <span>
            Out of date: {request.decisionNote ?? "Compensation changed after this request was created."} It can no longer be approved. The
            requester can submit a new request.
          </span>
        </p>
      ) : null}
      {request.status === "PENDING" && behind ? (
        <p className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] px-3.5 py-2.5 text-sm">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-state-upcoming" />
          <span>
            Compensation changed after this request was made (version {request.requestedAgainstVersion} then, version {latestVersion} now).
            Approval will be refused and the request marked out of date.
          </span>
        </p>
      ) : null}

      {current}

      <section aria-labelledby="requested-heading" className="rounded-md border border-line bg-surface px-4 py-4">
        <h2 id="requested-heading" className="text-[0.9375rem] font-semibold">
          Requested change
        </h2>
        <div className="mt-3">
          <ChangeRecord
            label={TARGET_LABELS[adjustment.target]}
            before={adjustment.previousValue}
            after={adjustment.proposedValue}
            currency={adjustment.currency}
          />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail label="Adjustment">
            {METHOD_LABELS[adjustment.method]}, {describeInput(adjustment.method, adjustment.value)}
            {isPercentageMethod(adjustment.method) ? "" : ` ${adjustment.currency}`}
          </Detail>
          <Detail label="Effective date">{formatDate(adjustment.effectiveFrom)}</Detail>
          <Detail label="Reason">{REASON_LABELS[adjustment.reason]}</Detail>
          <Detail label="Requested against">Compensation version {request.requestedAgainstVersion}</Detail>
          <Detail label="Note" wide>
            <span className="font-normal whitespace-pre-wrap">{adjustment.note ?? "No note"}</span>
          </Detail>
        </dl>
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          Only {TARGET_LABELS[adjustment.target].toLowerCase()} changes. The other value, pay frequency, and currency stay the same. Values
          are in {adjustment.currency}; the backend rechecks the salary band and versions when the request is approved.
        </p>
      </section>

      <section aria-labelledby="history-heading-request">
        <h2 id="history-heading-request" className="text-[0.9375rem] font-semibold">
          Record
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line pt-3 text-sm sm:grid-cols-2">
          <Detail label="Requested by">
            {request.requestedBy.displayName}, {formatDateTime(request.createdAt)}
          </Detail>
          {request.decidedBy && request.decidedAt ? (
            <Detail label={request.status === "APPROVED" ? "Approved by" : "Cancelled by"}>
              {request.decidedBy.displayName}, {formatDateTime(request.decidedAt)}
            </Detail>
          ) : null}
          {request.status === "CANCELLED" && request.decisionNote ? (
            <Detail label="Reason for cancelling" wide>
              <span className="font-normal whitespace-pre-wrap">{request.decisionNote}</span>
            </Detail>
          ) : null}
          {request.status === "APPROVED" && request.resultingCompensationVersion ? (
            <Detail label="Result">
              Compensation version {request.resultingCompensationVersion}.{" "}
              <Money amount={adjustment.proposedValue} currency={adjustment.currency} /> {TARGET_LABELS[adjustment.target].toLowerCase()} from{" "}
              {formatDate(adjustment.effectiveFrom)}.
            </Detail>
          ) : null}
        </dl>
      </section>
    </article>
  );
}
