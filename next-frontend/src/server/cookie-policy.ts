// Session cookie policy. Pure functions with no `server-only` marker so that `src/proxy.ts` can
// share the cookie name. Never import this from a Client Component.
//
// In production the `__Host-` prefix makes the browser refuse the cookie unless it is Secure,
// has Path=/, and has no Domain attribute, so a sibling subdomain cannot overwrite it.

type Env = Readonly<Record<string, string | undefined>>;

export function isProductionCookie(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function sessionCookieName(env: Env = process.env): string {
  return isProductionCookie(env) ? '__Host-acme_session' : 'acme_session';
}

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  expires: Date;
};

export function sessionCookieOptions(expires: Date, env: Env = process.env): SessionCookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isProductionCookie(env), path: '/', expires };
}
