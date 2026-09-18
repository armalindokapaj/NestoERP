import { z } from "zod";

import type { AccessLevel, DataScope } from "@/config/access";
import { MODULE_KEYS, modules as moduleRegistry, type ModuleKey } from "@/config/modules";
import { isPermission, moduleForPermission } from "@/config/permissions";
import { defaultAccessFor } from "@/config/role-defaults";
import { isMembershipRoleKey, positionLabels, roleLabel, type PositionLevel } from "@/config/roles";
import { assertPermission, AccessError } from "@/lib/access/guards";
import { USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import { buildMemberContext } from "@/lib/context/member-context";
import { assignmentsInCompany, grantsInCompany, loadOrganizationAccessFor, positionFor } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Why somebody can or cannot do something in a company (E-06 §73, E-08 §29).
 *
 * The effective-access formula has many inputs — account, membership, company,
 * group, role, position, delegated grants, module switches — and when a person
 * says "I cannot open Finance in Terra" the answer is one of them. This names
 * which, for those who keep access (`organization.access.view`: the Owner and
 * Group IT). The effective column is the real resolver's answer, built through
 * the same `assembleContext` a session uses, so this page cannot disagree with
 * what the person actually meets.
 *
 * It explains; it changes nothing, and it never lists another group's people.
 */

export const accessCheckQuerySchema = z.object({
  userId: z.string().trim().min(1).max(64),
  /** The company to check them in: any of the reader's group. */
  targetCompanyId: z.string().trim().min(1).max(64),
  permission: z.string().trim().max(120).optional(),
});
export type AccessCheckQuery = z.infer<typeof accessCheckQuerySchema>;

export type AccessBlocker = { code: "USER_INACTIVE" | "NO_MEMBERSHIP" | "MEMBERSHIP_INACTIVE" | "COMPANY_INACTIVE" | "GROUP_UNAVAILABLE" | "UNKNOWN_ROLE"; message: string };

export type ModuleAccessSource = "ROLE" | "POSITION" | "GRANT" | "DISABLED" | "NONE" | "BLOCKED";

export type ModuleDiagnosisDTO = {
  key: ModuleKey;
  label: string;
  enabled: boolean;
  role: { accessLevel: AccessLevel; scope: DataScope };
  position: { accessLevel: AccessLevel; scope: DataScope };
  effective: { accessLevel: AccessLevel; scope: DataScope };
  source: ModuleAccessSource;
};

export type AccessDiagnosisDTO = {
  person: { userId: string; name: string; username: string; accountStatus: string };
  company: { id: string; name: string; status: string };
  group: { name: string; status: string };
  membership: { id: string; status: string; role: { key: string; label: string } } | null;
  blockers: AccessBlocker[];
  position: { level: PositionLevel; label: string; heldThrough: Array<{ department: string; level: string; where: string }> };
  grants: Array<{ id: string; moduleKey: string; moduleLabel: string; scope: "GROUP" | "COMPANY"; accessLevel: AccessLevel }>;
  modules: ModuleDiagnosisDTO[];
  permission: { key: string; known: boolean; moduleKey: string | null; held: boolean; reason: "HELD" | "BLOCKED" | "MODULE_DISABLED" | "NOT_IN_ACCESS" | "UNKNOWN_PERMISSION" } | null;
};

const NONE = { accessLevel: "NONE" as AccessLevel, scope: "SELF" as DataScope };

function moduleLabel(key: string): string {
  return (moduleRegistry as Record<string, { label: string } | undefined>)[key]?.label ?? key;
}

/** Candidates for the check form: everybody who works in the group, and its companies. */
export async function accessCheckOptions(context: UserContext) {
  assertPermission(context, "organization.access.view");
  const [companies, members] = await Promise.all([
    prisma.company.findMany({ where: { parentGroupId: context.parentGroupId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.companyMember.findMany({
      where: { company: { parentGroupId: context.parentGroupId } },
      select: { userId: true, user: { select: { firstName: true, lastName: true, username: true } } },
    }),
  ]);
  const people = new Map<string, { userId: string; name: string; username: string }>();
  for (const member of members) people.set(member.userId, { userId: member.userId, name: `${member.user.firstName} ${member.user.lastName}`, username: member.user.username });
  return { companies, people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function diagnoseAccess(context: UserContext, query: AccessCheckQuery): Promise<AccessDiagnosisDTO> {
  assertPermission(context, "organization.access.view");

  // Both ends inside the reader's group, or nothing is said about either.
  const [company, user] = await Promise.all([
    prisma.company.findFirst({ where: { id: query.targetCompanyId, parentGroupId: context.parentGroupId }, select: { id: true, name: true, status: true, parentGroup: { select: { name: true, status: true } } } }),
    prisma.user.findFirst({
      where: { id: query.userId, memberships: { some: { company: { parentGroupId: context.parentGroupId } } } },
      select: { id: true, firstName: true, lastName: true, username: true, status: true },
    }),
  ]);
  if (!company || !user) throw new AccessError("NOT_FOUND");

  const membership = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    select: { id: true, status: true, role: { select: { key: true, name: true } } },
  });

  const blockers: AccessBlocker[] = [];
  if (user.status !== "ACTIVE") blockers.push({ code: "USER_INACTIVE", message: `The account is ${user.status.toLowerCase()}: it cannot sign in anywhere.` });
  if (!membership) blockers.push({ code: "NO_MEMBERSHIP", message: `${user.firstName} has no membership in ${company.name}.` });
  else if (membership.status !== "ACTIVE") blockers.push({ code: "MEMBERSHIP_INACTIVE", message: `The membership in ${company.name} is ${membership.status.toLowerCase()}.` });
  if (company.status !== "ACTIVE") blockers.push({ code: "COMPANY_INACTIVE", message: `${company.name} is ${company.status.toLowerCase()}.` });
  if (!USABLE_GROUP_STATUSES.includes(company.parentGroup.status)) blockers.push({ code: "GROUP_UNAVAILABLE", message: `The group is ${company.parentGroup.status.toLowerCase()}.` });
  const role = membership && isMembershipRoleKey(membership.role.key) ? membership.role.key : null;
  if (membership && !role) blockers.push({ code: "UNKNOWN_ROLE", message: `The membership holds a role NESTO does not know (${membership.role.key}).` });

  const organization = await loadOrganizationAccessFor(context.parentGroupId, user.id);
  const assignments = assignmentsInCompany(organization.assignments, company.id);
  const position: PositionLevel = role ? positionFor(role, company.id, assignments) : "MEMBER";
  const heldThrough = assignments
    .filter((assignment) => assignment.positionLevel !== "MEMBER" && assignment.functionalRoleKey === role)
    .map((assignment) => ({
      department: assignment.groupDepartmentName,
      level: positionLabels[assignment.positionLevel as PositionLevel],
      where: assignment.companyId === null ? "Group" : company.name,
    }));
  const grants = grantsInCompany(organization.grants, context.parentGroupId, company.id);

  // The real resolver, when there is anything to resolve.
  const effectiveContext = blockers.length === 0 && membership ? await buildMemberContext(company.id, membership.id) : null;

  const modules: ModuleDiagnosisDTO[] = MODULE_KEYS.filter((key) => key !== "dashboard").map((key) => {
    const byRole = role ? defaultAccessFor(role, key, "MEMBER") : null;
    const byPosition = role ? defaultAccessFor(role, key, position) : null;
    const effective = effectiveContext?.moduleAccess[key];
    const enabled = effectiveContext ? Boolean(effective?.enabled) : true;
    let source: ModuleAccessSource;
    if (!effectiveContext) source = "BLOCKED";
    else if (!enabled) source = "DISABLED";
    else if (!effective || effective.accessLevel === "NONE") source = "NONE";
    else if (byPosition && (effective.accessLevel !== byPosition.accessLevel || effective.scope !== byPosition.scope) && grants.some((grant) => grant.moduleKey === key)) source = "GRANT";
    else if (byRole && byPosition && (byPosition.accessLevel !== byRole.accessLevel || byPosition.scope !== byRole.scope)) source = "POSITION";
    else source = "ROLE";
    return {
      key,
      label: moduleLabel(key),
      enabled,
      role: byRole ? { accessLevel: byRole.accessLevel, scope: byRole.scope } : NONE,
      position: byPosition ? { accessLevel: byPosition.accessLevel, scope: byPosition.scope } : NONE,
      effective: effective && effective.enabled ? { accessLevel: effective.accessLevel, scope: effective.scope } : NONE,
      source,
    };
  });

  let permission: AccessDiagnosisDTO["permission"] = null;
  if (query.permission) {
    const key = query.permission;
    const known = isPermission(key);
    const moduleKey = known ? moduleForPermission(key) : null;
    const held = known && Boolean(effectiveContext?.permissions.includes(key));
    let reason: NonNullable<AccessDiagnosisDTO["permission"]>["reason"];
    if (!known) reason = "UNKNOWN_PERMISSION";
    else if (held) reason = "HELD";
    else if (!effectiveContext) reason = "BLOCKED";
    else if (moduleKey && !effectiveContext.moduleAccess[moduleKey]?.enabled) reason = "MODULE_DISABLED";
    else reason = "NOT_IN_ACCESS";
    permission = { key: query.permission, known, moduleKey, held, reason };
  }

  return {
    person: { userId: user.id, name: `${user.firstName} ${user.lastName}`, username: user.username, accountStatus: user.status },
    company: { id: company.id, name: company.name, status: company.status },
    group: { name: company.parentGroup.name, status: company.parentGroup.status },
    membership: membership ? { id: membership.id, status: membership.status, role: { key: membership.role.key, label: role ? roleLabel(role) : membership.role.name } } : null,
    blockers,
    position: { level: position, label: positionLabels[position], heldThrough },
    grants: grants.map((grant) => ({ id: grant.id, moduleKey: grant.moduleKey, moduleLabel: moduleLabel(grant.moduleKey), scope: grant.scopeType === "GROUP" ? "GROUP" : "COMPANY", accessLevel: grant.accessLevel })),
    modules,
    permission,
  };
}
