import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/config';
import { atLeast, isRole } from '@/lib/auth/roles';
import { NAV } from '@/lib/nav';

/**
 * The gate. Every route is private unless it is named below.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`; the
 * semantics are unchanged.
 *
 * This is the whole point of the port: the legacy tool's passcode screen was
 * dead code — `doLogin()` referenced #gateLogin / #loginName / #loginPin, none
 * of which existed in the DOM, and `enterApp()` merely hid a div. Anyone with
 * the URL held a Supabase anon key with full read/write on every table.
 *
 * Uses the edge-safe half of the Auth.js config: no adapter, no Prisma, so this
 * runs in the Edge runtime as middleware must.
 */
const { auth } = NextAuth(authConfig);

/** Paths that must resolve without a session. */
const PUBLIC_PATHS = ['/login'];

/** The print agent authenticates with a bearer token, not a session cookie. */
const AGENT_API_PREFIX = '/api/print-jobs';

/**
 * Route -> minimum role, read from the same list the tab bar is built from, so
 * a tab that is hidden is also a route that is closed. The layout filters NAV
 * for display; this is the half that actually enforces it.
 */
function requiredRole(pathname: string) {
  return NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.minRole;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    // A signed-in user landing on /login goes straight through to the app.
    if (req.auth) return NextResponse.redirect(new URL('/catalog', req.nextUrl));
    return NextResponse.next();
  }

  // Checked inside the route handler, which can reach the database.
  if (pathname.startsWith(AGENT_API_PREFIX)) return NextResponse.next();

  if (req.auth) {
    const minimum = requiredRole(pathname);
    const role = req.auth.user?.role;
    if (minimum && !atLeast(isRole(role) ? role : undefined, minimum)) {
      // Send them somewhere they can actually be rather than showing a 403 they
      // can do nothing about. Catalog is visible to every role.
      const home = new URL('/catalog', req.nextUrl);
      home.searchParams.set('denied', pathname);
      return NextResponse.redirect(home);
    }
    return NextResponse.next();
  }

  // An unauthenticated API call gets 401 JSON, not an HTML login page — a
  // redirect here would show up as a mystifying parse error at the caller.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const login = new URL('/login', req.nextUrl);
  // Preserve where they were headed, so sign-in returns them there.
  if (pathname !== '/') login.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
});

export const config = {
  matcher: [
    /*
     * Everything except Next's own internals and static assets. Auth.js's own
     * endpoints are excluded so sign-in is not gated behind being signed in.
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|logo.png|logo-small.png|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)',
  ],
};
