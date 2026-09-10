import { isModuleEnabled, moduleForPath } from "@/config/modules";
import type { Permission } from "@/config/permissions";

/**
 * Routes reachable without a session (spec §55).
 *
 * Listed one by one rather than derived from the site navigation. A marketing
 * link is a design decision; a public route is a security one, and deriving the
 * second from the first would mean a stray footer link could open a product
 * route to anonymous visitors.
 *
 * Every page under app/(public)/(site) must appear here, or middleware will
 * send a visitor to /login instead of showing it.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/forgot-password",
  /* Public site (app/(public)/(site)) */
  "/platform",
  "/pricing",
  "/security",
  "/about",
  "/contact",
  "/faq",
  "/privacy",
  "/terms",
] as const;

/** Public routes an authenticated user should never sit on. */
const AUTHED_REDIRECT_ROUTES = ["/login", "/forgot-password"] as const;

export function isPublicRoute(pathname: string): boolean {
  return (PUBLIC_ROUTES as readonly string[]).includes(pathname);
}

export function redirectsWhenAuthenticated(pathname: string): boolean {
  return (AUTHED_REDIRECT_ROUTES as readonly string[]).includes(pathname);
}

/**
 * A module switched off for the company is unreachable, not merely hidden —
 * the same rule the sidebar applies.
 */
export function isRouteDisabledForCompany(pathname: string): boolean {
  const owningModule = moduleForPath(pathname);
  return owningModule ? !isModuleEnabled(owningModule.key) : false;
}

/** Trailing segments that mean "this page writes data". */
const WRITE_SEGMENTS = ["new", "edit", "create", "delete"];

/**
 * Permissions a pathname requires. Returns an empty list for private routes
 * that only need a session, such as /access-denied.
 */
export function requiredPermissions(pathname: string): Permission[] {
  const owningModule = moduleForPath(pathname);
  if (!owningModule) return [];

  const required: Permission[] = [owningModule.viewPermission];

  const segments = pathname.split("/").filter(Boolean);
  const isWriteRoute = segments.some((segment) => WRITE_SEGMENTS.includes(segment));

  // Read-only roles are stopped here: /projects/new needs project.create,
  // which a Viewer never holds (spec §69).
  if (isWriteRoute && owningModule.writePermission) {
    required.push(owningModule.writePermission);
  }

  return required;
}
