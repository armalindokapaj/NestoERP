import { accessAtLeast, hasModuleAccess, type AccessLevel, type DataScope } from "@/config/access";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { ModuleAccess, UserContext } from "@/lib/context/types";

/**
 * The permission helpers (PRD #5 §56).
 *
 * Feature code asks `can(context, "project.create")` and never inspects a role
 * name (PRD #5 §8, PRD #10 §11). Everything here is pure so it can be unit
 * tested without a database or a session.
 */

/** Anything carrying a permission list — a full context or a bare array. */
export type AccessHolder =
  | Pick<UserContext, "permissions" | "moduleAccess">
  | { permissions: readonly Permission[] }
  | null
  | undefined;

function permissionsOf(holder: AccessHolder): readonly Permission[] {
  if (!holder) return [];
  return holder.permissions ?? [];
}

export function can(holder: AccessHolder, permission: Permission): boolean {
  return permissionsOf(holder).includes(permission);
}

export function canAny(holder: AccessHolder, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(holder, permission));
}

export function canAll(holder: AccessHolder, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => can(holder, permission));
}

function moduleAccessOf(holder: AccessHolder, moduleKey: ModuleKey): ModuleAccess | null {
  if (!holder || !("moduleAccess" in holder) || !holder.moduleAccess) return null;
  return holder.moduleAccess[moduleKey] ?? null;
}

export function canAccessModule(holder: AccessHolder, moduleKey: ModuleKey): boolean {
  const access = moduleAccessOf(holder, moduleKey);
  return access ? access.enabled && hasModuleAccess(access.accessLevel) : false;
}

/** True when the company has switched the module off (PRD #7 §59). */
export function isModuleEnabled(holder: AccessHolder, moduleKey: ModuleKey): boolean {
  return moduleAccessOf(holder, moduleKey)?.enabled ?? false;
}

export function getAccessLevel(holder: AccessHolder, moduleKey: ModuleKey): AccessLevel {
  const access = moduleAccessOf(holder, moduleKey);
  if (!access || !access.enabled) return "NONE";
  return access.accessLevel;
}

export function getModuleScope(holder: AccessHolder, moduleKey: ModuleKey): DataScope {
  return moduleAccessOf(holder, moduleKey)?.scope ?? "SELF";
}

export function hasAccessLevel(
  holder: AccessHolder,
  moduleKey: ModuleKey,
  minimum: AccessLevel,
): boolean {
  return accessAtLeast(getAccessLevel(holder, moduleKey), minimum);
}

/**
 * A read-only experience: the user may open the module but must not be offered
 * any mutation (PRD #5 §27, PRD #7 §54).
 */
export function isReadOnly(holder: AccessHolder, moduleKey: ModuleKey): boolean {
  return getAccessLevel(holder, moduleKey) === "VIEW";
}
