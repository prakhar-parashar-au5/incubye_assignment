import 'server-only';

import { cookies } from 'next/headers';

import { sessionCookieName, sessionCookieOptions } from '@/server/cookie-policy';

// Next.js owns the browser cookie; Express owns the session it points to. The cookie holds the
// backend JWT and is HttpOnly, so browser JavaScript can never read it.

export async function readSessionToken(): Promise<string | undefined> {
  const value = (await cookies()).get(sessionCookieName())?.value;
  return value ? value : undefined;
}

/** Only callable from a Server Function or Route Handler. */
export async function setSessionCookie(token: string, expires: Date): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, sessionCookieOptions(expires));
}

/** Only callable from a Server Function or Route Handler. */
export async function clearSessionCookie(): Promise<void> {
  // Repeat the attributes so the browser matches and replaces the same cookie.
  (await cookies()).set(sessionCookieName(), '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}
