import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { can, permissionsForRole, type Permission } from "@/config/permissions";
import type { RoleKey } from "@/config/roles";
import { auth } from "./index";
import { DEV_ROLE_COOKIE, isDevMode, resolveRole } from "./dev-role";
import type { CurrentUser } from "./types";

/**
 * The single source of user context for server components.
 * Wrapped in React `cache` so a request renders one session lookup, not one per
 * component that asks.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser?.id) return null;

  const actualRole = sessionUser.role as RoleKey;

  let role = actualRole;
  if (isDevMode) {
    const cookieStore = await cookies();
    role = resolveRole(actualRole, cookieStore.get(DEV_ROLE_COOKIE)?.value);
  }

  return {
    id: sessionUser.id,
    firstName: sessionUser.firstName,
    lastName: sessionUser.lastName,
    email: sessionUser.email,
    avatar: sessionUser.avatar ?? null,
    companyId: sessionUser.companyId,
    companyName: sessionUser.companyName,
    companySlug: sessionUser.companySlug,
    companyLogo: sessionUser.companyLogo ?? null,
    department: sessionUser.department ?? null,
    jobTitle: sessionUser.jobTitle ?? null,
    role,
    actualRole,
    roleIsOverridden: role !== actualRole,
    permissions: permissionsForRole(role),
  };
});

/** Use in any private page: returns the user or sends them to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Page-level authorisation. Middleware already blocks module routes, but pages
 * call this too so that a route added without a middleware rule still fails
 * closed rather than open.
 */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/access-denied");
  return user;
}
