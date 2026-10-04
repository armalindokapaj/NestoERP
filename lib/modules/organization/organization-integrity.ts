import type { PrismaClient } from "@prisma/client";

import { accessAtLeast, scopeAtLeast } from "@/config/access";
import { CUSTOM_DEPARTMENT_KEY_PREFIX, GROUP_DEPARTMENTS, isGrantableModule, rolesOfFunction } from "@/config/group-departments";
import { defaultAccessFor } from "@/config/role-defaults";
import { isMembershipRoleKey, type RoleKey } from "@/config/roles";
import { findAccessFindings } from "./access-integrity";
import { positionFor, type ContextAssignment } from "@/lib/context/organization-access";

/**
 * The organization's own consistency (E-06 §11-§18, §73): the data every
 * group and company authorization decision is computed from.
 *
 * Positions, branches, branch managers, member places, grants and memberships
 * are written by different doors — appointments, Team, the platform roster,
 * provisioning, E-13's department services —
 * and each keeps its own rule. This reads them side by side and names what
 * disagrees, so a position that elevates nothing, a branch manager nobody
 * appointed or a grant pointing outside its group is found by a gate rather
 * than by somebody who cannot open a page.
 *
 * Errors are states the authorization model cannot interpret. Warnings are
 * states it tolerates but somebody should look at. Read-only.
 */

export type OrganizationFinding = { level: "error" | "warning"; code: string; group: string; message: string };

const DEPARTMENT_KEYS = new Set<string>(GROUP_DEPARTMENTS.map((department) => department.key));

export async function findOrganizationFindings(prisma: PrismaClient): Promise<OrganizationFinding[]> {
  const findings: OrganizationFinding[] = [];
  const now = new Date();

  const groups = await prisma.parentGroup.findMany({
    select: {
      id: true,
      slug: true,
      companies: { select: { id: true, name: true, status: true } },
      members: { where: { status: "ACTIVE" }, select: { userId: true, user: { select: { username: true } } } },
      departments: { select: { id: true, key: true, status: true } },
    },
  });

  const platformUsers = new Set((await prisma.platformAccess.findMany({ select: { userId: true } })).map((row) => row.userId));

  for (const group of groups) {
    const add = (level: OrganizationFinding["level"], code: string, message: string) => findings.push({ level, code, group: group.slug, message });
    const companyIds = group.companies.map((company) => company.id);
    const activeCompanies = group.companies.filter((company) => company.status === "ACTIVE");
    const companyName = new Map(group.companies.map((company) => [company.id, company.name]));

    const [memberships, assignments, branches, grants, people] = await Promise.all([
      prisma.companyMember.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true, userId: true, companyId: true, departmentId: true, status: true, role: { select: { key: true } }, user: { select: { username: true, status: true, personProfileId: true, personProfile: { select: { parentGroupId: true } } } } },
      }),
      prisma.departmentAssignment.findMany({
        where: { parentGroupId: group.id, status: "ACTIVE", OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        select: { id: true, userId: true, groupDepartmentId: true, companyId: true, companyDepartmentId: true, functionalRoleKey: true, positionLevel: true, startsAt: true, groupDepartment: { select: { key: true, name: true } }, user: { select: { username: true } } },
      }),
      prisma.department.findMany({
        where: { companyId: { in: companyIds } },
        select: { id: true, companyId: true, name: true, status: true, groupDepartmentId: true, managerMemberId: true, groupDepartment: { select: { parentGroupId: true } }, managerMember: { select: { userId: true, status: true } } },
      }),
      prisma.accessGrant.findMany({
        where: { parentGroupId: group.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true, userId: true, functionKey: true, scopeType: true, scopeId: true, accessLevel: true, grantedByUserId: true },
      }),
      prisma.personProfile.findMany({ where: { parentGroupId: group.id }, select: { id: true } }),
    ]);

    const activeMemberships = memberships.filter((row) => row.status === "ACTIVE");
    const membershipsOf = (userId: string) => activeMemberships.filter((row) => row.userId === userId);

    /* Memberships ------------------------------------------------------- */
    for (const membership of memberships) {
      if (!isMembershipRoleKey(membership.role.key)) add("error", "MEMBERSHIP_ROLE", `${membership.user.username} in ${companyName.get(membership.companyId)} holds ${membership.role.key}, which no membership may hold.`);
      if (platformUsers.has(membership.userId)) add("error", "PLATFORM_MEMBER", `${membership.user.username} has platform access and a membership in ${companyName.get(membership.companyId)}; the Platform Admin is a member of nothing.`);
    }
    // The group's own people (Owner, Group IT) work in every company of it (§10, §35).
    for (const member of group.members) {
      for (const company of activeCompanies) {
        if (!activeMemberships.some((row) => row.userId === member.userId && row.companyId === company.id)) {
          add("warning", "GROUP_MEMBER_MISSING", `${member.user.username} belongs to the group but has no active membership in ${company.name}.`);
        }
      }
    }

    /* Departments and branches ------------------------------------------ */
    const departmentById = new Map(group.departments.map((department) => [department.id, department]));
    // A department the group adds has a `custom-` key and binds no role (E-13, ADR 0003); any other unknown key is a mistake.
    for (const department of group.departments) {
      if (!DEPARTMENT_KEYS.has(department.key) && !department.key.startsWith(CUSTOM_DEPARTMENT_KEY_PREFIX)) {
        add("warning", "UNKNOWN_FUNCTION", `Group department "${department.key}" is neither in the chart NESTO knows nor one the group added.`);
      }
    }
    for (const branch of branches) {
      if (branch.groupDepartmentId && branch.groupDepartment && branch.groupDepartment.parentGroupId !== group.id) {
        add("error", "BRANCH_OTHER_GROUP", `${branch.name} in ${companyName.get(branch.companyId)} is a branch of another group's department.`);
      }
    }
    // A company runs only the departments it activates (E-13 §2, §49): a missing branch is a choice, not a fault.
    for (const branch of branches.filter((row) => !row.groupDepartmentId && row.status === "ACTIVE")) {
      add("warning", "DEPARTMENT_UNLINKED", `${branch.name} in ${companyName.get(branch.companyId)} is not a branch of any group department; it has no team and no manager position.`);
    }

    // A membership's department is a place on that department's team (E-13 §24-§29, ADR 0003).
    for (const membership of activeMemberships) {
      const branch = membership.departmentId ? branches.find((row) => row.id === membership.departmentId) : null;
      if (!branch?.groupDepartmentId) continue;
      if (!assignments.some((row) => row.userId === membership.userId && row.companyDepartmentId === branch.id && row.positionLevel === "MEMBER")) {
        add("error", "HOME_WITHOUT_PLACE", `${membership.user.username} is placed in ${branch.name} in ${companyName.get(membership.companyId)} with no place on its team.`);
      }
    }
    for (const assignment of assignments.filter((row) => row.positionLevel === "MEMBER" && row.companyId)) {
      if (!assignment.companyDepartmentId) add("warning", "PLACE_WITHOUT_BRANCH", `${assignment.user.username} is a member of ${assignment.groupDepartment.key} in ${companyName.get(assignment.companyId!)} with no branch named.`);
    }

    /* Positions --------------------------------------------------------- */
    for (const assignment of assignments) {
      const label = `${assignment.user.username} (${assignment.positionLevel} ${assignment.groupDepartment.key})`;
      if (!departmentById.has(assignment.groupDepartmentId)) add("error", "POSITION_OTHER_GROUP", `${label} points at a department outside the group.`);
      // A member place widens nothing, and a position in a department the group added widens nothing by design (ADR 0003).
      if (assignment.positionLevel === "MEMBER" || !DEPARTMENT_KEYS.has(assignment.groupDepartment.key)) continue;
      const roles = rolesOfFunction(assignment.groupDepartment.key) as readonly string[];
      if (roles.length > 0 && !roles.includes(assignment.functionalRoleKey)) {
        add("error", "POSITION_ROLE", `${label} is held as ${assignment.functionalRoleKey}, which is not a role of that department.`);
      }
      if (assignment.positionLevel === "GROUP_HEAD") {
        if (assignment.companyId !== null) add("error", "HEAD_IN_COMPANY", `${label} names a company; a group head's position has none.`);
        if (!membershipsOf(assignment.userId).some((row) => row.role.key === assignment.functionalRoleKey)) {
          add("warning", "POSITION_INERT", `${label}: no active membership works as ${assignment.functionalRoleKey}, so the position widens nothing.`);
        }
      }
      if (assignment.positionLevel === "COMPANY_MANAGER") {
        const branch = branches.find((row) => row.id === assignment.companyDepartmentId);
        if (!assignment.companyId || !branch) {
          add("error", "MANAGER_WITHOUT_BRANCH", `${label} manages no branch.`);
          continue;
        }
        if (branch.groupDepartmentId !== assignment.groupDepartmentId) add("error", "MANAGER_WRONG_BRANCH", `${label} manages ${branch.name}, a branch of another department.`);
        const membership = membershipsOf(assignment.userId).find((row) => row.companyId === assignment.companyId);
        if (!membership) add("warning", "POSITION_INERT", `${label}: no active membership in ${companyName.get(assignment.companyId)}.`);
        else if (membership.role.key !== assignment.functionalRoleKey) add("warning", "POSITION_INERT", `${label}: works as ${membership.role.key} in ${companyName.get(assignment.companyId)}, so the position widens nothing.`);
      }
    }

    // A branch names its manager; a live manager position says the same (§37).
    for (const branch of branches.filter((row) => row.status === "ACTIVE")) {
      const managers = assignments.filter((row) => row.positionLevel === "COMPANY_MANAGER" && row.companyDepartmentId === branch.id);
      if (branch.managerMemberId && branch.managerMember && !managers.some((row) => row.userId === branch.managerMember!.userId)) {
        add("warning", "BRANCH_MANAGER_UNAPPOINTED", `${branch.name} in ${companyName.get(branch.companyId)} names a manager with no manager position there.`);
      }
      for (const manager of managers) {
        const membership = membershipsOf(manager.userId).find((row) => row.companyId === branch.companyId);
        if (membership && branch.managerMemberId !== membership.id) {
          add("warning", "BRANCH_MANAGER_UNNAMED", `${manager.user.username} manages ${branch.name} in ${companyName.get(branch.companyId)} but the branch names ${branch.managerMemberId ? "somebody else" : "nobody"}.`);
        }
      }
    }

    /* Delegated access -------------------------------------------------- */
    const liveAssignments = (userId: string): ContextAssignment[] =>
      assignments
        .filter((row) => row.userId === userId && (!row.startsAt || row.startsAt <= now))
        .map((row) => ({ id: row.id, groupDepartmentId: row.groupDepartmentId, groupDepartmentKey: row.groupDepartment.key, groupDepartmentName: row.groupDepartment.name, companyId: row.companyId, companyDepartmentId: row.companyDepartmentId, functionalRoleKey: row.functionalRoleKey, positionLevel: row.positionLevel }));
    for (const grant of grants) {
      const label = `grant ${grant.id} (${grant.functionKey ?? "?"} ${grant.accessLevel} ${grant.scopeType})`;
      if (!grant.functionKey || !isGrantableModule(grant.functionKey)) add("error", "GRANT_MODULE", `${label} is for something that cannot be delegated.`);
      let reached: string[] = [];
      if (grant.scopeType === "GROUP") {
        if (grant.scopeId && grant.scopeId !== group.id) add("error", "GRANT_SCOPE", `${label} names another group.`);
        reached = activeCompanies.map((company) => company.id);
      } else if (grant.scopeType === "COMPANY") {
        if (!grant.scopeId || !companyIds.includes(grant.scopeId)) add("error", "GRANT_SCOPE", `${label} names a company outside the group.`);
        else reached = [grant.scopeId];
      } else {
        add("warning", "GRANT_INERT", `${label}: ${grant.scopeType} grants widen nothing in V0.1.`);
      }
      if (membershipsOf(grant.userId).length === 0) add("warning", "GRANT_INERT", `${label}: the holder works nowhere in the group.`);
      // The grantor's authority may have shrunk since (a role change, an ended position).
      if (grant.functionKey && isGrantableModule(grant.functionKey)) {
        const moduleKey = grant.functionKey;
        const assignmentsOfGrantor = liveAssignments(grant.grantedByUserId);
        const beyond = reached.filter((companyId) => {
          const membership = membershipsOf(grant.grantedByUserId).find((row) => row.companyId === companyId);
          if (!membership || !isMembershipRoleKey(membership.role.key)) return true;
          const role = membership.role.key as RoleKey;
          const preset = defaultAccessFor(role, moduleKey, positionFor(role, companyId, assignmentsOfGrantor.filter((row) => row.companyId === null || row.companyId === companyId)));
          return !(accessAtLeast(preset.accessLevel, grant.accessLevel) && scopeAtLeast(preset.scope, "COMPANY"));
        });
        if (beyond.length > 0) add("warning", "GRANT_ABOVE_GRANTOR", `${label} exceeds what its grantor now holds in ${beyond.map((id) => companyName.get(id)).join(", ")}; review or revoke it.`);
      }
    }

    /* People ------------------------------------------------------------ */
    const personIds = new Set(people.map((person) => person.id));
    const seen = new Set<string>();
    for (const membership of activeMemberships) {
      if (seen.has(membership.userId)) continue;
      seen.add(membership.userId);
      // Since E-01 every door into a company gives the login its person (ADR 0002).
      if (!membership.user.personProfileId) add("error", "LOGIN_WITHOUT_PERSON", `${membership.user.username} works in the group with no person record behind the login.`);
      else if (!personIds.has(membership.user.personProfileId)) add("warning", "PERSON_OTHER_GROUP", `${membership.user.username}'s person record belongs to another group.`);
    }
  }

  findings.push(...(await findAccessFindings(prisma)));
  return findings;
}
