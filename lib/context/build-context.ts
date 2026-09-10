import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { permissionsForRole, roleModuleAccess } from "@/config/role-defaults";
import { isRoleKey, roleLabel, type RoleKey } from "@/config/roles";
import { isDevMode, resolveRole } from "@/lib/auth/dev-role";
import { prisma } from "@/lib/database/prisma";
import type { ContextResult, ModuleAccess, UserContext } from "./types";

/**
 * Builds the context from a session id alone.
 *
 * Separated from the cookie-reading entry point above so that integration tests
 * can exercise the real resolver — real database, real membership, real role,
 * real permissions — rather than mocking the authorisation they exist to verify
 * (PRD #9 §223).
 */
export async function resolveContextForSession(
  sessionId: string,
  options: { expectedUserId?: string; roleOverride?: string | null } = {},
): Promise<ContextResult> {
  // The signed cookie carries only a session id. Validity, membership and
  // company are re-read from the database on every request, so revoking a
  // session or a membership takes effect immediately (PRD #6 §79, §113).
  const record = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: true,
      membership: {
        include: {
          company: true,
          role: true,
          department: true,
        },
      },
    },
  });

  if (!record) return { ok: false, reason: "SESSION_EXPIRED" };
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  // Never trust a session id on its own: the row must still describe the same
  // user and the same company as the membership it points at (PRD #6 §129A).
  if (options.expectedUserId && record.userId !== options.expectedUserId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (record.membership.userId !== record.userId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }
  if (record.membership.companyId !== record.currentCompanyId) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };
  if (record.membership.status !== "ACTIVE") {
    return { ok: false, reason: "MEMBERSHIP_INACTIVE" };
  }
  if (record.membership.company.status !== "ACTIVE") {
    return { ok: false, reason: "COMPANY_UNAVAILABLE" };
  }

  const storedRoleKey = record.membership.role.key;
  if (!isRoleKey(storedRoleKey)) {
    // A membership pointing at a role the application does not know is a
    // configuration fault, not an access grant.
    return { ok: false, reason: "CONFIGURATION_ERROR" };
  }

  const actualRole: RoleKey = storedRoleKey;
  const role = isDevMode ? resolveRole(actualRole, options.roleOverride) : actualRole;

  const enabledModules = await resolveEnabledModules(record.membership.companyId);
  const moduleAccess = buildModuleAccess(role, enabledModules);

  // A permission for a module the company has switched off is not held at all,
  // so navigation, dashboards and guards all agree without special-casing.
  const permissions = permissionsForRole(role).filter((permission) =>
    Object.values(moduleAccess).some(
      (access) => access.enabled && access.permissions.includes(permission),
    ),
  );

  const company = record.membership.company;
  const user = record.user;

  const context: UserContext = {
    userId: user.id,
    companyId: company.id,
    membershipId: record.membershipId,
    sessionId: record.id,

    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    jobTitle: record.membership.jobTitle,

    company: {
      id: company.id,
      slug: company.slug,
      name: company.name,
      legalName: company.legalName,
      logoUrl: company.logoUrl,
      industry: company.industry,
      country: company.country,
      address: company.address,
      email: company.email,
      phone: company.phone,
      website: company.website,
    },
    department: record.membership.department
      ? {
          id: record.membership.department.id,
          key: record.membership.department.key,
          name: record.membership.department.name,
        }
      : null,

    role,
    roleLabel: roleLabel(role),
    permissions,
    moduleAccess,
    enabledModules,

    actualRole,
    roleIsOverridden: role !== actualRole,
  };

  return { ok: true, context };
}

/** Company-level module activation (PRD #7 §59). */
async function resolveEnabledModules(companyId: string): Promise<ModuleKey[]> {
  const rows = await prisma.companyModule.findMany({
    where: { companyId, enabled: true },
    include: { module: true },
  });

  const enabled = new Set(rows.map((row) => row.module.key));

  // Dashboard is part of the shell rather than a switchable module.
  return MODULE_KEYS.filter((key) => key === "dashboard" || enabled.has(key));
}

function buildModuleAccess(
  role: RoleKey,
  enabledModules: readonly ModuleKey[],
): Record<ModuleKey, ModuleAccess> {
  const enabled = new Set(enabledModules);

  return Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => {
      const preset = roleModuleAccess[role][moduleKey];
      const moduleEnabled = enabled.has(moduleKey);

      const access: ModuleAccess = {
        module: moduleKey,
        accessLevel: moduleEnabled ? preset.accessLevel : "NONE",
        scope: preset.scope,
        permissions: moduleEnabled ? (preset.permissions as Permission[]) : [],
        enabled: moduleEnabled,
      };

      return [moduleKey, access];
    }),
  ) as Record<ModuleKey, ModuleAccess>;
}
