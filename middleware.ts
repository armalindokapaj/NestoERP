import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { permissionsForRole } from "@/config/permissions";
import type { RoleKey } from "@/config/roles";
import { authConfig } from "@/lib/auth/auth.config";
import { DEV_ROLE_COOKIE, isDevMode, resolveRole } from "@/lib/auth/dev-role";
import {
  isPublicRoute,
  isRouteDisabledForCompany,
  redirectsWhenAuthenticated,
  requiredPermissions,
} from "@/lib/permissions/route-access";

/**
 * Route protection (spec §55).
 *
 * Instantiated from the edge-safe half of the auth config: middleware reads the
 * session token and the role configuration, and never touches the database.
 */
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const sessionUser = req.auth?.user;
  const isAuthenticated = Boolean(sessionUser?.id);

  if (isPublicRoute(pathname)) {
    // An authenticated user has no business on /login or /forgot-password.
    if (isAuthenticated && redirectsWhenAuthenticated(pathname)) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  if (!isAuthenticated) {
    const loginUrl = new URL("/login", nextUrl);
    // Remember where they were headed so login can return them there.
    if (pathname !== "/") {
      loginUrl.searchParams.set("callbackUrl", pathname + nextUrl.search);
    }
    return NextResponse.redirect(loginUrl);
  }

  const actualRole = sessionUser!.role as RoleKey;
  const role = isDevMode
    ? resolveRole(actualRole, req.cookies.get(DEV_ROLE_COOKIE)?.value)
    : actualRole;

  const permissions = permissionsForRole(role);
  const required = requiredPermissions(pathname);
  const allowed =
    !isRouteDisabledForCompany(pathname) &&
    required.every((permission) => permissions.includes(permission));

  if (!allowed) {
    return NextResponse.rewrite(new URL("/access-denied", nextUrl));
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
