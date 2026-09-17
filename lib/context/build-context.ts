import type { ParentGroupStatus, Prisma, User } from "@prisma/client";

import { accessAtLeast, widestScope } from "@/config/access";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { isMutatingPermission, type Permission } from "@/config/permissions";
import { defaultAccessFor, grantPermissions } from "@/config/role-defaults";
import { isMembershipRoleKey, roleLabel, roles, type PositionLevel, type RoleKey } from "@/config/roles";
import { isDevMode, resolveRole } from "@/lib/auth/dev-role";
import { USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import { prisma } from "@/lib/database/prisma";
import {
  assignmentsInCompany,
  grantsInCompany,
  loadOrganizationAccessFor,
  positionFor,
  type ContextAssignment,
  type ContextGrant,
} from "./organization-access";
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
      user: { include: { platformAccess: { select: { status: true } } } },
      membership: {
        include: {
          company: { include: { parentGroup: true } },
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
  // A platform session points at no membership at all. It is a real session,
  // but there is no company in it to build a context for (E-06 §116).
  if (!record.membership || !record.currentCompanyId) {
    if (record.user.status !== "ACTIVE") return { ok: false, reason: "USER_INACTIVE" };
    // Platform access revoked since: the session has nothing left to point at.
    if (record.user.platformAccess?.status !== "ACTIVE") return { ok: false, reason: "SESSION_EXPIRED" };
    return { ok: false, reason: "PLATFORM_SESSION" };
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
  // A suspended or archived group takes every company in it down with it
  // (E-06 §8, §117). A group still being implemented is usable: the people
  // validating it have to be able to sign in (§21).
  if (!isParentGroupUsable(record.membership.company.parentGroup.status)) {
    return { ok: false, reason: "COMPANY_UNAVAILABLE" };
  }

  const storedRoleKey = record.membership.role.key;
  if (!isMembershipRoleKey(storedRoleKey)) {
    // A membership pointing at a role the application does not know — or at the
    // Platform Admin's, which no membership may hold — is a configuration
    // fault, not an access grant.
    return { ok: false, reason: "CONFIGURATION_ERROR" };
  }

  const actualRole: RoleKey = storedRoleKey;
  const role = isDevMode ? resolveRole(actualRole, options.roleOverride) : actualRole;

  const [enabledModules, organization] = await Promise.all([
    resolveEnabledModules(record.membership.companyId),
    loadOrganizationAccessFor(record.membership.company.parentGroupId, record.userId),
  ]);

  const context = assembleContext({
    user: record.user,
    membership: record.membership,
    sessionId: record.id,
    role,
    actualRole,
    enabledModules,
    assignments: organization.assignments,
    grants: organization.grants,
  });

  return { ok: true, context };
}

type MembershipForContext = Prisma.CompanyMemberGetPayload<{
  include: { company: { include: { parentGroup: true } }; department: true };
}>;

/** Groups whose companies may be worked in (E-06 §21). */
export function isParentGroupUsable(status: ParentGroupStatus): boolean {
  return USABLE_GROUP_STATUSES.includes(status);
}

/**
 * The one place a `UserContext` is assembled.
 *
 * The session resolver and `buildMemberContext` both come through here, so "what
 * may this member do?" has one answer whether they are signed in or are being
 * notified, mentioned or checked as a reviewer (PRD #38 §31, §76).
 */
export function assembleContext(input: {
  user: User;
  membership: MembershipForContext;
  sessionId: string;
  role: RoleKey;
  actualRole: RoleKey;
  enabledModules: ModuleKey[];
  assignments: readonly ContextAssignment[];
  grants: readonly ContextGrant[];
}): UserContext {
  const { user, membership, role, actualRole, enabledModules } = input;
  const company = membership.company;
  const assignments = assignmentsInCompany(input.assignments, company.id);
  // A development role override is somebody else's role: it carries no position
  // and no delegated access of the real holder.
  const overridden = role !== actualRole;
  const position: PositionLevel = overridden ? "MEMBER" : positionFor(role, company.id, assignments);
  const grants = overridden ? [] : grantsInCompany(input.grants, company.parentGroupId, company.id);
  const moduleAccess = buildModuleAccess(role, enabledModules, position, grants);

  // A permission for a module the company has switched off is not held at all,
  // so navigation, dashboards and guards all agree without special-casing.
  const permissions = [
    ...new Set(
      Object.values(moduleAccess).flatMap((access) => (access.enabled ? access.permissions : [])),
    ),
  ].sort();

  return {
    userId: user.id,
    companyId: company.id,
    membershipId: membership.id,
    sessionId: input.sessionId,

    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    jobTitle: membership.jobTitle,

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
    department: membership.department
      ? { id: membership.department.id, key: membership.department.key, name: membership.department.name }
      : null,
    parentGroupId: company.parentGroupId,
    parentGroup: {
      id: company.parentGroup.id,
      slug: company.parentGroup.slug,
      name: company.parentGroup.name,
      status: company.parentGroup.status,
    },

    role,
    roleLabel: roleLabel(role),
    position,
    assignments,
    permissions,
    moduleAccess,
    enabledModules,

    actualRole,
    roleIsOverridden: role !== actualRole,
  };
}

/** Company-level module activation (PRD #7 §59). */
/**
 * Exported so anything resolving access outside a session — the notification
 * dispatcher re-checking each recipient — uses this definition rather than its
 * own. Two module-access rules that can disagree is how a notification tells
 * somebody about a module their company switched off.
 */
export async function resolveEnabledModules(companyId: string): Promise<ModuleKey[]> {
  const rows = await prisma.companyModule.findMany({
    where: { companyId, enabled: true },
    include: { module: true },
  });

  const enabled = new Set(rows.map((row) => row.module.key));

  // Dashboard is part of the shell rather than a switchable module.
  return MODULE_KEYS.filter((key) => key === "dashboard" || enabled.has(key));
}

export function buildModuleAccess(
  role: RoleKey,
  enabledModules: readonly ModuleKey[],
  position: PositionLevel = "MEMBER",
  grants: readonly ContextGrant[] = [],
): Record<ModuleKey, ModuleAccess> {
  const enabled = new Set(enabledModules);
  const readOnly = Boolean(roles[role].readOnly);

  return Object.fromEntries(
    MODULE_KEYS.map((moduleKey) => {
      const preset = defaultAccessFor(role, moduleKey, position);
      const moduleEnabled = enabled.has(moduleKey);

      let accessLevel = preset.accessLevel;
      let scope = preset.scope;
      let permissions = preset.permissions as Permission[];

      // Delegated access raises a module to the grant's rung, company-wide or
      // group-wide as it was granted (E-06 §18). It never lowers anything, and a
      // read-only role stays read-only whatever it was handed.
      for (const grant of grants) {
        if (grant.moduleKey !== moduleKey || grant.accessLevel === "NONE") continue;
        if (!accessAtLeast(accessLevel, grant.accessLevel)) accessLevel = readOnly ? "VIEW" : grant.accessLevel;
        scope = widestScope(scope, grant.scopeType === "GROUP" ? "GROUP" : "COMPANY");
        const granted = grantPermissions(moduleKey, grant.accessLevel).filter(
          (permission) => !readOnly || !isMutatingPermission(permission),
        );
        permissions = [...new Set([...permissions, ...granted])].sort();
      }

      const access: ModuleAccess = {
        module: moduleKey,
        accessLevel: moduleEnabled ? accessLevel : "NONE",
        scope,
        permissions: moduleEnabled ? permissions : [],
        enabled: moduleEnabled,
      };

      return [moduleKey, access];
    }),
  ) as Record<ModuleKey, ModuleAccess>;
}
