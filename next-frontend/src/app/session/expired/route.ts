import { redirect } from 'next/navigation';

import { api } from '@/server/api/client';
import { resolveSession } from '@/server/session';
import { clearSessionCookie, readSessionToken } from '@/server/session-cookie';

// Protected pages cannot change cookies while rendering, so when the backend rejects the session
// they redirect here. The handler asks the backend again and clears the cookie only when the
// backend confirms the session is no longer valid. A cross-site link to this URL therefore cannot
// sign out a user whose session is still valid.
export async function GET() {
  const state = await resolveSession(await readSessionToken(), api());
  if (state.kind === 'signed-in' || state.kind === 'unavailable') redirect('/employees');
  if (state.kind === 'expired') await clearSessionCookie();
  redirect('/sign-in?reason=session-expired');
}
