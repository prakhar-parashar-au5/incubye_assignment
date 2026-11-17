import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { AppShell, AppShellSkeleton } from '@/components/shell/app-shell';
import { HR_ACCESS_SERVICE } from '@/lib/hr-access';
import { ServiceUnavailable, UnexpectedResponse } from '@/components/shell/page-states';
import { HrAccessWorkspace } from '@/app/hr-access/hr-access-workspace';
import type { HrAccessOperation } from '@/server/actions/hr-access';
import { api } from '@/server/api/client';
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from '@/server/protected';

export const metadata: Metadata = { title: 'Change HR access' };
const operations: Record<string,HrAccessOperation> = { name:'PROFILE', scope:'SCOPES', promote:'PROMOTE', deactivate:'DEACTIVATE', reactivate:'REACTIVATE', 'regenerate-password':'REGENERATE_PASSWORD' };
type Props = { params: Promise<{hrUserId:string;operation:string}> };
export default function HrUserOperationPage(props:Props){return <Suspense fallback={<AppShellSkeleton><div className="h-8 w-48 rounded bg-muted" /></AppShellSkeleton>}><OperationPage {...props}/></Suspense>;}
async function OperationPage({params}:Props){
  const [{session,token},{hrUserId,operation:slug}]=await Promise.all([loadSessionAndToken(),params]);
  const id=Number(hrUserId);if(!Number.isSafeInteger(id)||id<1||!operations[slug])notFound();
  const user=requireUser(session);
  const result=token?await api().getHrUser(token,id):null;
  redirectIfUnauthenticated(result&&!result.ok?result.kind:undefined);
  const shell=(children:ReactNode)=><AppShell identity={user?identityOf(user):null} current="hr-access">{children}</AppShell>;
  if(!user)return shell(<ServiceUnavailable retryHref={`/hr-access/${id}/${slug}`} service={HR_ACCESS_SERVICE} />);
  if(!result||!result.ok){
    if(result?.kind==='FORBIDDEN')return shell(<Forbidden/>);
    if(result?.kind==='NOT_FOUND')notFound();
    if(result?.kind==='INVALID_RESPONSE')return shell(<UnexpectedResponse retryHref={`/hr-access/${id}/${slug}`}/>);
    return shell(<ServiceUnavailable retryHref={`/hr-access/${id}/${slug}`} service={HR_ACCESS_SERVICE} />);
  }
  const hr=result.data.hrUser;
  if(slug==='regenerate-password'&&hr.hrUserId===user.id)return shell(<section className="max-w-2xl"><h1 className="text-[1.75rem] font-semibold">Regenerate temporary password</h1><p role="alert" className="mt-5 rounded-md border border-[#e5cf9f] bg-[#fbf4e4] p-4">Ask another active Admin HR user to regenerate your temporary password.</p><Link href={`/hr-access/${id}`} className="mt-4 inline-block text-sm text-primary underline">Return to HR user</Link></section>);
  return shell(<HrAccessWorkspace operation={operations[slug]} user={hr} self={hr.hrUserId===user.id}/>);
}
function Forbidden(){return <section><h1 className="text-[1.75rem] font-semibold">HR Access</h1><p role="alert" className="mt-5 rounded-md border border-line bg-[#e6ecf8] p-4">HR Access is available to Admin HR only.</p><Link href="/employees" className="mt-3 inline-block text-sm text-primary underline">Return to Employees</Link></section>;}
