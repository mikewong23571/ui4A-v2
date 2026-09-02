import { NextResponse, type NextRequest } from 'next/server';

import { BROWSER_SESSION_COOKIE_NAME } from './auth/browser-session';

/** Optimistic UI-only gate; API and business authorization remain at their existing boundaries. */
export function proxy(request: NextRequest): NextResponse {
  if (process.env.UI4A_DEPLOYMENT_PROFILE !== 'production') return NextResponse.next();
  if (request.cookies.has(BROWSER_SESSION_COOKIE_NAME)) return NextResponse.next();

  const login = new URL('/auth/login', request.url);
  login.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/((?!api(?:/|$)|_meta(?:/|$)|\\.well-known(?:/|$)|auth(?:/|$)|_next/static|_next/image|favicon\\.ico$|file\\.svg$|globe\\.svg$|next\\.svg$|vercel\\.svg$|window\\.svg$|ready$|live$|version$).*)',
  ],
};
