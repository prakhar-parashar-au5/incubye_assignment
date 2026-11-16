import 'server-only';

import { redirect } from 'next/navigation';

import { ROLE_LABELS, scopeSummary } from '@/lib/hr-scope';
import type { ApiFailureKind } from '@/server/api/client';
import { getSession, type HrUser, type SessionState } from '@/server/session';
import { readSessionToken } from '@/server/session-cookie';

// Shared handling for protected pages. A page loads the session and its own data in parallel,
// then calls these helpers so every page treats expiry and outages the same way.

export async function loadSessionAndToken(): Promise<{ session: SessionState; token: string | undefined }> {
  const [session, token] = await Promise.all([getSession(), readSessionToken()]);
  return { session, token };
}

/** Redirects for signed-out and rejected sessions; returns the user or `null` when unavailable. */
export function requireUser(session: SessionState): HrUser | null {
  if (session.kind === 'signed-out') redirect('/sign-in');
  // Rendering cannot change cookies; the Route Handler re-checks and clears the cookie.
  if (session.kind === 'expired') redirect('/session/expired');
  return session.kind === 'signed-in' ? session.user : null;
}

/** A data call that reports UNAUTHENTICATED means the session ended between calls. */
export function redirectIfUnauthenticated(...kinds: (ApiFailureKind | undefined)[]): void {
  if (kinds.includes('UNAUTHENTICATED')) redirect('/session/expired');
}

export function identityOf(user: HrUser) {
  return {
    name: user.displayName,
    role: ROLE_LABELS[user.role],
    scope: scopeSummary(user.role, user.countries, user.departments),
  };
}
