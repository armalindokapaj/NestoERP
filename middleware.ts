import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/lib/auth/auth.config";
import {
  buildContentSecurityPolicy,
  CSP_NONCE_HEADER,
  newCspNonce,
} from "@/lib/core/security/csp";
import { REQUEST_PATH_HEADER } from "@/lib/core/security/request-path";
import { isPublicRoute, redirectsWhenAuthenticated } from "@/lib/permissions/route-access";

/**
 * Session gate (PRD #6 §43, §44).
 *
 * Instantiated from the edge-safe half of the auth config: it reads the session
 * cookie and never touches the database. It answers only "is this person signed
 * in?" — module permissions are resolved server-side by requireModule() inside
 * the route, from the live database, so a revoked membership takes effect
 * immediately and no restricted markup is ever produced (PRD #5 §128).
 *
 * It also mints the per-request CSP nonce (PRD #30 §108). That has to happen
 * here rather than in `next.config.ts`, because a nonce that is the same on
 * every response is not a nonce — and `script-src 'self'` with no nonce at all
 * blocks Next's own bootstrap scripts and leaves the page blank.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const isAuthenticated = Boolean(req.auth?.user?.id);

  const nonce = newCspNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isProduction: process.env.NODE_ENV === "production",
    mapboxEnabled: Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN),
  });

  /*
   * The policy goes on the *request* as well as the response: Next reads it
   * from there to decide which nonce to stamp onto its script tags. Without
   * this, the response header would name a nonce no script carries.
   */
  const forwarded = new Headers(req.headers);
  forwarded.set(CSP_NONCE_HEADER, nonce);
  forwarded.set("Content-Security-Policy", csp);
  // Always overwritten, so a client cannot choose it (E-05A §34).
  forwarded.set(REQUEST_PATH_HEADER, pathname + nextUrl.search);
  forwarded.set("x-nesto-request-method", req.method);

  const proceed = () => {
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

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
    return proceed();
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

  return proceed();
});

export const config = {
  matcher: [
    /*
     * Everything except Auth.js endpoints, Next internals and static assets.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
