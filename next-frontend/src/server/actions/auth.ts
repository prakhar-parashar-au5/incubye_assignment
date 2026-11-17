'use server';

import { redirect } from 'next/navigation';

import { findDemoAccount } from '@/lib/demo-accounts';
import type { SignInErrorCode, SignInState } from '@/lib/sign-in-state';
import { api, type ApiFailureKind } from '@/server/api/client';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '@/server/session-cookie';

// Server Actions are public POST endpoints. Each one validates its own input and uses only the
// server-side cookie for authority; nothing from the client is trusted as identity.

const MAX_PASSWORD_LENGTH = 1024;

function loginFailureCode(kind: ApiFailureKind): SignInErrorCode {
  switch (kind) {
    case 'INVALID_CREDENTIALS':
      return 'INVALID_CREDENTIALS';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'VALIDATION_ERROR':
      return 'PASSWORD_REJECTED';
    case 'UNAVAILABLE':
    case 'TIMEOUT':
      return 'UNAVAILABLE';
    case 'CONFIGURATION':
      return 'NOT_CONFIGURED';
    default:
      return 'SERVICE_ERROR';
  }
}

export async function signIn(previous: SignInState, formData: FormData): Promise<SignInState> {
  const selected = formData.get('account');
  const account = findDemoAccount(selected);
  const another = selected === 'another';
  if (!account && !another) return { account: previous.account, error: 'ACCOUNT_REQUIRED' };

  const email = another ? formData.get('email') : account!.email;
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { account: another ? 'another' : account!.key, error: 'INVALID_CREDENTIALS' };
  }

  const password = formData.get('password');
  const mode = another ? 'another' : account!.key;
  if (typeof password !== 'string' || password.length === 0) return { account: mode, error: 'PASSWORD_REQUIRED' };
  if (password.length > MAX_PASSWORD_LENGTH) return { account: mode, error: 'PASSWORD_REJECTED' };

  const result = await api().login({ email, password });
  if (!result.ok) return { account: mode, error: loginFailureCode(result.kind) };

  const expires = new Date(result.data.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    return { account: mode, error: 'SERVICE_ERROR' };
  }

  await setSessionCookie(result.data.token, expires);
  // Outside any try block: redirect() throws to finish the action.
  redirect('/employees');
}

export async function signOut(): Promise<void> {
  const token = await readSessionToken();
  if (token) {
    // Revoke the backend session. The cookie is cleared whatever the outcome, so an unavailable
    // backend never leaves the browser signed in. The failure itself is logged by the client.
    await api().logout(token);
  }
  await clearSessionCookie();
  redirect('/sign-in?reason=signed-out');
}
