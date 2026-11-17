import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { AppShell, AppShellSkeleton } from '@/components/shell/app-shell';
import { ServiceUnavailable, UnexpectedResponse } from '@/components/shell/page-states';
import { accessText, auditActionLabel, countryName, roleLabel, statusLabel } from '@/lib/hr-access';
import { safeReturnPath } from '@/lib/directory-url';
import { api } from '@/server/api/client';
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from '@/server/protected';

export const metadata: Metadata = { title: 'HR user' };
type Props = { params: Promise<{ hrUserId: string }>; searchParams: Promise<{ page?: string; from?: string }> };
export default function HrUserDetailPage(props: Props) { return <Suspense fallback={<AppShellSkeleton><div className="h-8 w-48 rounded bg-muted" /></AppShellSkeleton>}><Detail {...props} /></Suspense>; }
async function Detail({ params, searchParams }: Props) {
  const [{ session, token }, { hrUserId }, search] = await Promise.all([loadSessionAndToken(), params, searchParams]);
  const id = Number(hrUserId);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const page = Number(search.page ?? '1');
  if (!Number.isSafeInteger(page) || page < 1) notFound();
  const user = requireUser(session);
  const detail = token ? await api().getHrUser(token, id) : null;
  const audit = token && detail?.ok ? await api().listHrUserAccessAudit(token, id, { page, pageSize: 25 }) : null;
  redirectIfUnauthenticated(detail && !detail.ok ? detail.kind : undefined, audit && !audit.ok ? audit.kind : undefined);
  const shell = (content: React.ReactNode) => <AppShell identity={user ? identityOf(user) : null} current="hr-access">{content}</AppShell>;
  if (!user) return shell(<ServiceUnavailable retryHref={`/hr-access/${id}`} />);
  if (!detail || !detail.ok) {
    if (detail?.kind === 'FORBIDDEN') return shell(<Forbidden />);
    if (detail?.kind === 'NOT_FOUND') notFound();
    if (detail?.kind === 'INVALID_RESPONSE') return shell(<UnexpectedResponse retryHref={`/hr-access/${id}`} />);
    return shell(<ServiceUnavailable retryHref={`/hr-access/${id}`} />);
  }
  if (!audit || !audit.ok) {
    if (audit?.kind === 'FORBIDDEN') return shell(<Forbidden />);
    if (audit?.kind === 'INVALID_RESPONSE') return shell(<UnexpectedResponse retryHref={`/hr-access/${id}`} />);
    return shell(<ServiceUnavailable retryHref={`/hr-access/${id}`} />);
  }
  const hr = detail.data.hrUser;
  const eventPage = audit.data.page;
  const backHref = safeReturnPath(search.from, ['/hr-access'], '/hr-access');
  return shell(<>
    <Link href={backHref} className="text-sm font-medium text-primary underline underline-offset-4">← HR Access</Link>
    <header className="mt-4 max-w-5xl"><h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em]">{hr.displayName}</h1><p className="mt-1 break-all text-sm text-muted-foreground">{hr.email} · Email cannot be changed</p></header>
    <section aria-labelledby="access-record" className="mt-6 max-w-5xl border-y border-line py-5"><h2 id="access-record" className="text-[0.9375rem] font-semibold">Access record</h2><dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">{[['Role',roleLabel(hr.role)],['Status',statusLabel(hr.status)],['Access',accessText(hr)],['Employees',String(hr.accessibleEmployeeCount)],['Version',String(hr.version)]].map(([term,value])=><div key={term}><dt className="text-xs text-muted-foreground">{term}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div>)}</dl><p className="mt-4 text-xs text-muted-foreground">Created {new Date(hr.createdAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC · Updated {new Date(hr.updatedAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p></section>
    <section className="mt-6 max-w-5xl"><h2 className="text-[0.9375rem] font-semibold">Scope</h2>{hr.role === 'ADMIN' ? <p className="mt-2 text-sm">All employees (Admin HR has no scope rows)</p> : <dl className="mt-3 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Countries</dt><dd className="mt-1 text-sm">{hr.countries.length ? hr.countries.map(countryName).join(', ') : 'None'}</dd></div><div><dt className="text-xs text-muted-foreground">Departments</dt><dd className="mt-1 text-sm">{hr.departments.length ? hr.departments.join(', ') : 'None'}</dd></div></dl>}</section>
    {hr.noAccessMessage ? <p role="status" className="mt-5 max-w-3xl rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-4 text-sm">{hr.noAccessMessage}</p> : null}
    {hr.status === 'INACTIVE' ? <p className="mt-4 max-w-3xl rounded-md border border-line bg-muted-fill p-4 text-sm">Inactive: this account cannot sign in. Reactivation restores its stored role and scope; old sessions are not restored.</p> : null}
    <section aria-labelledby="actions-heading" className="mt-7 max-w-5xl"><h2 id="actions-heading" className="text-[0.9375rem] font-semibold">Actions</h2><nav className="mt-3 flex flex-wrap gap-x-5 gap-y-3 text-sm">{hr.role === 'SCOPED' ? <><Action href={`/hr-access/${id}/scope`}>Change scope</Action><Action href={`/hr-access/${id}/promote`}>Promote to Admin HR</Action></> : null}<Action href={`/hr-access/${id}/name`}>Change display name</Action>{hr.hrUserId !== user.id ? <Action href={`/hr-access/${id}/regenerate-password`}>Regenerate temporary password</Action> : null}{hr.status === 'ACTIVE' ? <Action destructive href={`/hr-access/${id}/deactivate`}>Deactivate access</Action> : <Action href={`/hr-access/${id}/reactivate`}>Reactivate access</Action>}</nav>{hr.hrUserId===user.id?<p className="mt-2 text-sm text-muted-foreground">Ask another active Admin HR user to regenerate your temporary password.</p>:null}</section>
    <section aria-labelledby="history-heading" className="mt-9 max-w-5xl"><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 id="history-heading" tabIndex={-1} className="text-[0.9375rem] font-semibold">Access history</h2><p className="text-xs text-muted-foreground">Access history cannot be changed.</p></div>{audit.data.events.length===0?<p className="mt-4 text-sm text-muted-foreground">No access changes have been recorded.</p>:<ol className="mt-3 divide-y divide-line border-y border-line">{audit.data.events.map((event,index)=><li key={`${event.occurredAt}-${index}`} className="py-4"><div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h3 className="font-semibold">{auditActionLabel(event.action)}</h3><time className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</time></div><p className="mt-1 text-sm">{event.actor?.displayName ?? 'System setup'} · {event.resultingVersion===null?'Version not recorded':`Version ${event.resultingVersion}`}{event.revokedSessionCount!==null?` · ${event.revokedSessionCount} sessions ended`:''}</p>{event.before?<dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Before</dt><dd className="mt-1 text-sm">{event.before.displayName ?? 'Name not recorded'} · {roleLabel(event.before.role)} · {statusLabel(event.before.status)} · {event.before.role === 'ADMIN' ? 'All employees' : event.before.countries.length && event.before.departments.length ? `${event.before.countries.map(countryName).join(', ')} · ${event.before.departments.join(', ')}` : 'No employee access'}</dd></div><div><dt className="text-xs text-muted-foreground">After</dt><dd className="mt-1 text-sm">{event.after.displayName ?? 'Name not recorded'} · {roleLabel(event.after.role)} · {statusLabel(event.after.status)} · {event.after.role === 'ADMIN' ? 'All employees' : event.after.countries.length && event.after.departments.length ? `${event.after.countries.map(countryName).join(', ')} · ${event.after.departments.join(', ')}` : 'No employee access'}</dd></div></dl>:<p className="mt-2 text-sm">After: {event.after.displayName ?? 'Name not recorded'} · {roleLabel(event.after.role)} · {statusLabel(event.after.status)}</p>}{event.reason?<p className="mt-2 text-sm"><span className="text-muted-foreground">Reason: </span>{event.reason}</p>:null}</li>)}</ol>}
      <nav aria-label="Access history pages" className="mt-4 flex justify-between text-sm"><p>Page {eventPage.number} of {eventPage.totalPages||1} · {eventPage.totalRows} events</p><div className="flex gap-4">{eventPage.number>1?<Link className="text-primary underline" href={`/hr-access/${id}?page=${eventPage.number-1}`}>Previous</Link>:<span className="text-muted-foreground">Previous</span>}{eventPage.number<eventPage.totalPages?<Link className="text-primary underline" href={`/hr-access/${id}?page=${eventPage.number+1}`}>Next</Link>:<span className="text-muted-foreground">Next</span>}</div></nav>
    </section>
  </>);
}
function Action({href,children,destructive}:{href:string;children:React.ReactNode;destructive?:boolean}){return <Link href={href} className={destructive?'font-medium text-destructive underline underline-offset-4':'font-medium text-primary underline underline-offset-4'}>{children}</Link>;}
function Forbidden(){return <section><h1 className="text-[1.75rem] font-semibold">HR Access</h1><p role="alert" className="mt-5 rounded-md border border-line bg-[#e6ecf8] p-4">HR Access is available to Admin HR only.</p><Link href="/employees" className="mt-3 inline-block text-sm text-primary underline">Return to Employees</Link></section>;}
