import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import { AppShell, AppShellSkeleton } from "@/components/shell/app-shell";
import { NoticeAlert, ServiceUnavailable, UnexpectedResponse } from "@/components/shell/page-states";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFilterChoices } from "@/lib/directory-choices";
import { DEFAULT_SORT, clearFilters, directoryHref, hasFilters, type SortField } from "@/lib/directory-url";
import { formatCount } from "@/lib/format";
import { scopeSummary } from "@/lib/hr-scope";
import { api } from "@/server/api/client";
import { parseDirectoryQuery } from "@/server/directory-query";
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from "@/server/protected";
import type { HrUser } from "@/server/session";

import { DirectoryControls } from "./directory-controls";
import { DirectoryNavigationProvider, PendingRegion } from "./directory-navigation";
import { ActiveFilters, DirectoryResults } from "./directory-results";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  return (
    <Suspense
      fallback={
        <AppShellSkeleton>
          <PageHeading />
          <DirectorySkeleton />
        </AppShellSkeleton>
      }
    >
      <EmployeesDirectory searchParams={searchParams} />
    </Suspense>
  );
}

async function EmployeesDirectory({ searchParams }: { searchParams: PageProps<"/employees">["searchParams"] }) {
  const [{ session, token }, rawParams] = await Promise.all([loadSessionAndToken(), searchParams]);
  const parsed = parseDirectoryQuery(rawParams);
  const query = parsed.query;
  const retryHref = directoryHref(query);

  // Session, options, and the page of employees load in parallel. Nothing is fetched for a URL
  // whose parameters the backend would reject.
  const client = api();
  const [, options, list] = await Promise.all([
    Promise.resolve(session),
    token ? client.getDirectoryOptions(token) : Promise.resolve(null),
    token && parsed.invalid.length === 0 ? client.listEmployees(token, query) : Promise.resolve(null),
  ]);

  const user = requireUser(session);
  redirectIfUnauthenticated(options && !options.ok ? options.kind : undefined, list && !list.ok ? list.kind : undefined);

  if (!user) {
    return (
      <AppShell identity={null}>
        <PageHeading />
        <ServiceUnavailable retryHref={retryHref} />
      </AppShell>
    );
  }

  const shell = (content: ReactNode, count?: number) => (
    <AppShell identity={identityOf(user)}>
      <PageHeading count={count} />
      <AccessNote user={user} />
      <div className="mt-6 flex flex-col gap-5">{content}</div>
    </AppShell>
  );

  if (!options || !options.ok) {
    if (options && options.kind === "INVALID_RESPONSE") return shell(<UnexpectedResponse retryHref={retryHref} />);
    return shell(<ServiceUnavailable retryHref={retryHref} className="max-w-2xl" />);
  }

  const sortFields = options.data.sortFields as SortField[];
  const choices = buildFilterChoices(options.data);
  const controls = <DirectoryControls query={query} choices={choices} sortFields={sortFields} />;

  if (parsed.invalid.length > 0) {
    return shell(
      <DirectoryNavigationProvider>
        {controls}
        <NoticeAlert title="Some filters in this link are not valid">
          <p>The address contains values the directory does not accept, so no results are shown.</p>
          <p>
            <Link href={directoryHref(clearFilters({}))} className="font-medium text-primary underline underline-offset-4">
              Show all employees
            </Link>
          </p>
        </NoticeAlert>
      </DirectoryNavigationProvider>,
    );
  }

  const requestedSort = query.sort ?? DEFAULT_SORT;
  if (!sortFields.includes(requestedSort)) {
    // The options endpoint omits salary sorts when the backend has no saved exchange rate.
    return shell(
      <DirectoryNavigationProvider>
        {controls}
        <NoticeAlert title="Salary sorting is unavailable">
          <p>No exchange rate is saved, so INR and USD salaries cannot be compared. Native amounts are still shown.</p>
          <p>
            <Link href={directoryHref({ ...query, sort: undefined, direction: undefined, comparisonCurrency: undefined, page: undefined })} className="font-medium text-primary underline underline-offset-4">
              Sort by employee name instead
            </Link>
          </p>
        </NoticeAlert>
      </DirectoryNavigationProvider>,
    );
  }

  if (!list || !list.ok) {
    if (list?.kind === "VALIDATION_ERROR") {
      return shell(
        <DirectoryNavigationProvider>
          {controls}
          <NoticeAlert title="The directory did not accept this search">
            <p>Change the search or filters and try again.</p>
          </NoticeAlert>
        </DirectoryNavigationProvider>,
      );
    }
    if (list?.kind === "INVALID_RESPONSE") return shell(<UnexpectedResponse retryHref={retryHref} />);
    return shell(<ServiceUnavailable retryHref={retryHref} className="max-w-2xl" />);
  }

  return shell(
    <DirectoryNavigationProvider>
      {controls}
      <ActiveFilters query={query} choices={choices} />
      <PendingRegion>
        <DirectoryResults data={list.data} query={query} sortFields={sortFields} filtered={hasFilters(query)} />
      </PendingRegion>
    </DirectoryNavigationProvider>,
    list.data.page.totalRows,
  );
}

function PageHeading({ count }: { count?: number }) {
  return (
    <div className="flex max-w-5xl flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">Employees</h1>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">Search and review compensation records</p>
      </div>
      {count !== undefined ? (
        <p className="text-sm text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{formatCount(count)}</span> {count === 1 ? "employee" : "employees"}
        </p>
      ) : null}
    </div>
  );
}

function AccessNote({ user }: { user: HrUser }) {
  if (user.role === "ADMIN") return null;
  const scope = scopeSummary(user.role, user.countries, user.departments);
  if (scope === "No employee access") return null;
  return (
    <p className="mt-4 flex max-w-3xl items-start gap-2 text-sm text-foreground">
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>Results are permission filtered to your access: {scope}.</span>
    </p>
  );
}

function DirectorySkeleton() {
  const bar = "animate-none bg-muted";
  return (
    <div className="mt-6 flex flex-col gap-5" aria-busy="true">
      <p role="status" className="sr-only">
        Loading employees…
      </p>
      {/* The search field is not shown while loading, so nothing typed can be lost. */}
      <Skeleton className={`h-10 w-full max-w-xl ${bar}`} />
      <div className="rounded-md border border-line bg-surface px-4 py-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <div key={row} className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0">
            <Skeleton className={`h-3.5 w-[24%] ${bar}`} />
            <Skeleton className={`hidden h-3.5 w-[12%] sm:block ${bar}`} />
            <Skeleton className={`hidden h-3.5 w-[18%] lg:block ${bar}`} />
            <Skeleton className={`ml-auto h-3.5 w-[16%] ${bar}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
