import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { AppShell, AppShellSkeleton } from '@/components/shell/app-shell';
import { ServiceUnavailable } from '@/components/shell/page-states';
import { HrAccessWorkspace } from '@/app/hr-access/hr-access-workspace';
import { api } from '@/server/api/client';
import { identityOf, loadSessionAndToken, redirectIfUnauthenticated, requireUser } from '@/server/protected';

export const metadata: Metadata = { title: 'Add HR user' };
export default function NewHrUserPage() { return <Suspense fallback={<AppShellSkeleton><div className="h-8 w-48 rounded bg-muted" /></AppShellSkeleton>}><NewUser /></Suspense>; }
async function NewUser() {
  const { session, token } = await loadSessionAndToken();
  const user = requireUser(session);
  // A direct Scoped HR URL relies on the backend's authorization response; no HR-user data is read.
  const authorization = token ? await api().listHrUsers(token,{page:1,pageSize:1}) : null;
  redirectIfUnauthenticated(authorization && !authorization.ok ? authorization.kind : undefined);
  if (!user) return <AppShell identity={null}><ServiceUnavailable retryHref="/hr-access/new" /></AppShell>;
  if (authorization && !authorization.ok && authorization.kind==='FORBIDDEN') return <AppShell identity={identityOf(user)}><Forbidden /></AppShell>;
  if (!authorization?.ok) return <AppShell identity={identityOf(user)}><ServiceUnavailable retryHref="/hr-access/new" /></AppShell>;
  return <AppShell identity={identityOf(user)} current="hr-access"><HrAccessWorkspace operation="CREATE" /></AppShell>;
}
function Forbidden(){return <section><h1 className="text-[1.75rem] font-semibold">HR Access</h1><p role="alert" className="mt-5 rounded-md border border-line bg-[#e6ecf8] p-4">HR Access is available to Admin HR only.</p><Link href="/employees" className="mt-3 inline-block text-sm text-primary underline">Return to Employees</Link></section>;}
