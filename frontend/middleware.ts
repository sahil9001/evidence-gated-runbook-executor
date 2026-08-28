import { NextResponse, type NextRequest } from "next/server";

/** Matches the cookie name set by backend/src/auth/middleware.ts SESSION_COOKIE_NAME. */
const SESSION_COOKIE_NAME = "rp_session";

export const config = {
  matcher: ["/app/:path*"]
};

/**
 * Guards `/app/*` by checking only whether the `rp_session` cookie is
 * PRESENT — this is deliberate, not an oversight.
 *
 * Middleware runs on the edge before any protected content renders, and its
 * only job here is to kill the flash of protected UI: if there is no cookie
 * at all, there is no way the request is authenticated, so bounce to
 * `/login` immediately. It does NOT decode, verify, or otherwise validate
 * the cookie's contents — doing that would mean either shipping session
 * logic twice (duplicating `resolveSession` in `backend/src/auth/session.ts`)
 * or making a network round-trip to the backend on every navigation, both
 * of which are unnecessary: every protected API call still goes through
 * `requireAuth` server-side and returns 401 `unauthenticated` for an
 * invalid or expired session, which `lib/api.ts`'s `request()` turns into a
 * client-side redirect to `/login` anyway (see `redirectToLogin` there).
 *
 * In short: a MISSING cookie is fully handled here. A PRESENT-but-invalid
 * cookie sails through this gate and is caught one layer down. This
 * middleware is a UX optimization against content flash, not an
 * authorization boundary — do not extend it to try to become one.
 */
export function middleware(request: NextRequest): NextResponse {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (hasSession) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}
