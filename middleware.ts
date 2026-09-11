import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth/auth.config";
import { isPublicRoute, redirectsWhenAuthenticated } from "@/lib/permissions/route-access";

/**
 * Session gate (PRD #6 §43, §44).
 *
 * Instantiated from the edge-safe half of the auth config: it reads the session
 * cookie and never touches the database. It answers only "is this person signed
 * in?" — module permissions are resolved server-side by requireModule() inside
 * the route, from the live database, so a revoked membership takes effect
 * immediately and no restricted markup is ever produced (PRD #5 §128).
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const isAuthenticated = Boolean(req.auth?.user?.id);

  if (isPublicRoute(pathname)) {
    const reason = nextUrl.searchParams.get("reason");

    // An authenticated user has no business on /login or /forgot-password —
    // unless a page just sent them here because their session no longer
    // resolves, in which case bouncing them back is an infinite loop.
    //
    // The stale cookie is deliberately left alone rather than cleared here:
    // Auth.js appends its own refreshed session cookie to whatever this
    // middleware returns, so a delete on this response is silently overwritten.
    // It stops mattering the moment they sign in, which replaces it.
    if (isAuthenticated && redirectsWhenAuthenticated(pathname, reason)) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", nextUrl);
    // Remember where they were headed so login can return them there
    // (PRD #6 §10).
    if (pathname !== "/") {
      loginUrl.searchParams.set("callbackUrl", pathname + nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Everything except Auth.js endpoints, Next internals and static assets.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
