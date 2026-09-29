import { ROLE_KEYS, type RoleKey } from "@/config/roles";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Options for the invite and membership forms (PRD #14 §61, §95, §221).
 *
 * The Owner role is offered only to somebody who holds `team.owner.assign`, so
 * the picker cannot name a role the service would then refuse. This is a UX
 * hint and nothing more: `assertRoleChangeAllowed` re-checks the same grant on
 * every write (PRD #14 §96, §148).
 *
 * Platform Admin is never offered: it is not a role anybody holds in a
 * company (E-06 §19).
 *
 * Departments exclude archived ones for the same reason — a form should not
 * offer a relationship that validation rejects (PRD #14 §127).
 */
export async function teamFormOptions(context: UserContext) {
  const mayAssignOwner = can(context, "team.owner.assign");
  // Group IT is group authority, offered only to whoever may give it.
  const excluded = ["PLATFORM_ADMIN"];
  if (!mayAssignOwner) excluded.push("OWNER");
  if (!can(context, "team.group_role.assign")) excluded.push("GROUP_IT");

  const [roles, departments] = await Promise.all([
    prisma.role.findMany({
      where: { key: { notIn: excluded } },
      select: { id: true, key: true, name: true },
    }),
    prisma.department.findMany({
      where: { companyId: context.companyId, status: { not: "ARCHIVED" }, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // The spec's own role order, not alphabetical: Owner reads above Viewer
  // because that is how people think about the ladder (config/roles.ts).
  const rank = (key: string) => {
    const index = ROLE_KEYS.indexOf(key as RoleKey);
    return index === -1 ? ROLE_KEYS.length : index;
  };

  return {
    roles: roles
      .slice()
      .sort((a, b) => rank(a.key) - rank(b.key))
      .map((role) => ({ value: role.id, label: role.name })),
    departments: departments.map((department) => ({
      value: department.id,
      label: department.name,
    })),
    mayAssignOwner,
  };
}

/**
 * Members who can manage a department (PRD #14 §117).
 *
 * Only active members: naming somebody who no longer has access as department
 * manager is how an org chart quietly stops matching reality (PRD #14 §248).
 */
export async function departmentManagerOptions(context: UserContext) {
  const members = await prisma.companyMember.findMany({
    where: { companyId: context.companyId, status: "ACTIVE" },
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
      role: { select: { name: true } },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
  });

  return members.map((member) => ({
    value: member.id,
    label: `${member.user.firstName} ${member.user.lastName} — ${member.role.name}`,
  }));
}
