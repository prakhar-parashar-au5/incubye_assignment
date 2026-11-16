import 'server-only';

import { cache } from 'react';

import { api, type ApiClient } from '@/server/api/client';
import type { CurrentUserResponse } from '@/server/api/contract';
import { readSessionToken } from '@/server/session-cookie';

// Data access layer for the signed-in HR user. Every call asks the backend, which loads the
// current database session, status, and scopes; nothing is cached across requests.

export type HrUser = {
  displayName: string;
  role: CurrentUserResponse['user']['role'];
  countries: readonly string[];
  departments: readonly string[];
};

export type SessionState =
  | { kind: 'signed-out' }
  /** The cookie exists but the backend rejected it: expired, revoked, or the user is inactive. */
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'signed-in'; user: HrUser };

export async function resolveSession(token: string | undefined, client: ApiClient): Promise<SessionState> {
  if (!token) return { kind: 'signed-out' };
  const result = await client.getCurrentUser(token);
  if (result.ok) {
    // An inactive user is already rejected by the backend; this guards a contract change.
    if (result.data.user.status !== 'ACTIVE') return { kind: 'expired' };
    // Only the fields the UI renders leave this module. The email and IDs stay on the server.
    return {
      kind: 'signed-in',
      user: {
        displayName: result.data.user.displayName,
        role: result.data.user.role,
        countries: result.data.scope.countries,
        departments: result.data.scope.departments,
      },
    };
  }
  if (result.kind === 'UNAUTHENTICATED') return { kind: 'expired' };
  return { kind: 'unavailable' };
}

/** Per-request memoized, so the layout and the page share one backend call. */
export const getSession = cache(async (): Promise<SessionState> => resolveSession(await readSessionToken(), api()));
