import { NextResponse, type NextRequest } from 'next/server';

import { sessionCookieName } from '@/server/cookie-policy';

// Optimistic check only: a request without a session cookie never reaches protected rendering.
// A cookie that exists is still verified by the backend on every protected render.
export function proxy(request: NextRequest) {
  if (request.cookies.get(sessionCookieName())?.value) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/dashboard/:path*', '/employees/:path*', '/assistant/:path*', '/salary-requests/:path*', '/hr-access/:path*'],
};
