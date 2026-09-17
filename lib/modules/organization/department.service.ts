import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can, getModuleScope } from "@/lib/access/can";
import { assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { loadOrganizationAccessFor, type ContextAssignment } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Group departments and their company branches (E-06 §11-§13, §31, §65-§68).
 *
 * A department is read once for the group — who heads it, which companies run
 * a branch of it and who manages each — and then as a workspace: its people,
 * the projects each is on, and the projects a manager may put them on. A
 * group-wide reader sees every branch; a manager or head sees the branches
 * they manage; everyone else, their own company's. Assigning goes through the
 * project team's own door, which checks the same positions again (§94).
 */

const MODULE = "organization" as const;

export type PersonRefDTO = { userId: string; name: string; /** The appointment behind a head or manager. */ assignmentId?: string };

export type DepartmentBranchDTO = {
  departmentId: string;
  name: string;
  company: { id: string; name: string };
  managers: PersonRefDTO[];
  memberCount: number;
};

export type GroupDepartmentSummaryDTO = {
  id: string;
  key: string;
  name: string;
  heads: PersonRefDTO[];
  branches: DepartmentBranchDTO[];
};

export type DepartmentMemberDTO = {
  memberId: string;
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  company: { id: string; name: string };
  isManager: boolean;
  projects: Array<{ projectMemberId: string; projectId: string; code: string; name: string; projectRole: string | null }>;
  /** Projects of the member's company this reader may put them on (§66); empty when they manage nobody here. */
  assignable: Array<{ id: string; code: string; name: string }>;
  canUnassign: boolean;
};

export type DepartmentWorkspaceDTO = GroupDepartmentSummaryDTO & {
  reach: "GROUP" | "MANAGED" | "COMPANY";
  members: DepartmentMemberDTO[] | null;
  /** Who may be appointed, and where this reader may appoint (§37, §38). */
  appointments: {
    canAppointHead: boolean;
    headCandidates: PersonRefDTO[];
    branches: Array<{ departmentId: string; companyId: string; canAppointManager: boolean; candidates: PersonRefDTO[] }>;
  };
};

const name = (user: { id: string; firstName: string; lastName: string }, assignmentId?: string): PersonRefDTO => ({ userId: user.id, name: `${user.firstName} ${user.lastName}`, ...(assignmentId ? { assignmentId } : {}) });

function groupWide(context: UserContext): boolean {
  const scope = getModuleScope(context, MODULE);
  return scope === "GROUP" || scope === "SYSTEM";
}

/** What this reader manages across the group: positions are not limited to the session's company (§14). */
async function managedBy(context: UserContext): Promise<ContextAssignment[]> {
  const access = await loadOrganizationAccessFor(context.parentGroupId, context.userId);
  return access.assignments.filter((assignment) => assignment.positionLevel !== "MEMBER");
}

function managesBranch(positions: ContextAssignment[], groupDepartmentId: string, companyId: string, branchId: string): boolean {
  return positions.some(
    (position) =>
      (position.positionLevel === "GROUP_HEAD" && position.companyId === null && position.groupDepartmentId === groupDepartmentId) ||
      (position.positionLevel === "COMPANY_MANAGER" && position.companyId === companyId && position.companyDepartmentId === branchId),
  );
}

async function companiesInReach(context: UserContext, positions: ContextAssignment[], groupDepartmentId: string | null) {
  if (groupWide(context)) return { reach: "GROUP" as const, companyIds: null };
  const managed = positions.filter((position) => groupDepartmentId === null || position.groupDepartmentId === groupDepartmentId);
  if (managed.some((position) => position.positionLevel === "GROUP_HEAD")) return { reach: "GROUP" as const, companyIds: null };
  const companyIds = [...new Set([context.companyId, ...managed.map((position) => position.companyId).filter((id): id is string => Boolean(id))])];
  return { reach: managed.length > 0 ? ("MANAGED" as const) : ("COMPANY" as const), companyIds };
}

async function summaries(context: UserContext, groupDepartmentIds: string[] | null, companyIds: string[] | null): Promise<GroupDepartmentSummaryDTO[]> {
  const departments = await prisma.groupDepartment.findMany({
    where: { parentGroupId: context.parentGroupId, status: "ACTIVE", ...(groupDepartmentIds ? { id: { in: groupDepartmentIds } } : {}) },
    select: {
      id: true,
      key: true,
      name: true,
      assignments: {
        where: { status: "ACTIVE", positionLevel: { in: ["GROUP_HEAD", "COMPANY_MANAGER"] } },
        select: { id: true, positionLevel: true, companyDepartmentId: true, user: { select: { id: true, firstName: true, lastName: true } } },
      },
      branches: {
        where: { status: "ACTIVE", company: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
        select: { id: true, name: true, company: { select: { id: true, name: true } }, _count: { select: { members: { where: { status: "ACTIVE" } } } } },
        orderBy: { company: { name: "asc" } },
      },
    },
  });

  // The functions in the order the group's chart lists them, then any the group added.
  const rank = (key: string) => {
    const index = GROUP_DEPARTMENTS.findIndex((department) => department.key === key);
    return index === -1 ? GROUP_DEPARTMENTS.length : index;
  };
  departments.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));

  return departments.map((department) => ({
    id: department.id,
    key: department.key,
    name: department.name,
    heads: department.assignments.filter((row) => row.positionLevel === "GROUP_HEAD").map((row) => name(row.user, row.id)),
    branches: department.branches.map((branch) => ({
      departmentId: branch.id,
      name: branch.name,
      company: branch.company,
      managers: department.assignments.filter((row) => row.positionLevel === "COMPANY_MANAGER" && row.companyDepartmentId === branch.id).map((row) => name(row.user, row.id)),
      memberCount: branch._count.members,
    })),
  }));
}

export async function listGroupDepartments(context: UserContext): Promise<GroupDepartmentSummaryDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "organization.department.view");
  const positions = await managedBy(context);
  const { companyIds } = await companiesInReach(context, positions, null);
  return summaries(context, null, companyIds);
}

export async function getDepartmentWorkspace(context: UserContext, groupDepartmentId: string): Promise<DepartmentWorkspaceDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "organization.department.view");
  const positions = await managedBy(context);
  const { reach, companyIds } = await companiesInReach(context, positions, groupDepartmentId);
  const [summary] = await summaries(context, [groupDepartmentId], companyIds);
  const department = assertFound(summary);

  // The team and its projects are for whoever manages this department, and for
  // those who keep the group's people (§67, §68, §113). Heading another function
  // is not a reason to read this one's team.
  const managesHere = positions.some((position) => position.groupDepartmentId === groupDepartmentId);
  const headsHere = positions.some((position) => position.positionLevel === "GROUP_HEAD" && position.companyId === null && position.groupDepartmentId === groupDepartmentId);
  const closed = { canAppointHead: false, headCandidates: [], branches: [] };
  if (!can(context, "department.team.view") || !(managesHere || can(context, "organization.people.view"))) {
    return { ...department, reach, members: null, appointments: closed };
  }

  const branchIds = department.branches.map((branch) => branch.departmentId);
  const members = await prisma.companyMember.findMany({
    where: { departmentId: { in: branchIds }, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: {
      id: true,
      userId: true,
      jobTitle: true,
      departmentId: true,
      companyId: true,
      role: { select: { key: true, name: true } },
      company: { select: { name: true } },
      user: { select: { id: true, firstName: true, lastName: true } },
      projectMemberships: {
        where: { status: "ACTIVE", project: { archivedAt: null } },
        select: { id: true, projectRole: true, project: { select: { id: true, code: true, name: true } } },
      },
    },
    orderBy: [{ company: { name: "asc" } }, { user: { lastName: "asc" } }],
  });

  const assignsHere = can(context, "department.project.assign");
  const managedCompanies = [...new Set(members.filter((member) => managesBranch(positions, groupDepartmentId, member.companyId, member.departmentId!)).map((member) => member.companyId))];
  const projects = assignsHere && managedCompanies.length
    ? await prisma.project.findMany({
        where: { companyId: { in: managedCompanies }, archivedAt: null, status: { in: ["PENDING", "ACTIVE"] } },
        select: { id: true, code: true, name: true, companyId: true },
        orderBy: { name: "asc" },
      })
    : [];
  const managerIds = new Set(department.branches.flatMap((branch) => branch.managers.map((manager) => manager.userId)));

  // A position is held with the role the person works as (§6.5): only those are candidates.
  const roles = GROUP_DEPARTMENTS.find((row) => row.key === department.key)?.roles as readonly string[] | undefined;
  const fits = (member: (typeof members)[number]) => !roles || roles.includes(member.role.key);
  const headIds = new Set(department.heads.map((head) => head.userId));
  const headCandidates = [...new Map(members.filter((member) => fits(member) && !headIds.has(member.userId)).map((member) => [member.userId, name(member.user)])).values()];
  const appointsManagers = can(context, "organization.department_manager.assign") || (headsHere && can(context, "department.company_manager.manage"));

  return {
    ...department,
    reach,
    appointments: {
      canAppointHead: can(context, "organization.department_head.assign"),
      headCandidates,
      branches: department.branches.map((branch) => ({
        departmentId: branch.departmentId,
        companyId: branch.company.id,
        canAppointManager: appointsManagers,
        candidates: members
          .filter((member) => member.departmentId === branch.departmentId && fits(member) && !branch.managers.some((manager) => manager.userId === member.userId))
          .map((member) => name(member.user)),
      })),
    },
    members: members.map((member) => {
      const manages = managesBranch(positions, groupDepartmentId, member.companyId, member.departmentId!);
      const on = new Set(member.projectMemberships.map((row) => row.project.id));
      return {
        memberId: member.id,
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        jobTitle: member.jobTitle,
        role: isMembershipRoleKey(member.role.key) ? roleLabel(member.role.key) : member.role.name,
        company: { id: member.companyId, name: member.company.name },
        isManager: managerIds.has(member.userId),
        projects: member.projectMemberships.map((row) => ({ projectMemberId: row.id, projectId: row.project.id, code: row.project.code, name: row.project.name, projectRole: row.projectRole })),
        assignable: assignsHere && manages ? projects.filter((project) => project.companyId === member.companyId && !on.has(project.id)).map(({ id, code, name: projectName }) => ({ id, code, name: projectName })) : [],
        canUnassign: can(context, "department.project.unassign") && manages,
      };
    }),
  };
}
