/**
 * Platform access (E-06 §19, §20, §74).
 *
 * The Platform Admin works on the NESTO platform itself — creating parent
 * groups, implementing them, handing them over — and holds no membership in any
 * company. These permissions are therefore not part of the business catalogue
 * in `config/permissions.ts`: no company role can be given one, no module
 * ladder reaches one, and no business permission follows from one.
 *
 * Client-safe: no database imports.
 */
export const PLATFORM_PERMISSIONS = [
  "platform.dashboard.view",
  "platform.group.view",
  "platform.group.create",
  "platform.group.configure",
  "platform.group.lifecycle",
  "platform.company.view",
  "platform.company.create",
  "platform.company.configure",
  "platform.project.view",
  "platform.project.manage",
  "platform.implementation.manage",
  "platform.people.view",
  "platform.user.view",
  "platform.user.initial_provision",
  "platform.user.manage",
  "platform.membership.view",
  "platform.membership.manage",
  "platform.access.inspect",
  "platform.session.view",
  "platform.session.revoke",
  "platform.module.view",
  "platform.module.manage",
  "platform.feature_flag.view",
  "platform.feature_flag.manage",
  "platform.pricing.view",
  "platform.pricing.manage",
  "platform.3d.view",
  "platform.3d.configure",
  "platform.3d.model.manage",
  "platform.3d.binding.manage",
  "platform.3d.publish",
  "platform.operations.view",
  "platform.security.view",
  "platform.support.view",
  "platform.support.manage",
  "platform.settings.view",
  "platform.settings.manage",
  "platform.maintenance.manage",
  "platform.group.activate",
  "platform.audit.view",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PLATFORM_ROLE_KEYS = ["PLATFORM_ADMIN"] as const;
export type PlatformRoleKey = (typeof PLATFORM_ROLE_KEYS)[number];

export const platformRolePermissions: Record<PlatformRoleKey, readonly PlatformPermission[]> = {
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS,
};

export function isPlatformRoleKey(value: string): value is PlatformRoleKey {
  return (PLATFORM_ROLE_KEYS as readonly string[]).includes(value);
}

/** The Platform Admin's own area (E-06 §128); never part of a company's sidebar. */
export const PLATFORM_HOME = "/platform-admin";
