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
    // An authenticated user has no business on /login or /forgot-password.
    if (isAuthenticated && redirectsWhenAuthenticated(pathname)) {
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
