import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { X } from "lucide-react";

import {
  ActivitySection,
  AttentionList,
  BreakdownPanel,
  CommitmentLedger,
  HeadcountLine,
  InvalidLinkState,
  NoAccessState,
  NoDataState,
  NotAppliedNotes,
  RecentChangesList,
  ScopeLine,
  SectionFailure,
  UpcomingChangesList,
  WithoutAdjustmentList,
  type DashboardBreakdown,
  type DashboardRecentChanges,
  type DashboardSummary,
  type DashboardWithoutAdjustment,
} from "@/components/dashboard/dashboard-sections";
import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { ServiceUnavailable } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BREAKDOWN_KEYS,
  BREAKDOWN_LABELS,
  DEFAULT_BREAKDOWN,
  clearDashboardFilters,
  dashboardApiQueries,
  dashboardHref,
  hasDashboardFilters,
  withDashboardChanges,
  type DashboardQuery,
} from "@/lib/dashboard-url";
import { FILTER_LABELS, buildFilterChoices, filterValueLabel, type FilterChoices } from "@/lib/directory-choices";
import { FILTER_KEYS } from "@/lib/directory-url";
import { api, type ApiResult } from "@/server/api/client";
import { parseDashboardQuery } from "@/server/directory-query";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";

import { BreakdownTabs } from "./breakdown-tabs";
import { DashboardFilters, NoAdjustmentPeriodControl, RecentPeriodControl } from "./dashboard-controls";
import { DashboardLink } from "./dashboard-link";
import { DashboardNavigationProvider, PendingRegion } from "./dashboard-navigation";

export const metadata: Metadata = { title: "Dashboard" };

// Rendering and caching (Next.js 16, Cache Components):
// - The page reads the session cookie and searchParams, which are request-time APIs, so all of
//   it streams behind <Suspense>; only the heading and skeleton are in the static shell.
// - Nothing here uses "use cache". Every figure is per user and per scope, the task forbids a
//   cache layer without measurement, and the API client sends `cache: "no-store"`, so no
//   authenticated response can be shared across users or scopes.
// - The four dashboard endpoints are requested in parallel. The first viewport waits only for
//   the summary; the breakdown and the two lists stream in behind their own boundaries, so one
//   failed endpoint never hides the others.

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton current="dashboard">
          <PageHeading />
          <DashboardSkeleton />
        </AppShellSkeleton>
      }
    >
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}


async function Dashboard({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const [{ session, token }, rawParams] = await Promise.all([loadSessionAndToken(), searchParams]);
  const user = requireUser(session);
  const parsed = parseDashboardQuery(rawParams);
  const query = parsed.query;
  const retryHref = dashboardHref(query);

  if (!user || !token) {
    return (
      <AppShell identity={null} current="dashboard">
        <PageHeading />
        <ServiceUnavailable retryHref={retryHref} />
      </AppShell>
    );
  }

  const shell = (content: ReactNode) => (
    <AppShell identity={identityOf(user)} current="dashboard">
      <PageHeading />
      <div className="mt-6 flex max-w-[80rem] flex-col gap-8">{content}</div>
    </AppShell>
  );

  // Invalid links make no dashboard call at all.
  if (parsed.invalid.length > 0) return shell(<InvalidLinkState />);
  // An empty scope has no employee access: show only that, request nothing, reveal nothing.
  if (user.role === "SCOPED" && (user.countries.length === 0 || user.departments.length === 0)) return shell(<NoAccessState />);

  const client = api();
  const queries = dashboardApiQueries(query);
  const optionsRequest = client.getDirectoryOptions(token);
  const summaryRequest = client.getDashboardSummary(token, queries.summary);
  const breakdownRequest = client.getDashboardBreakdown(token, queries.breakdown);
  const recentRequest = client.getDashboardRecentChanges(token, queries.recent);
  const withoutRequest = client.getDashboardWithoutRecentAdjustment(token, queries.without);

  const [options, summary] = await Promise.all([optionsRequest, summaryRequest]);
  redirectIfUnauthenticated(options.ok ? undefined : options.kind, summary.ok ? undefined : summary.kind);

  if (summary.ok && !summary.data.access.hasEmployeeAccess) return shell(<NoAccessState />);

  const choices = options.ok ? buildFilterChoices(options.data) : null;
  const controls = (
    <div className="flex flex-col gap-3">
      {choices ? (
        <DashboardFilters query={query} choices={choices} />
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">
          Filters could not be loaded.{" "}
          <a href={retryHref} className="font-medium text-primary underline underline-offset-4">
            Try again
          </a>
        </p>
      )}
      <ActiveFilters query={query} choices={choices} />
    </div>
  );

  const figures = summary.ok ? summary.data.figures : null;
  const noMatches =
    figures !== null && hasDashboardFilters(query) && figures.headcount.currentlyWorking + figures.headcount.soonToJoin + figures.headcount.left === 0;
  if (noMatches) {
    return shell(
      <DashboardNavigationProvider>
        {controls}
        <NoDataState query={query} />
      </DashboardNavigationProvider>,
    );
  }

  const breakdown = query.breakdown ?? DEFAULT_BREAKDOWN;
  const tabs = BREAKDOWN_KEYS.map((key) => ({
    key,
    label: BREAKDOWN_LABELS[key],
    href: dashboardHref(withDashboardChanges(query, { breakdown: key === DEFAULT_BREAKDOWN ? undefined : key })),
  }));

  return shell(
    <DashboardNavigationProvider>
      {controls}
      <PendingRegion>
        <div className="flex flex-col gap-10">
          <Overview summary={summary} query={query} isAdmin={user.role === "ADMIN"} retryHref={retryHref} />

          <section aria-labelledby="breakdown-heading" className="flex min-w-0 flex-col gap-3">
            <h2 id="breakdown-heading" className="text-[1.0625rem] font-semibold tracking-[-0.005em]">
              Where compensation is concentrated
            </h2>
            <BreakdownTabs tabs={tabs} selected={breakdown}>
              <Suspense key={breakdown} fallback={<SectionLoading label="Loading breakdown…" />}>
                <BreakdownSection request={breakdownRequest} query={query} retryHref={retryHref} />
              </Suspense>
            </BreakdownTabs>
          </section>

          <ActivitySection
            id="recent-changes"
            title="Recorded salary changes"
            description={
              <>
                Changes HR recorded in the period, newest first, including ones that take effect later. The period counts when a change was
                recorded, not when it takes effect. The initial import is not counted.
              </>
            }
            controls={<RecentPeriodControl query={query} />}
          >
            <Suspense fallback={<SectionLoading label="Loading recorded changes…" />}>
              <RecentSection request={recentRequest} query={query} retryHref={retryHref} />
            </Suspense>
          </ActivitySection>

          <ActivitySection
            id="upcoming-changes"
            title="Upcoming approved changes"
            description="Approved changes with a future effective date, soonest first."
          >
            {summary.ok && figures ? (
              <UpcomingChangesList upcoming={figures.upcomingCommitment.upcomingChanges} query={query} />
            ) : (
              <SectionFailure title="Upcoming approved changes" retryHref={retryHref} kind={failureKind(summary)} />
            )}
          </ActivitySection>

          <ActivitySection
            id="without-adjustment"
            title="Employees without a recorded adjustment"
            focusKey={String(query.noAdjustmentPage ?? 1)}
            description={
              <>
                Currently working employees with no recorded salary adjustment since import or during the selected period. The system has no
                salary history from before the import; an employee may have had adjustments before it.
              </>
            }
            controls={<NoAdjustmentPeriodControl query={query} />}
          >
            <Suspense fallback={<SectionLoading label="Loading employees without a recorded adjustment…" />}>
              <WithoutSection request={withoutRequest} query={query} retryHref={retryHref} summaryCount={figures?.withoutRecentAdjustment.count ?? null} />
            </Suspense>
          </ActivitySection>
        </div>
      </PendingRegion>
    </DashboardNavigationProvider>,
  );
}

function failureKind(result: ApiResult<unknown>): string {
  return result.ok ? "UNAVAILABLE" : result.kind;
}

function Overview({ summary, query, isAdmin, retryHref }: { summary: ApiResult<DashboardSummary>; query: DashboardQuery; isAdmin: boolean; retryHref: string }) {
  if (!summary.ok || !summary.data.figures) {
    return (
      <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
        <h2 id="overview-heading" className="sr-only">
          Overview
        </h2>
        <SectionFailure title="Headcount, compensation, and attention figures" retryHref={retryHref} kind={failureKind(summary)} />
      </section>
    );
  }
  const { data } = summary;
  const figures = data.figures;
  if (!figures) return null;
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-6">
      <h2 id="overview-heading" className="sr-only">
        Overview
      </h2>
      <ScopeLine access={data.access} asOf={data.asOf} />
      <HeadcountLine headcount={figures.headcount} query={query} />
      <CommitmentLedger figures={figures} query={query} />
      <AttentionList figures={figures} query={query} isAdmin={isAdmin} />
    </section>
  );
}

async function BreakdownSection({ request, query, retryHref }: { request: Promise<ApiResult<DashboardBreakdown>>; query: DashboardQuery; retryHref: string }) {
  const result = await request;
  redirectIfUnauthenticated(result.ok ? undefined : result.kind);
  if (!result.ok) return <SectionFailure title="The breakdown" retryHref={retryHref} kind={result.kind} />;
  if (!result.data.access.hasEmployeeAccess) return null;
  return <BreakdownPanel data={result.data} breakdown={query.breakdown ?? DEFAULT_BREAKDOWN} query={query} />;
}

async function RecentSection({ request, query, retryHref }: { request: Promise<ApiResult<DashboardRecentChanges>>; query: DashboardQuery; retryHref: string }) {
  const result = await request;
  redirectIfUnauthenticated(result.ok ? undefined : result.kind);
  if (!result.ok) return <SectionFailure title="Recorded salary changes" retryHref={retryHref} kind={result.kind} />;
  if (!result.data.access.hasEmployeeAccess) return null;
  return <RecentChangesList data={result.data} query={query} />;
}

async function WithoutSection({
  request,
  query,
  retryHref,
  summaryCount,
}: {
  request: Promise<ApiResult<DashboardWithoutAdjustment>>;
  query: DashboardQuery;
  retryHref: string;
  summaryCount: number | null;
}) {
  const result = await request;
  redirectIfUnauthenticated(result.ok ? undefined : result.kind);
  if (!result.ok) return <SectionFailure title="Employees without a recorded adjustment" retryHref={retryHref} kind={result.kind} />;
  if (!result.data.access.hasEmployeeAccess) return null;
  const { data } = result;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{data.page.totalRows.toLocaleString("en-US")}</span>{" "}
        {data.page.totalRows === 1 ? "employee" : "employees"}: {data.definition}
      </p>
      {summaryCount !== null && summaryCount !== data.page.totalRows ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          The count above the fold ({summaryCount.toLocaleString("en-US")}) was read a moment earlier and differs; reload for one consistent view.
        </p>
      ) : null}
      <NotAppliedNotes notes={data.notApplied} />
      <WithoutAdjustmentList data={data} query={query} />
    </div>
  );
}

function ActiveFilters({ query, choices }: { query: DashboardQuery; choices: FilterChoices | null }) {
  const chips = FILTER_KEYS.flatMap((key) => {
    const value = query[key];
    if (!value) return [];
    const label = choices ? filterValueLabel(choices, key, value) : value;
    return [{ key, label: `${FILTER_LABELS[key]}: ${label}`, href: dashboardHref(withDashboardChanges(query, { [key]: undefined })) }];
  });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {chips.map((chip) => (
        <DashboardLink
          key={chip.key}
          href={chip.href}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface pr-2 pl-3 text-[0.8125rem] font-medium hover:border-input"
        >
          <span className="max-w-[18rem] truncate">{chip.label}</span>
          <X aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <span className="sr-only">(remove filter)</span>
        </DashboardLink>
      ))}
      <DashboardLink href={dashboardHref(clearDashboardFilters(query))} className="px-1 text-[0.8125rem] font-medium text-primary underline underline-offset-4">
        Clear filters
      </DashboardLink>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Dashboard</h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">Headcount, compensation commitments, and work that needs attention</p>
    </div>
  );
}

function SectionLoading({ label }: { label: string }) {
  const bar = "animate-none bg-muted";
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <p role="status" className="text-[0.8125rem] text-muted-foreground">
        {label}
      </p>
      <Skeleton className={`h-24 w-full ${bar}`} />
    </div>
  );
}

function DashboardSkeleton() {
  const bar = "animate-none bg-muted";
  return (
    <div className="mt-6 flex max-w-[80rem] flex-col gap-6" aria-busy="true">
      <p role="status" className="sr-only">
        Loading dashboard…
      </p>
      <Skeleton className={`h-10 w-full max-w-3xl ${bar}`} />
      <Skeleton className={`h-9 w-full ${bar}`} />
      <div className="flex gap-8">
        <Skeleton className={`h-12 w-32 ${bar}`} />
        <Skeleton className={`h-12 w-24 ${bar}`} />
        <Skeleton className={`h-12 w-24 ${bar}`} />
      </div>
      <Skeleton className={`h-36 w-full ${bar}`} />
      <Skeleton className={`h-48 w-full ${bar}`} />
    </div>
  );
}
