import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

import { AppShell, AppShellSkeleton } from '@/components/shell/app-shell';
import { ServiceUnavailable, UnexpectedResponse } from '@/components/shell/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { HrAccessSearchForm } from '@/app/hr-access/hr-access-search-form';
import { accessText, defaultHrDirection, HR_ACCESS_SERVICE, hrAccessSearch, hrUserHref, parseHrAccessQuery, roleLabel, statusLabel } from '@/lib/hr-access';
import { api } from '@/server/api/client';
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from '@/server/protected';

export const metadata: Metadata = { title: 'HR Access' };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export default function HrAccessPage({ searchParams }: PageProps) {
  return <Suspense fallback={<AppShellSkeleton><div className="h-8 w-48 animate-none rounded bg-muted" /></AppShellSkeleton>}><HrAccessList searchParams={searchParams} /></Suspense>;
}

async function HrAccessList({ searchParams }: PageProps) {
  const [{ session, token }, raw] = await Promise.all([loadSessionAndToken(), searchParams]);
  const user = requireUser(session);
  const parsed = parseHrAccessQuery(raw);
  const q = parsed.query;
  // Retrying keeps the person's search and filters.
  const retryHref = `/hr-access${hrAccessSearch(q)}`;
  const shell = (children: ReactNode) => <AppShell identity={user ? identityOf(user) : null} current="hr-access">{children}</AppShell>;
  if (!user) return shell(<ServiceUnavailable retryHref={retryHref} service={HR_ACCESS_SERVICE} />);
  if (user.role !== 'ADMIN') {
    // Presentation only: the backend still answers every HR Access request with 403 for Scoped HR.
    const check = token ? await api().listHrUsers(token, { pageSize: 1 }) : null;
    redirectIfUnauthenticated(check && !check.ok ? check.kind : undefined);
    if (!check || !check.ok) return shell(check?.kind === 'FORBIDDEN' ? <Forbidden /> : <ServiceUnavailable retryHref={retryHref} service={HR_ACCESS_SERVICE} />);
  }

  const header = (
    <header className="flex max-w-6xl flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">HR Access</h1><p className="mt-1.5 text-[0.9375rem] text-muted-foreground">Who can see which employees</p></div>
      <Link href="/hr-access/new" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Add HR user</Link>
    </header>
  );

  // An invalid link makes no backend request and says so; it is not an outage (QA run 03, D3).
  if (parsed.invalid.length > 0) {
    return shell(<>
      {header}
      <HrAccessSearchForm query={q} />
      <InvalidFilters />
    </>);
  }

  const result = token ? await api().listHrUsers(token, { ...q, status: q.status ?? 'ACTIVE' }) : null;
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  if (!result || !result.ok) {
    if (result?.kind === 'FORBIDDEN') return shell(<Forbidden />);
    if (result?.kind === 'VALIDATION_ERROR') return shell(<>{header}<HrAccessSearchForm query={q} /><InvalidFilters /></>);
    if (result?.kind === 'INVALID_RESPONSE') return shell(<UnexpectedResponse retryHref={retryHref} />);
    return shell(<>{header}<ServiceUnavailable retryHref={retryHref} service={HR_ACCESS_SERVICE} /></>);
  }
  const data = result.data;
  const pageLink = (page: number) => `/hr-access${hrAccessSearch({ ...q, page })}`;
  const sortLink = (sort: 'updatedAt' | 'name' | 'email') => {
    const direction = q.sort === sort ? (q.direction === 'asc' ? 'desc' : 'asc') : defaultHrDirection(sort);
    return `/hr-access${hrAccessSearch({ ...q, sort, direction, page: 1 })}`;
  };
  const lastPage = Math.max(data.page.totalPages, 1);
  return shell(
    <>
      {header}
      <HrAccessSearchForm query={q} />
      {(q.country || q.department) ? <p className="mt-3 text-sm text-muted-foreground">Admin HR users are included because they can access all employees.</p> : null}
      {q.status !== 'ALL' && q.status !== 'INACTIVE' ? <p className="mt-3 text-sm text-muted-foreground">Inactive users are hidden. <Link href={`/hr-access${hrAccessSearch({ ...q, status: 'ALL', page: 1 })}`} className="font-medium text-primary underline underline-offset-4">Include inactive users</Link></p> : null}
      {data.users.length === 0 ? <section className="mt-6 max-w-3xl border-y border-line py-8"><h2 className="font-semibold">{data.emptyMessage}</h2><Link href="/hr-access" className="mt-2 inline-block text-sm font-medium text-primary underline">Clear filters</Link></section> : <>
        <div className="mt-6 hidden max-w-6xl overflow-x-auto rounded-md border border-line lg:block" tabIndex={0} role="region" aria-label="HR users">
          <table className="w-full border-collapse text-left text-[0.8125rem]"><thead className="bg-[#ece8e0] text-xs"><tr>{[['Name','name'],['Email','email'],['Role',null],['Status',null],['Access',null],['Version',null],['Last updated','updatedAt']].map(([label,sort])=><th key={label as string} scope="col" aria-sort={sort ? (q.sort === sort ? (q.direction === 'asc' ? 'ascending':'descending') : 'none') : undefined} className="px-3 py-3 font-semibold">{sort ? <Link href={sortLink(sort as 'name'|'email'|'updatedAt')} className="underline underline-offset-4">{label} {q.sort===sort?(q.direction==='asc'?'↑':'↓'):''}</Link>:label}</th>)}</tr></thead>
            <tbody>{data.users.map((user) => <tr key={user.hrUserId} className="border-t border-line"><td className="px-3 py-3"><Link className="font-semibold text-primary underline underline-offset-4" href={hrUserHref(user.hrUserId,q)}>{user.displayName}</Link></td><td className="px-3 py-3">{user.email}</td><td className="px-3 py-3">{roleLabel(user.role)}</td><td className="px-3 py-3">{statusLabel(user.status)}</td><td className="px-3 py-3">{accessText(user)}</td><td className="px-3 py-3 tabular-nums">{user.version}</td><td className="px-3 py-3">{new Date(user.updatedAt).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})} UTC</td></tr>)}</tbody></table>
        </div>
        <ul aria-label="HR users" className="mt-5 divide-y divide-line border-y border-line lg:hidden">{data.users.map((user)=><li key={user.hrUserId} className="space-y-2 py-4"><Link className="font-semibold text-primary underline underline-offset-4" href={hrUserHref(user.hrUserId,q)}>{user.displayName}</Link><p className="break-all text-sm text-muted-foreground">{user.email}</p><p className="text-sm">{roleLabel(user.role)} · {statusLabel(user.status)}</p><p className="text-sm">{accessText(user)}</p><p className="text-xs text-muted-foreground">Version {user.version} · Updated {new Date(user.updatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p></li>)}</ul>
        <nav aria-label="HR user pages" className="mt-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm">
          <p>Page {data.page.number} of {lastPage} · {data.page.totalRows} users</p>
          <div className="flex gap-4">
            <PageLink href={data.page.number > 1 ? pageLink(data.page.number - 1) : null}>Previous</PageLink>
            <PageLink href={data.page.number < data.page.totalPages ? pageLink(data.page.number + 1) : null}>Next</PageLink>
          </div>
        </nav>
      </>}
    </>
  );
}

/** A pagination step: a link when there is a page, otherwise plain text with no href (QA run 03, D2). */
function PageLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <span aria-disabled="true" className="text-muted-foreground">{children}</span>;
  return <Link className="font-medium text-primary underline" href={href}>{children}</Link>;
}

function InvalidFilters() {
  return (
    <Alert variant="destructive" className="mt-5 max-w-2xl" role="alert">
      <CircleAlert aria-hidden="true" />
      <AlertTitle className="text-[#7d1a14]">These filters could not be applied</AlertTitle>
      <AlertDescription className="text-[#7d1a14]">
        <p>The link has a value HR Access does not accept, so no HR users were requested or shown.</p>
        <p><Link href="/hr-access" className="font-medium">Clear filters</Link></p>
      </AlertDescription>
    </Alert>
  );
}

function Forbidden() { return <section className="max-w-2xl"><h1 className="text-[1.75rem] font-semibold">HR Access</h1><div role="alert" className="mt-6 rounded-md border border-line bg-[#e6ecf8] p-4"><p className="font-semibold">HR Access is available to Admin HR only.</p><Link className="mt-3 inline-block text-sm text-primary underline" href="/employees">Return to Employees</Link></div></section>; }
