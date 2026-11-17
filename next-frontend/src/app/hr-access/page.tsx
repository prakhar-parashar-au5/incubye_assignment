import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { AppShell, AppShellSkeleton } from '@/components/shell/app-shell';
import { ServiceUnavailable, UnexpectedResponse } from '@/components/shell/page-states';
import { Button } from '@/components/ui/button';
import { HrAccessMobileFilters } from '@/app/hr-access/hr-access-mobile-filters';
import { accessText, hrAccessSearch, hrUserHref, parseHrAccessQuery, roleLabel, statusLabel } from '@/lib/hr-access';
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
  const result = token && parsed.invalid.length === 0 ? await api().listHrUsers(token, { ...parsed.query, status: parsed.query.status ?? 'ACTIVE' }) : null;
  redirectIfUnauthenticated(result && !result.ok ? result.kind : undefined);
  const shell = (children: ReactNode) => <AppShell identity={user ? identityOf(user) : null} current="hr-access">{children}</AppShell>;
  if (!user) return shell(<ServiceUnavailable retryHref="/hr-access" />);
  if (!result || !result.ok) {
    if (result?.kind === 'FORBIDDEN') return shell(<Forbidden />);
    if (result?.kind === 'INVALID_RESPONSE') return shell(<UnexpectedResponse retryHref="/hr-access" />);
    return shell(<ServiceUnavailable retryHref="/hr-access" />);
  }
  const data = result.data;
  const q = parsed.query;
  const pageLink = (page: number) => `/hr-access${hrAccessSearch({ ...q, page })}`;
  const sortLink = (sort: 'updatedAt' | 'name' | 'email') => {
    const direction = q.sort === sort ? (q.direction === 'asc' ? 'desc' : 'asc') : sort === 'updatedAt' ? 'desc' : 'asc';
    return `/hr-access${hrAccessSearch({ ...q, sort, direction, page: 1 })}`;
  };
  return shell(
    <>
      <header className="flex max-w-6xl flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">HR Access</h1><p className="mt-1.5 text-[0.9375rem] text-muted-foreground">Who can see which employees</p></div>
        <Link href="/hr-access/new" className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Add HR user</Link>
      </header>
      <form method="get" className="mt-7 max-w-6xl border-y border-line py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 space-y-1 text-sm font-medium">Search by name or exact email<input name="q" defaultValue={q.q} className="mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal" /></label><HrAccessMobileFilters query={q} /><Button type="submit" variant="outline">Search</Button></div>
        <input type="hidden" name="sort" value={q.sort ?? 'updatedAt'} /><input type="hidden" name="direction" value={q.direction ?? 'desc'} /><input type="hidden" name="pageSize" value={q.pageSize ?? 25} />
        <div className="mt-4 hidden grid-cols-1 gap-4 lg:grid lg:grid-cols-4">
          <label className="space-y-1 text-sm font-medium">Role<select name="role" defaultValue={q.role ?? ''} className="mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal"><option value="">All roles</option><option value="ADMIN">Admin HR</option><option value="SCOPED">Scoped HR</option></select></label>
          <label className="space-y-1 text-sm font-medium">Status<select name="status" defaultValue={q.status ?? 'ACTIVE'} className="mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal"><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">Active and inactive</option></select></label>
          <label className="space-y-1 text-sm font-medium">Country scope<select name="country" defaultValue={q.country ?? ''} className="mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal"><option value="">All countries</option><option value="IN">India</option><option value="US">United States</option></select></label>
          <label className="space-y-1 text-sm font-medium">Department scope<select name="department" defaultValue={q.department ?? ''} className="mt-1 block h-10 w-full rounded-md border border-input bg-surface px-3 font-normal"><option value="">All departments</option>{['Tech', 'HR', 'Finance', 'Operations', 'Support'].map((d) => <option key={d}>{d}</option>)}</select></label>
          <Button type="submit" variant="outline" className="w-fit">Apply filters</Button><Link className="self-center text-sm font-medium text-primary underline underline-offset-4" href="/hr-access">Clear filters</Link>
        </div>
      </form>
      {parsed.invalid.length > 0 ? <div role="alert" className="mt-5 max-w-3xl rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-4"><p className="font-semibold">Some filters in this link are not valid</p><p className="mt-1 text-sm">No HR user data was requested for this link.</p><Link href="/hr-access" className="mt-2 inline-block text-sm font-medium underline">Reset filters</Link></div> : null}
      {(q.country || q.department) ? <p className="mt-3 text-sm text-muted-foreground">Admin HR users are included because they can access all employees.</p> : null}
      {q.status !== 'ALL' && q.status !== 'INACTIVE' ? <p className="mt-3 text-sm text-muted-foreground">Inactive users are hidden. <Link href={`/hr-access${hrAccessSearch({ ...q, status: 'ALL', page: 1 })}`} className="font-medium text-primary underline underline-offset-4">Include inactive users</Link></p> : null}
      {data.users.length === 0 ? <section className="mt-6 max-w-3xl border-y border-line py-8"><h2 className="font-semibold">{data.emptyMessage}</h2><Link href="/hr-access" className="mt-2 inline-block text-sm font-medium text-primary underline">Clear filters</Link></section> : <>
        <div className="mt-6 hidden max-w-6xl overflow-x-auto rounded-md border border-line lg:block" tabIndex={0} aria-label="HR users">
          <table className="w-full border-collapse text-left text-[0.8125rem]"><thead className="bg-[#ece8e0] text-xs"><tr>{[['Name','name'],['Email','email'],['Role',null],['Status',null],['Access',null],['Version',null],['Last updated','updatedAt']].map(([label,sort])=><th key={label as string} scope="col" aria-sort={sort ? (q.sort === sort ? (q.direction === 'asc' ? 'ascending':'descending') : 'none') : undefined} className="px-3 py-3 font-semibold">{sort ? <Link href={sortLink(sort as 'name'|'email'|'updatedAt')} className="underline underline-offset-4">{label} {q.sort===sort?(q.direction==='asc'?'↑':'↓'):''}</Link>:label}</th>)}</tr></thead>
            <tbody>{data.users.map((user) => <tr key={user.hrUserId} className="border-t border-line"><td className="px-3 py-3"><Link className="font-semibold text-primary underline underline-offset-4" href={hrUserHref(user.hrUserId,q)}>{user.displayName}</Link></td><td className="px-3 py-3">{user.email}</td><td className="px-3 py-3">{roleLabel(user.role)}</td><td className="px-3 py-3">{statusLabel(user.status)}</td><td className="px-3 py-3">{accessText(user)}</td><td className="px-3 py-3 tabular-nums">{user.version}</td><td className="px-3 py-3">{new Date(user.updatedAt).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})} UTC</td></tr>)}</tbody></table>
        </div>
        <ul className="mt-5 divide-y divide-line border-y border-line lg:hidden">{data.users.map((user)=><li key={user.hrUserId} className="space-y-2 py-4"><Link className="font-semibold text-primary underline underline-offset-4" href={hrUserHref(user.hrUserId,q)}>{user.displayName}</Link><p className="break-all text-sm text-muted-foreground">{user.email}</p><p className="text-sm">{roleLabel(user.role)} · {statusLabel(user.status)}</p><p className="text-sm">{accessText(user)}</p><p className="text-xs text-muted-foreground">Version {user.version} · Updated {new Date(user.updatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p></li>)}</ul>
        <nav aria-label="HR user pages" className="mt-5 flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm"><p>Page {data.page.number} of {data.page.totalPages || 1} · {data.page.totalRows} users</p><div className="flex gap-4"><Link aria-disabled={data.page.number <= 1} className={data.page.number <= 1 ? 'pointer-events-none text-muted-foreground':'font-medium text-primary underline'} href={pageLink(Math.max(1,data.page.number-1))}>Previous</Link><Link aria-disabled={data.page.number >= data.page.totalPages} className={data.page.number >= data.page.totalPages ? 'pointer-events-none text-muted-foreground':'font-medium text-primary underline'} href={pageLink(data.page.number+1)}>Next</Link></div></nav>
      </>}
    </>
  );
}

function Forbidden() { return <section className="max-w-2xl"><h1 className="text-[1.75rem] font-semibold">HR Access</h1><div role="alert" className="mt-6 rounded-md border border-line bg-[#e6ecf8] p-4"><p className="font-semibold">HR Access is available to Admin HR only.</p><Link className="mt-3 inline-block text-sm text-primary underline" href="/employees">Return to Employees</Link></div></section>; }
