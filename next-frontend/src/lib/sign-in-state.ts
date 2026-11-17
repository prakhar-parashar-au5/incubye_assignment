import type { DemoAccountKey } from '@/lib/demo-accounts';

// State returned by the sign-in Server Action to the form. It carries the selected account and a
// public error code only. It never carries the password or any token.

export type SignInErrorCode =
  | 'ACCOUNT_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_REJECTED'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'SERVICE_ERROR';

export type SignInState = {
  account: DemoAccountKey | 'another';
  error?: SignInErrorCode;
};

export const INITIAL_SIGN_IN_STATE: SignInState = { account: 'meera' };

export const SIGN_IN_ERROR_MESSAGES: Record<SignInErrorCode, string> = {
  ACCOUNT_REQUIRED: 'Choose a sign-in option.',
  PASSWORD_REQUIRED: 'Enter your password.',
  PASSWORD_REJECTED: 'Enter a valid password.',
  INVALID_CREDENTIALS: 'That email or password is not correct. Check your details and try again.',
  RATE_LIMITED: 'Too many failed attempts for this account. Wait 15 minutes, then try again.',
  UNAVAILABLE: 'Sign-in is unavailable because the compensation service did not respond. Try again in a moment.',
  NOT_CONFIGURED: 'Sign-in is unavailable because this deployment is not fully configured.',
  SERVICE_ERROR: 'Sign-in failed because of a service error. Try again.',
};

/** Errors that belong to the password field rather than the whole form. */
export function isPasswordError(code: SignInErrorCode | undefined): boolean {
  return code === 'PASSWORD_REQUIRED' || code === 'PASSWORD_REJECTED' || code === 'INVALID_CREDENTIALS';
}
