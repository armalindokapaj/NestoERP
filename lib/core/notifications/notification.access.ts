import type { Permission } from "@/config/permissions";
import type { ModuleKey } from "@/config/modules";
import { permissionsForRole } from "@/config/role-defaults";
import { isRoleKey, type RoleKey } from "@/config/roles";
import { buildModuleAccess, resolveEnabledModules } from "@/lib/context/build-context";
import { prisma } from "@/lib/database/prisma";
import type { ModuleAccess } from "@/lib/context/types";

/**
 * Access for a recipient who is not the person making the request
 * (PRD #25 §37, §42, §49).
 *
 * A notification is written on behalf of somebody who is not signed in, so
 * there is no session to resolve and `can(context, …)` has no context to use.
 * This builds the same shape `can()` accepts — permissions plus module access —
 * from the member's role and the company's enabled modules, using the *same*
 * functions the session resolver uses.
 *
 * That reuse is the point. A notification is a message about a record, and the
 * question "may this person see this record?" must be answered identically
 * whether they are reading a page or being told about it. A second copy of the
 * rule here would drift, and the direction it drifts in is a disclosure.
 */

export type RecipientAccess = {
  memberId: string;
  permissions: readonly Permission[];
  moduleAccess: Record<ModuleKey, ModuleAccess>;
};

/**
 * Resolves access for several members at once.
 *
 * Suspended, inactive and invited memberships are dropped rather than returned
 * with empty permissions: somebody whose access has been revoked should not be
 * receiving notifications at all, and treating that as "no permissions" would
 * hide the distinction (PRD #25 §42).
 */
export async function resolveRecipientAccess(
  companyId: string,
  memberIds: readonly string[],
): Promise<Map<string, RecipientAccess>> {
  const unique = [...new Set(memberIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const [members, enabledModules] = await Promise.all([
    prisma.companyMember.findMany({
      where: { id: { in: unique }, companyId, status: "ACTIVE" },
      select: { id: true, role: { select: { key: true } } },
    }),
    resolveEnabledModules(companyId),
  ]);

  const resolved = new Map<string, RecipientAccess>();

  for (const member of members) {
    if (!isRoleKey(member.role.key)) continue; // Unknown role is not a grant.
    const role: RoleKey = member.role.key;

    const moduleAccess = buildModuleAccess(role, enabledModules);

    // The same filter the session resolver applies: a permission for a module
    // the company has switched off is not held at all.
    const permissions = permissionsForRole(role).filter((permission) =>
      Object.values(moduleAccess).some(
        (access) => access.enabled && access.permissions.includes(permission),
      ),
    );

    resolved.set(member.id, { memberId: member.id, permissions, moduleAccess });
  }

  return resolved;
}
