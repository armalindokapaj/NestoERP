import type { DepartmentPositionLevel, DepartmentStatus, Prisma } from "@prisma/client";

import { GROUP_DEPARTMENTS, isChartFunction, rolesOfFunction } from "@/config/group-departments";
import { canPlatform } from "@/lib/context/platform-context";
import { can, getModuleScope } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import { loadOrganizationAccessFor, type ContextAssignment } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

import { groupOf, mayAppointManagerIn, mayStaff, type DepartmentActor } from "./department.actor";
import { loadBranch, loadCompany, loadGroupDepartment } from "./department.lookup";
import type { CandidatesQuery, TeamQuery } from "./department.schema";
import type {
  AppointmentDTO,
  CandidateDTO,
  CompanyDepartmentDTO,
  CompanyDepartmentsDTO,
  DepartmentActivityDTO,
  DepartmentAssignmentDTO,
  DepartmentCapabilitiesDTO,
  DepartmentDetailDTO,
  DepartmentStatusDTO,
  DepartmentTeamDTO,
  GroupDepartmentDTO,
  PersonDepartmentDTO,
  PositionDTO,
  TeamMemberDTO,
} from "./department.types";

/**
 * Reading the group's departments (E-13 §32-§39, §73, §74, §84, §86, §87,
 * §97, §132-§135).
 *
 * The chart itself — which departments exist, who heads them, where they are
 * active — is the group's and every member may read it. Who works in a
 * branch, on what, and what happened to it is for the people who run the
 * department (its head and managers) and those who keep the group's people
 * (Owner, Group IT, HR); a head of another function does not read this one's
 * team (E-06 §67, §113). A group-wide reader sees every company; a manager, the
 * branches they manage and their own company; everybody else, their own company
 * (§86, §125). The Platform Admin reads the group they are implementing.
 */

const MODULE = "organization" as const;

const USER = { select: { id: true, firstName: true, lastName: true, status: true, personProfileId: true, personProfile: { select: { jobTitle: true } } } } as const;
type UserRow = { id: string; firstName: string; lastName: string; status: string; personProfileId: string | null; personProfile: { jobTitle: string | null } | null };

function live(now = new Date()): Prisma.DepartmentAssignmentWhereInput {
  return { status: "ACTIVE", OR: [{ startsAt: null }, { startsAt: { lte: now } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] };
}

const person = (user: UserRow) => ({ personId: user.personProfileId, userId: user.id, name: `${user.firstName} ${user.lastName}`.trim(), jobTitle: user.personProfile?.jobTitle ?? null });
const appointment = (row: { id: string; startsAt: Date | null; user: UserRow }): AppointmentDTO => ({ ...person(row.user), assignmentId: row.id, since: row.startsAt?.toISOString() ?? null });
const statusOf = (status: DepartmentStatus): DepartmentStatusDTO => (status === "ACTIVE" ? "ACTIVE" : "INACTIVE");

/** The chart's functions in its own order, then the ones the group added, by name. */
function byChart<T extends { key: string; name: string }>(rows: T[]): T[] {
  const rank = (key: string) => {
    const index = GROUP_DEPARTMENTS.findIndex((department) => department.key === key);
    return index === -1 ? GROUP_DEPARTMENTS.length : index;
  };
  return rows.slice().sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------------------- */
/* Reach                                                                       */
/* -------------------------------------------------------------------------- */

type Reader = {
  actor: DepartmentActor;
  context: UserContext | null;
  reach: "GROUP" | "MANAGED" | "COMPANY";
  /** Null: every company of the group. */
  companyIds: string[] | null;
  /** The reader's positions across the group (heads and managers). */
  positions: ContextAssignment[];
};

function groupWide(context: UserContext): boolean {
  const scope = getModuleScope(context, MODULE);
  return scope === "GROUP" || scope === "SYSTEM";
}

async function readerFor(actor: DepartmentActor, groupDepartmentId: string | null): Promise<Reader> {
  if (actor.kind === "platform") {
    if (!canPlatform(actor.context, "platform.group.view")) throw new AccessError("FORBIDDEN");
    assertFound(await prisma.parentGroup.findFirst({ where: { id: actor.parentGroupId, isTestFixture: false }, select: { id: true } }));
    return { actor, context: null, reach: "GROUP", companyIds: null, positions: [] };
  }
  const context = actor.context;
  assertModule(context, MODULE);
  assertPermission(context, "organization.department.view");
  const positions = (await loadOrganizationAccessFor(context.parentGroupId, context.userId)).assignments.filter((row) => row.positionLevel !== "MEMBER");
  if (groupWide(context)) return { actor, context, reach: "GROUP", companyIds: null, positions };
  const here = positions.filter((row) => groupDepartmentId === null || row.groupDepartmentId === groupDepartmentId);
  if (here.some((row) => row.positionLevel === "GROUP_HEAD")) return { actor, context, reach: "GROUP", companyIds: null, positions };
  const companyIds = [...new Set([context.companyId, ...here.map((row) => row.companyId).filter((id): id is string => Boolean(id))])];
  return { actor, context, reach: here.length > 0 ? "MANAGED" : "COMPANY", companyIds, positions };
}

const inReach = (reader: Reader, companyId: string) => reader.companyIds === null || reader.companyIds.includes(companyId);

/** Team, activity and access: for the department's own heads and managers, and those who keep the group's people. */
function readsTeam(reader: Reader, groupDepartmentId: string): boolean {
  if (!reader.context) return true;
  const runsIt = reader.positions.some((row) => row.groupDepartmentId === groupDepartmentId);
  return can(reader.context, "department.team.view") && (runsIt || can(reader.context, "organization.people.view"));
}

/** The member's context in each company of the group they work in, for per-company capabilities. */
async function actingContexts(context: UserContext, companyIds: readonly string[]): Promise<Map<string, UserContext>> {
  const result = new Map<string, UserContext>();
  for (const companyId of companyIds) {
    const acting = companyId === context.companyId ? context : await contextInCompany(context, companyId);
    if (acting) result.set(companyId, acting);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

async function summaries(parentGroupId: string, where: Prisma.GroupDepartmentWhereInput): Promise<GroupDepartmentDTO[]> {
  const now = new Date();
  const rows = await prisma.groupDepartment.findMany({
    where: { parentGroupId, ...where },
    select: {
      id: true,
      key: true,
      code: true,
      name: true,
      description: true,
      status: true,
      assignments: { where: { ...live(now), positionLevel: "GROUP_HEAD" }, select: { id: true, startsAt: true, user: USER }, take: 1 },
      branches: { where: { status: "ACTIVE", company: { status: "ACTIVE" } }, select: { id: true } },
    },
  });
  const openBranches = rows.flatMap((row) => row.branches.map((branch) => branch.id));
  const places = openBranches.length
    ? await prisma.departmentAssignment.findMany({
        where: { ...live(now), companyDepartmentId: { in: openBranches }, positionLevel: { in: ["MEMBER", "COMPANY_MANAGER"] } },
        select: { groupDepartmentId: true, userId: true },
      })
    : [];
  return byChart(rows).map((row) => ({
    id: row.id,
    key: row.key,
    code: row.code,
    name: row.name,
    description: row.description,
    status: statusOf(row.status),
    bindsRoles: isChartFunction(row.key),
    groupHead: row.assignments[0] ? appointment(row.assignments[0]) : null,
    activeCompanyCount: row.branches.length,
    memberCount: new Set(places.filter((place) => place.groupDepartmentId === row.id).map((place) => place.userId)).size,
  }));
}

/**
 * Organization → Departments (E-13 §32, §97): every department of the group,
 * its code, head, active companies, people and status. Inactive ones only for
 * those who configure them.
 */
export async function listGroupDepartments(actor: DepartmentActor, options: { status?: "ACTIVE" | "ALL" } = {}): Promise<GroupDepartmentDTO[]> {
  const reader = await readerFor(actor, null);
  const everything = options.status === "ALL" && (reader.context ? can(reader.context, "organization.department.manage") : true);
  return summaries(groupOf(actor), everything ? {} : { status: "ACTIVE" });
}

/* -------------------------------------------------------------------------- */
/* One department                                                              */
/* -------------------------------------------------------------------------- */

async function branchRows(groupDepartmentId: string, companyIds: string[] | null, parentGroupId: string): Promise<CompanyDepartmentDTO[]> {
  const now = new Date();
  const branches = await prisma.department.findMany({
    where: { groupDepartmentId, company: { parentGroupId }, ...(companyIds ? { companyId: { in: companyIds } } : {}) },
    select: {
      id: true,
      status: true,
      company: { select: { id: true, name: true } },
      assignments: { where: { ...live(now), positionLevel: { in: ["MEMBER", "COMPANY_MANAGER"] } }, select: { id: true, userId: true, positionLevel: true, startsAt: true, user: USER } },
    },
    orderBy: { company: { name: "asc" } },
  });
  return branches.map((branch) => {
    const manager = branch.assignments.find((row) => row.positionLevel === "COMPANY_MANAGER");
    return {
      id: branch.id,
      groupDepartmentId,
      company: branch.company,
      manager: manager ? appointment(manager) : null,
      status: statusOf(branch.status),
      memberCount: new Set(branch.assignments.map((row) => row.userId)).size,
    };
  });
}

async function capabilitiesFor(reader: Reader, department: { id: string; status: DepartmentStatus }, branches: CompanyDepartmentDTO[], companyIds: string[]): Promise<DepartmentCapabilitiesDTO> {
  const open = department.status === "ACTIVE";
  if (!reader.context) {
    const actor = reader.actor as Extract<DepartmentActor, { kind: "platform" }>;
    const group = await prisma.parentGroup.findFirst({ where: { id: actor.parentGroupId }, select: { status: true } });
    const implementing = group?.status === "IMPLEMENTING" || group?.status === "READY_FOR_VALIDATION";
    const people = implementing && canPlatform(actor.context, "platform.user.initial_provision");
    return {
      canConfigure: implementing && canPlatform(actor.context, "platform.group.configure"),
      canAssignHead: people && open,
      managerCompanyIds: people && open ? branches.filter((branch) => branch.status === "ACTIVE").map((branch) => branch.company.id) : [],
      memberBranchIds: people && open ? branches.filter((branch) => branch.status === "ACTIVE").map((branch) => branch.id) : [],
      canViewTeam: true,
      canViewAccess: false,
    };
  }
  const context = reader.context;
  const acting = await actingContexts(context, companyIds);
  const openBranches = branches.filter((branch) => branch.status === "ACTIVE");
  const headsHere = reader.positions.some((row) => row.positionLevel === "GROUP_HEAD" && row.groupDepartmentId === department.id);
  return {
    canConfigure: can(context, "organization.department.manage"),
    canAssignHead: open && can(context, "organization.department_head.assign"),
    managerCompanyIds: open ? openBranches.filter((branch) => acting.has(branch.company.id) && mayAppointManagerIn(acting.get(branch.company.id)!, department.id)).map((branch) => branch.company.id) : [],
    memberBranchIds: open ? openBranches.filter((branch) => acting.has(branch.company.id) && mayStaff(acting.get(branch.company.id)!, department.id, branch.id)).map((branch) => branch.id) : [],
    canViewTeam: readsTeam(reader, department.id),
    canViewAccess: can(context, "organization.access.view") || (headsHere && can(context, "department.team.access.delegate")),
  };
}

/**
 * A department's page (E-13 §33-§35): the department, its head, and each
 * company of the reader's reach with its branch — active, inactive or never
 * activated — its manager and its people.
 */
export async function getDepartmentDetail(actor: DepartmentActor, groupDepartmentId: string): Promise<DepartmentDetailDTO> {
  const reader = await readerFor(actor, groupDepartmentId);
  const parentGroupId = groupOf(actor);
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  // An inactive department is configuration: only those who configure it read it.
  if (department.status !== "ACTIVE" && reader.context && !can(reader.context, "organization.department.manage")) throw new AccessError("NOT_FOUND");

  const [[summary], companies, branches] = await Promise.all([
    summaries(parentGroupId, { id: department.id }),
    prisma.company.findMany({
      where: { parentGroupId, ...(reader.companyIds ? { id: { in: reader.companyIds } } : {}) },
      select: { id: true, name: true, status: true },
      orderBy: { name: "asc" },
    }),
    branchRows(department.id, reader.companyIds, parentGroupId),
  ]);
  const capabilities = await capabilitiesFor(reader, department, branches, companies.map((company) => company.id));
  return {
    ...summary!,
    reach: reader.reach,
    companies: companies.map((company) => ({ company, branch: branches.find((branch) => branch.company.id === company.id) ?? null })),
    capabilities,
  };
}

/* -------------------------------------------------------------------------- */
/* The team                                                                    */
/* -------------------------------------------------------------------------- */

const RANK: Record<DepartmentPositionLevel, number> = { GROUP_HEAD: 3, COMPANY_MANAGER: 2, MEMBER: 1 };

/**
 * A department's team across the companies in reach (E-13 §23, §36, §73): one
 * row per person, with the highest position they hold, the companies they work
 * in for it, their projects there, and — for those who run the branch — the
 * projects they could be put on (§88).
 */
export async function getDepartmentTeam(actor: DepartmentActor, groupDepartmentId: string, query: TeamQuery): Promise<DepartmentTeamDTO> {
  const reader = await readerFor(actor, groupDepartmentId);
  const parentGroupId = groupOf(actor);
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  if (!readsTeam(reader, department.id)) throw new AccessError("FORBIDDEN");
  if (query.company && !inReach(reader, query.company)) throw new AccessError("NOT_FOUND");

  const companyFilter = query.company ? [query.company] : reader.companyIds;
  const statusWhere: Prisma.DepartmentAssignmentWhereInput = query.status === "ALL" ? {} : query.status === "INACTIVE" ? { status: "INACTIVE" } : live();
  const search: Prisma.DepartmentAssignmentWhereInput = query.search
    ? { user: { OR: [{ firstName: { contains: query.search, mode: "insensitive" } }, { lastName: { contains: query.search, mode: "insensitive" } }] } }
    : {};

  const rows = await prisma.departmentAssignment.findMany({
    where: {
      parentGroupId,
      groupDepartmentId: department.id,
      ...statusWhere,
      ...search,
      ...(query.position ? { positionLevel: query.position } : {}),
      // The head belongs to no company; everybody else to one in reach.
      OR: [{ positionLevel: "GROUP_HEAD", companyId: null }, companyFilter ? { companyId: { in: companyFilter } } : { companyId: { not: null } }],
    },
    select: {
      id: true,
      userId: true,
      positionLevel: true,
      status: true,
      companyId: true,
      companyDepartmentId: true,
      user: USER,
      company: { select: { id: true, name: true } },
    },
    orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }, { createdAt: "asc" }],
  });

  const userIds = [...new Set(rows.map((row) => row.userId))];
  const coveredCompanies = [...new Set(rows.map((row) => row.companyId).filter((id): id is string => Boolean(id)))];
  const personIds = [...new Set(rows.map((row) => row.user.personProfileId).filter((id): id is string => Boolean(id)))];

  const [memberships, employments] = await Promise.all([
    prisma.companyMember.findMany({
      where: { userId: { in: userIds }, status: "ACTIVE", company: { parentGroupId } },
      select: {
        id: true,
        userId: true,
        companyId: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
        projectMemberships: {
          where: { status: "ACTIVE", project: { archivedAt: null } },
          select: { id: true, projectRole: true, project: { select: { id: true, code: true, name: true, companyId: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.employeeProfile.findMany({
      where: { personProfileId: { in: personIds }, employmentStatus: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] }, company: { parentGroupId } },
      select: { personProfileId: true, company: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Who this reader may put on projects, and where (E-06 §66; E-13 §88).
  const context = reader.context;
  const assigns = context ? can(context, "department.project.assign") : false;
  const unassigns = context ? can(context, "department.project.unassign") : false;
  const manages = (companyId: string, branchId: string | null) =>
    reader.positions.some(
      (row) => row.groupDepartmentId === department.id && ((row.positionLevel === "GROUP_HEAD" && row.companyId === null) || (row.positionLevel === "COMPANY_MANAGER" && row.companyId === companyId && row.companyDepartmentId === branchId)),
    );
  const managedCompanies = coveredCompanies.filter((companyId) => rows.some((row) => row.companyId === companyId && manages(companyId, row.companyDepartmentId)));
  const projects = assigns && managedCompanies.length
    ? await prisma.project.findMany({ where: { companyId: { in: managedCompanies }, archivedAt: null, status: { in: ["PENDING", "ACTIVE"] } }, select: { id: true, code: true, name: true, companyId: true }, orderBy: { name: "asc" } })
    : [];
  const acting = context ? await actingContexts(context, coveredCompanies) : new Map<string, UserContext>();
  const managerOf = new Map(rows.filter((row) => row.positionLevel === "COMPANY_MANAGER" && row.status === "ACTIVE").map((row) => [`${row.userId}:${row.companyDepartmentId}`, true]));

  const data: TeamMemberDTO[] = userIds.map((userId) => {
    const own = rows.filter((row) => row.userId === userId);
    const user = own[0]!.user;
    const mine = memberships.filter((membership) => membership.userId === userId);
    const employment = employments.find((row) => row.personProfileId === user.personProfileId);
    const branchRowsOf = own.filter((row) => row.positionLevel !== "GROUP_HEAD" && row.companyDepartmentId && row.company);
    // One coverage row per branch: the manager's appointment over their member row.
    const byBranch = new Map<string, (typeof own)[number]>();
    for (const row of branchRowsOf) {
      const seen = byBranch.get(row.companyDepartmentId!);
      if (!seen || RANK[row.positionLevel] > RANK[seen.positionLevel] || (seen.status !== "ACTIVE" && row.status === "ACTIVE")) byBranch.set(row.companyDepartmentId!, row);
    }
    const coverage = [...byBranch.values()].map((row) => {
      const memberRow = own.find((candidate) => candidate.companyDepartmentId === row.companyDepartmentId && candidate.positionLevel === "MEMBER" && candidate.status === "ACTIVE");
      const actingHere = row.companyId ? acting.get(row.companyId) : undefined;
      const mayRemove = memberRow && !managerOf.has(`${userId}:${row.companyDepartmentId}`) && (reader.context ? Boolean(actingHere && mayStaff(actingHere, department.id, row.companyDepartmentId!)) : true);
      return {
        assignmentId: row.id,
        branchId: row.companyDepartmentId!,
        company: row.company!,
        position: row.positionLevel as "COMPANY_MANAGER" | "MEMBER",
        status: row.status === "ACTIVE" ? ("ACTIVE" as const) : ("INACTIVE" as const),
        hasAccess: mine.some((membership) => membership.companyId === row.companyId),
        removableAssignmentId: mayRemove ? memberRow!.id : null,
      };
    });
    const position = own.reduce<DepartmentPositionLevel>((best, row) => (row.status === "ACTIVE" && RANK[row.positionLevel] > RANK[best] ? row.positionLevel : best), "MEMBER");
    const coveredHere = new Set(coverage.map((row) => row.company.id));
    const onProjects = mine.filter((membership) => coveredHere.has(membership.companyId)).flatMap((membership) => membership.projectMemberships.map((row) => ({ projectMemberId: row.id, projectId: row.project.id, code: row.project.code, name: row.project.name, companyId: row.project.companyId, projectRole: row.projectRole })));
    const on = new Set(onProjects.map((row) => row.projectId));
    const assignable = mine
      .filter((membership) => coverage.some((row) => row.company.id === membership.companyId && row.status === "ACTIVE" && manages(membership.companyId, row.branchId)))
      .map((membership) => ({ companyMemberId: membership.id, company: membership.company, projects: projects.filter((project) => project.companyId === membership.companyId && !on.has(project.id)).map(({ id, code, name }) => ({ id, code, name })) }))
      .filter((row) => row.projects.length > 0);
    const active = own.some((row) => row.status === "ACTIVE") && user.status === "ACTIVE";
    return {
      person: person(user),
      position: position as PositionDTO,
      primaryCompany: employment?.company ?? mine[0]?.company ?? null,
      coverage,
      projects: onProjects,
      assignable,
      canUnassignProjects: unassigns && coverage.some((row) => manages(row.company.id, row.branchId)),
      status: !active ? "INACTIVE" : coverage.some((row) => row.status === "ACTIVE" && !row.hasAccess) ? "NO_ACCESS" : "ACTIVE",
    };
  });

  const companies = await prisma.company.findMany({
    where: { parentGroupId, ...(reader.companyIds ? { id: { in: reader.companyIds } } : {}), departments: { some: { groupDepartmentId: department.id } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { data, filters: { companies } };
}

/** One branch's people (E-13 §72): its manager and members, as assignments. */
export async function listBranchMembers(actor: DepartmentActor, branchId: string): Promise<DepartmentAssignmentDTO[]> {
  const parentGroupId = groupOf(actor);
  const branch = await loadBranch(prisma, parentGroupId, branchId);
  const reader = await readerFor(actor, branch.groupDepartment.id);
  if (!inReach(reader, branch.companyId)) throw new AccessError("NOT_FOUND");
  if (!readsTeam(reader, branch.groupDepartment.id)) throw new AccessError("FORBIDDEN");
  const rows = await prisma.departmentAssignment.findMany({
    where: { ...live(), companyDepartmentId: branch.id, positionLevel: { in: ["MEMBER", "COMPANY_MANAGER"] } },
    select: { id: true, positionLevel: true, status: true, startsAt: true, endsAt: true, user: USER },
    orderBy: [{ positionLevel: "asc" }, { user: { lastName: "asc" } }],
  });
  return rows.map((row) => ({
    id: row.id,
    person: person(row.user),
    department: { id: branch.groupDepartment.id, code: branch.groupDepartment.code, name: branch.groupDepartment.name },
    companyDepartment: { id: branch.id, company: { id: branch.company.id, name: branch.company.name } },
    position: row.positionLevel as PositionDTO,
    scope: "COMPANY",
    status: row.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown> | null;
const field = (json: Json, key: string) => (json && typeof json[key] === "string" ? (json[key] as string) : null);

function describe(actionKey: string, before: Json, after: Json, name: string): string {
  const who = field(after, "personName") ?? field(before, "personName") ?? "Somebody";
  const where = field(after, "companyName") ?? field(before, "companyName");
  const inCompany = where ? ` in ${where}` : "";
  switch (actionKey) {
    case "ORGANIZATION_GROUP_DEPARTMENT_CREATED": return `${name} created`;
    case "ORGANIZATION_GROUP_DEPARTMENT_UPDATED": return `${name} edited`;
    case "ORGANIZATION_GROUP_DEPARTMENT_DEACTIVATED": return `${name} deactivated`;
    case "ORGANIZATION_GROUP_DEPARTMENT_REACTIVATED": return `${name} reactivated`;
    case "ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED": return `${who} appointed head`;
    case "ORGANIZATION_GROUP_DEPARTMENT_HEAD_CHANGED": return `${who} appointed head, replacing ${field(before, "personName") ?? "the previous head"}`;
    case "ORGANIZATION_COMPANY_DEPARTMENT_ACTIVATED": return `Activated${inCompany}`;
    case "ORGANIZATION_COMPANY_DEPARTMENT_DEACTIVATED": return `Deactivated${inCompany}`;
    case "ORGANIZATION_COMPANY_DEPARTMENT_REACTIVATED": return `Reactivated${inCompany}`;
    case "ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED": return `${who} appointed manager${inCompany}`;
    case "ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_CHANGED": return `${who} appointed manager${inCompany}, replacing ${field(before, "personName") ?? "the previous manager"}`;
    case "ORGANIZATION_DEPARTMENT_MEMBER_ASSIGNED": return `${who} added${inCompany}`;
    case "ORGANIZATION_DEPARTMENT_MEMBER_UPDATED": return `${who} moved from ${field(before, "companyName") ?? "one company"} to ${field(after, "companyName") ?? "another"}`;
    case "ORGANIZATION_DEPARTMENT_MEMBER_REMOVED": return `${who} removed${inCompany}`;
    case "ORGANIZATION_DEPARTMENT_ASSIGNMENT_ENDED": {
      const level = field(before, "positionLevel");
      return `${who}'s appointment as ${level === "GROUP_HEAD" ? "head" : "manager"} ended${level === "GROUP_HEAD" ? "" : inCompany}`;
    }
    case "ORGANIZATION_DEPARTMENT_ASSIGNMENT_CREATED": return `${who} placed here when their account was created${inCompany}`;
    default: return actionKey.toLowerCase().replaceAll("_", " ");
  }
}

/** What happened to a department (E-13 §38), newest first, from its audit trail. */
export async function getDepartmentActivity(actor: DepartmentActor, groupDepartmentId: string, limit = 50): Promise<DepartmentActivityDTO[]> {
  const reader = await readerFor(actor, groupDepartmentId);
  const department = await loadGroupDepartment(prisma, groupOf(actor), groupDepartmentId);
  if (!readsTeam(reader, department.id)) throw new AccessError("FORBIDDEN");
  // Before E-13, appointments were recorded against the assignment itself.
  const assignmentIds = (await prisma.departmentAssignment.findMany({ where: { groupDepartmentId: department.id }, select: { id: true } })).map((row) => row.id);
  const events = await prisma.auditEvent.findMany({
    where: { OR: [{ entityType: "GroupDepartment", entityId: department.id }, ...(assignmentIds.length ? [{ entityType: "DepartmentAssignment", entityId: { in: assignmentIds } }] : [])] },
    select: { id: true, occurredAt: true, actionKey: true, beforeJson: true, afterJson: true, actorDisplayNameSnapshot: true, companyId: true },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return events
    .filter((event) => event.companyId === null || inReach(reader, event.companyId))
    .map((event) => ({
      id: event.id,
      at: event.occurredAt.toISOString(),
      actionKey: event.actionKey,
      text: describe(event.actionKey, event.beforeJson as Json, event.afterJson as Json, department.name),
      actor: event.actorDisplayNameSnapshot,
    }));
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * People who could be appointed or added (E-13 §43, §44, §84): everybody of
 * the group with a login, searched by name, with whether they fit and, if not,
 * why. Only ever people of the reader's own group.
 */
export async function listDepartmentCandidates(actor: DepartmentActor, groupDepartmentId: string, query: CandidatesQuery): Promise<CandidateDTO[]> {
  const reader = await readerFor(actor, groupDepartmentId);
  const parentGroupId = groupOf(actor);
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  if (query.position !== "GROUP_HEAD" && !query.company) throw new AccessError("VALIDATION_ERROR", "Choose the company.", { field: "company" });
  const company = query.company ? await loadCompany(prisma, parentGroupId, query.company) : null;
  if (company && !inReach(reader, company.id)) throw new AccessError("NOT_FOUND");
  const branch = company ? await prisma.department.findFirst({ where: { companyId: company.id, groupDepartmentId: department.id }, select: { id: true } }) : null;

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      memberships: { some: { status: "ACTIVE", company: { parentGroupId, status: "ACTIVE" } } },
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { personProfile: { jobTitle: { contains: query.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      ...USER.select,
      memberships: { where: { status: "ACTIVE", company: { parentGroupId, status: "ACTIVE" } }, select: { companyId: true, company: { select: { id: true, name: true } }, role: { select: { key: true } } }, orderBy: { createdAt: "asc" } },
      parentGroupMemberships: { where: { parentGroupId, status: "ACTIVE" }, select: { id: true } },
      departmentAssignments: { where: { ...live(), groupDepartmentId: department.id }, select: { positionLevel: true, companyDepartmentId: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 200,
  });

  const roles = rolesOfFunction(department.key) as readonly string[];
  const fits = (roleKey: string) => roles.length === 0 || roles.includes(roleKey);
  const expected = roles.length ? `works as ${roles.join(" or ").toLowerCase().replaceAll("_", " ")}` : null;
  const preferred = reader.context?.companyId ?? null;

  return users.map((user) => {
    const summary = person(user);
    const companies = user.memberships.map((membership) => membership.company);
    let reason: string | null = null;
    if (query.position === "GROUP_HEAD") {
      const roleKey = (user.memberships.find((membership) => membership.companyId === preferred) ?? user.memberships[0])?.role.key;
      if (user.departmentAssignments.some((row) => row.positionLevel === "GROUP_HEAD")) reason = "Already heads it";
      else if (!roleKey || !fits(roleKey)) reason = expected ? `Not eligible: a head ${expected}` : "Not eligible";
    } else if (query.position === "COMPANY_MANAGER") {
      const here = user.memberships.find((membership) => membership.companyId === company!.id);
      if (!here) reason = "Not eligible for this company";
      else if (!fits(here.role.key)) reason = expected ? `Not eligible: a manager ${expected}` : "Not eligible";
      else if (branch && user.departmentAssignments.some((row) => row.positionLevel === "COMPANY_MANAGER" && row.companyDepartmentId === branch.id)) reason = "Already manages it";
    } else {
      const here = user.memberships.some((membership) => membership.companyId === company!.id);
      if (!here && user.parentGroupMemberships.length === 0) reason = "Not eligible for this company";
      else if (branch && user.departmentAssignments.some((row) => row.positionLevel === "MEMBER" && row.companyDepartmentId === branch.id)) reason = "Already a member";
    }
    return { ...summary, companies, eligible: reason === null, reason };
  });
}

/* -------------------------------------------------------------------------- */
/* A company's departments                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Company → Departments (E-13 §39, §98): every department of the group as this
 * company runs it — active, inactive, or not activated here — with its manager
 * and people. Nothing is created from here; a department is activated.
 */
export async function getCompanyDepartments(actor: DepartmentActor, companyId: string): Promise<CompanyDepartmentsDTO> {
  const reader = await readerFor(actor, null);
  const parentGroupId = groupOf(actor);
  const company = await loadCompany(prisma, parentGroupId, companyId);
  if (!inReach(reader, company.id)) throw new AccessError("NOT_FOUND");

  const configures = reader.context ? can(reader.context, "organization.department.manage") : true;
  const departments = await prisma.groupDepartment.findMany({
    where: { parentGroupId, OR: [{ status: "ACTIVE" }, { branches: { some: { companyId: company.id } } }] },
    select: { id: true, key: true, code: true, name: true, status: true },
  });
  const branches = await prisma.department.findMany({ where: { companyId: company.id, groupDepartmentId: { in: departments.map((row) => row.id) } }, select: { id: true, groupDepartmentId: true } });
  const rows = await Promise.all(branches.map((branch) => branchRows(branch.groupDepartmentId!, [company.id], parentGroupId)));
  const byDepartment = new Map(rows.flat().map((row) => [row.groupDepartmentId, row]));

  let acting: UserContext | null = null;
  let configuresHere = configures;
  let implementing = true;
  if (reader.context) {
    acting = (await actingContexts(reader.context, [company.id])).get(company.id) ?? null;
    configuresHere = Boolean(acting && can(acting, "organization.department.manage"));
  } else {
    const actorPlatform = actor as Extract<DepartmentActor, { kind: "platform" }>;
    const group = await prisma.parentGroup.findFirst({ where: { id: actorPlatform.parentGroupId }, select: { status: true } });
    implementing = group?.status === "IMPLEMENTING" || group?.status === "READY_FOR_VALIDATION";
    configuresHere = implementing && canPlatform(actorPlatform.context, "platform.group.configure");
  }

  return {
    company,
    rows: byChart(departments).map((department) => {
      const branch = byDepartment.get(department.id) ?? null;
      const open = department.status === "ACTIVE";
      return {
        department: { id: department.id, code: department.code, name: department.name, status: statusOf(department.status) },
        branch,
        canActivate: open && configuresHere && company.status === "ACTIVE",
        canAppointManager: open && branch?.status === "ACTIVE" && (acting ? mayAppointManagerIn(acting, department.id) : implementing && !reader.context && canPlatform((actor as Extract<DepartmentActor, { kind: "platform" }>).context, "platform.user.initial_provision")),
      };
    }),
  };
}

/** Organization → Companies (E-13 §7, §96): each company in reach and how far its departments are set up. */
export async function listOrganizationCompanies(actor: DepartmentActor) {
  const reader = await readerFor(actor, null);
  const parentGroupId = groupOf(actor);
  const companies = await prisma.company.findMany({
    where: { parentGroupId, ...(reader.companyIds ? { id: { in: reader.companyIds } } : {}) },
    select: {
      id: true,
      name: true,
      status: true,
      departments: {
        where: { status: "ACTIVE", groupDepartmentId: { not: null }, groupDepartment: { status: "ACTIVE" } },
        select: { id: true, assignments: { where: { ...live(), positionLevel: { in: ["MEMBER", "COMPANY_MANAGER"] } }, select: { userId: true, positionLevel: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    status: company.status,
    activeDepartments: company.departments.length,
    withManager: company.departments.filter((branch) => branch.assignments.some((row) => row.positionLevel === "COMPANY_MANAGER")).length,
    people: new Set(company.departments.flatMap((branch) => branch.assignments.map((row) => row.userId))).size,
  }));
}

/* -------------------------------------------------------------------------- */
/* A person's places                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The departments a person holds a place in (E-13 §87), for their profile:
 * department, company, position. The chart is the group's to read, so this
 * needs nothing beyond seeing the person.
 */
export async function personDepartmentPlaces(parentGroupId: string, userId: string | null): Promise<PersonDepartmentDTO[]> {
  if (!userId) return [];
  const rows = await prisma.departmentAssignment.findMany({
    where: { ...live(), parentGroupId, userId, groupDepartment: { status: "ACTIVE" }, OR: [{ companyDepartmentId: null }, { companyDepartment: { status: "ACTIVE" } }] },
    select: { positionLevel: true, groupDepartment: { select: { id: true, key: true, code: true, name: true } }, company: { select: { id: true, name: true } } },
  });
  return rows
    .map((row) => ({ department: { id: row.groupDepartment.id, code: row.groupDepartment.code, name: row.groupDepartment.name }, company: row.company, position: row.positionLevel as PositionDTO }))
    .sort((a, b) => RANK[b.position] - RANK[a.position] || a.department.name.localeCompare(b.department.name) || (a.company?.name ?? "").localeCompare(b.company?.name ?? ""));
}
