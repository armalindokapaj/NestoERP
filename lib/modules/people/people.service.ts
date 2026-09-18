import type { EmploymentStatus, Prisma } from "@prisma/client";

import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { employmentsVisibleTo } from "@/lib/modules/hr/employees/employment.view";
import { canViewPersonHistory } from "@/lib/modules/hr/employment/employment.query";
import { personInRecordReach, updatePersonWorkProfile, type WorkProfileChange } from "@/lib/modules/hr/person.doors";
import { portfolioProjectWhere, resolveProjectPortfolio } from "@/lib/modules/projects/project.portfolio";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import type { PersonDepartmentDTO } from "@/lib/modules/organization/departments/department.types";
import type { DirectoryQuery, ManagedWorkProfileInput, OwnWorkProfileInput } from "./people.schema";
import type {
  DirectoryDTO,
  EmploymentViewDTO,
  PersonActivityDTO,
  PersonCardDTO,
  PersonPlacementDTO,
  PersonProjectDTO,
  PrivateProfileDTO,
  WorkProfileDTO,
  WorkStatus,
} from "./people.types";

/**
 * The group's people, as colleagues know them (E-01, ADR 0002).
 *
 * A person is read inside the reader's parent group and nowhere else: an id
 * from another group is simply not found (§6, §182). What a colleague reads
 * is the work profile — the person's work contact and bio, the membership's
 * department and in-company title, the employment's company, manager and a
 * status without its reason. The employment itself is HR's and is read
 * through HR's rules; the private record is the person record's and is read
 * through its own. Neither is ever fetched for the work profile (§121).
 *
 * The people module writes nothing of its own. A person's work profile is
 * changed through HR's person door, by the person (their bio, extension,
 * office and preferred name) or by those who keep person records.
 */

const MODULE = "people" as const;

/** Employments that make somebody somebody who works here today. */
const WORKING: EmploymentStatus[] = ["ACTIVE", "ON_LEAVE", "SUSPENDED"];
const EMPLOYMENT_RANK: Record<EmploymentStatus, number> = { ACTIVE: 0, ON_LEAVE: 1, SUSPENDED: 2, PLANNED: 3, ENDED: 4 };

/* -------------------------------------------------------------------------- */
/* Who is visible                                                              */
/* -------------------------------------------------------------------------- */

/** People who work in the group today: an active login in an active company, or a current employment (E-01 §35, §40). */
function workingWhere(parentGroupId: string): Prisma.PersonProfileWhereInput {
  return {
    parentGroupId,
    OR: [
      { user: { is: { status: "ACTIVE", memberships: { some: { status: "ACTIVE", company: { parentGroupId, status: "ACTIVE" } } } } } },
      { employments: { some: { employmentStatus: { in: WORKING }, company: { parentGroupId, status: "ACTIVE" } } } },
    ],
  };
}

/** Everyone who has worked in the group, for those who keep person records. A candidate who never joined is recruitment's, not the directory's. */
function everWorkedWhere(parentGroupId: string): Prisma.PersonProfileWhereInput {
  return {
    parentGroupId,
    OR: [{ user: { is: { memberships: { some: { company: { parentGroupId } } } } } }, { employments: { some: { company: { parentGroupId } } } }],
  };
}

/** Whether "people who no longer work here" is this reader's to see (E-01 §40): those who keep person records. */
function seesFormerPeople(context: UserContext): boolean {
  return can(context, "person_profile.view");
}

async function ownPersonId(context: UserContext): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { personProfileId: true } });
  return user?.personProfileId ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reading a person                                                            */
/* -------------------------------------------------------------------------- */

function personSelect(parentGroupId: string) {
  return {
    id: true,
    firstName: true,
    lastName: true,
    preferredName: true,
    jobTitle: true,
    workEmail: true,
    workPhone: true,
    workPhoneExtension: true,
    officeLocation: true,
    user: {
      select: {
        id: true,
        status: true,
        memberships: {
          where: { company: { parentGroupId } },
          select: {
            id: true,
            companyId: true,
            status: true,
            jobTitle: true,
            createdAt: true,
            role: { select: { key: true, name: true } },
            company: { select: { id: true, name: true, status: true } },
            department: { select: { name: true, groupDepartment: { select: { key: true } } } },
            _count: { select: { projectMemberships: { where: { status: "ACTIVE", project: { archivedAt: null } } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    },
    employments: {
      where: { company: { parentGroupId } },
      select: {
        id: true,
        companyId: true,
        employmentStatus: true,
        startDate: true,
        createdAt: true,
        // Where the employment says they sit today (E-03 §6, §54; ADR 0004 decision 9).
        jobTitle: true,
        department: { select: { name: true, groupDepartment: { select: { key: true } } } },
        company: { select: { id: true, name: true } },
        managerMember: { select: { jobTitle: true, user: { select: { firstName: true, lastName: true, personProfileId: true, personProfile: { select: { jobTitle: true } } } } } },
      },
    },
  } satisfies Prisma.PersonProfileSelect;
}

type PersonRow = Prisma.PersonProfileGetPayload<{ select: ReturnType<typeof personSelect> }>;

/** The employment a profile speaks for: the current one, else the most recent (E-01 §7). */
function primaryEmployment(row: PersonRow) {
  return [...row.employments].sort(
    (a, b) =>
      EMPLOYMENT_RANK[a.employmentStatus] - EMPLOYMENT_RANK[b.employmentStatus] ||
      (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

function activeMemberships(row: PersonRow) {
  if (!row.user || row.user.status !== "ACTIVE") return [];
  return row.user.memberships.filter((membership) => membership.status === "ACTIVE" && membership.company.status === "ACTIVE");
}

/** The membership the profile shows: in the employing company if there is one, else the oldest. */
function primaryMembership(row: PersonRow) {
  const memberships = activeMemberships(row);
  const employment = primaryEmployment(row);
  return memberships.find((membership) => membership.companyId === employment?.companyId) ?? memberships[0] ?? null;
}

function workStatus(row: PersonRow): WorkStatus {
  const employment = primaryEmployment(row);
  if (employment?.employmentStatus === "ON_LEAVE") return "ON_LEAVE";
  if (employment?.employmentStatus === "SUSPENDED" || row.user?.status === "SUSPENDED") return "SUSPENDED";
  if (employment?.employmentStatus === "ACTIVE" || activeMemberships(row).length > 0) return "ACTIVE";
  return "INACTIVE";
}

/**
 * The job title and department a profile shows (ADR 0004 decision 9): the
 * current employment's, which HR keeps as history; for somebody with no running
 * employment, the person's professional title and the membership's department.
 */
function currentTitle(row: PersonRow): string | null {
  const employment = primaryEmployment(row);
  const running = employment && employment.employmentStatus !== "ENDED" ? employment : null;
  return running?.jobTitle ?? row.jobTitle ?? primaryMembership(row)?.jobTitle ?? null;
}

function currentDepartment(row: PersonRow): PersonCardDTO["department"] {
  const employment = primaryEmployment(row);
  const department = (employment && employment.employmentStatus !== "ENDED" ? employment.department : null) ?? primaryMembership(row)?.department ?? null;
  return department ? { name: department.name, groupDepartmentKey: department.groupDepartment?.key ?? null } : null;
}

function toCard(row: PersonRow): PersonCardDTO {
  const employment = primaryEmployment(row);
  return {
    personId: row.id,
    name: `${row.firstName} ${row.lastName}`,
    preferredName: row.preferredName,
    initials: { firstName: row.firstName, lastName: row.lastName },
    jobTitle: currentTitle(row),
    employingCompany: employment ? employment.company : null,
    department: currentDepartment(row),
    workEmail: row.workEmail,
    workPhone: row.workPhone,
    workPhoneExtension: row.workPhoneExtension,
    officeLocation: row.officeLocation,
    status: workStatus(row),
    activeProjectCount: activeMemberships(row).reduce((sum, row) => sum + row._count.projectMemberships, 0),
  };
}

/* -------------------------------------------------------------------------- */
/* The directory                                                               */
/* -------------------------------------------------------------------------- */

function contains(value: string) {
  return { contains: value, mode: "insensitive" as const };
}

export async function listPeople(context: UserContext, query: DirectoryQuery): Promise<DirectoryDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.directory.view");
  const group = context.parentGroupId;
  const includeFormer = query.status === "all" && seesFormerPeople(context);

  const and: Prisma.PersonProfileWhereInput[] = [includeFormer ? everWorkedWhere(group) : workingWhere(group)];
  // Every word must match a name, a title or a work contact (E-01 §37).
  for (const word of (query.q ?? "").split(/\s+/).filter(Boolean).slice(0, 4)) {
    and.push({
      OR: [
        { firstName: contains(word) },
        { lastName: contains(word) },
        { preferredName: contains(word) },
        { jobTitle: contains(word) },
        { workEmail: contains(word) },
        { workPhone: contains(word) },
        { user: { is: { memberships: { some: { company: { parentGroupId: group }, jobTitle: contains(word) } } } } },
        // The current title of a running employment — never a past one (E-03 §138, §139).
        { employments: { some: { company: { parentGroupId: group }, employmentStatus: { in: WORKING }, jobTitle: contains(word) } } },
      ],
    });
  }
  if (query.company) {
    and.push({
      OR: [
        { user: { is: { memberships: { some: { companyId: query.company, company: { parentGroupId: group }, ...(includeFormer ? {} : { status: "ACTIVE" }) } } } } },
        { employments: { some: { companyId: query.company, company: { parentGroupId: group }, ...(includeFormer ? {} : { employmentStatus: { in: WORKING } }) } } },
      ],
    });
  }
  if (query.department) {
    and.push({
      OR: [
        {
          user: {
            is: {
              OR: [
                { memberships: { some: { status: "ACTIVE", company: { parentGroupId: group }, department: { groupDepartment: { key: query.department } } } } },
                { departmentAssignments: { some: { parentGroupId: group, status: "ACTIVE", groupDepartment: { key: query.department } } } },
              ],
            },
          },
        },
        { employments: { some: { company: { parentGroupId: group }, employmentStatus: { in: WORKING }, department: { groupDepartment: { key: query.department } } } } },
      ],
    });
  }
  if (query.title) {
    and.push({
      OR: [
        { jobTitle: contains(query.title) },
        { user: { is: { memberships: { some: { company: { parentGroupId: group }, jobTitle: contains(query.title) } } } } },
        { employments: { some: { company: { parentGroupId: group }, employmentStatus: { in: WORKING }, jobTitle: contains(query.title) } } },
      ],
    });
  }
  if (query.project) {
    and.push({ user: { is: { memberships: { some: { company: { parentGroupId: group }, projectMemberships: { some: { projectId: query.project, status: "ACTIVE" } } } } } } });
  }
  if (query.location) {
    and.push({ OR: [{ officeLocation: contains(query.location) }, { employments: { some: { company: { parentGroupId: group }, workLocation: contains(query.location) } } }] });
  }

  const where: Prisma.PersonProfileWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.personProfile.count({ where }),
    prisma.personProfile.findMany({
      where,
      select: personSelect(group),
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return { data: rows.map(toCard), pagination: paginationMeta(total, query.page, query.limit), canIncludeInactive: seesFormerPeople(context) };
}

export type DirectoryFilterOptionsDTO = {
  companies: Array<{ id: string; name: string }>;
  departments: Array<{ key: string; name: string }>;
};

/** What the directory can be narrowed by: the group's companies and departments (E-01 §38). */
export async function directoryFilterOptions(context: UserContext): Promise<DirectoryFilterOptionsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.directory.view");
  const [companies, departments] = await Promise.all([
    prisma.company.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.groupDepartment.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { key: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { companies, departments };
}

/* -------------------------------------------------------------------------- */
/* One person                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The person, if this reader may see them at all: somebody who works in the
 * group; somebody who has, for those who keep person records; and yourself.
 * Anything else — another group's person, a candidate — is not found.
 */
async function visiblePerson(context: UserContext, personId: string): Promise<{ row: PersonRow; isSelf: boolean }> {
  const self = (await ownPersonId(context)) === personId;
  const scope = self ? { parentGroupId: context.parentGroupId } : seesFormerPeople(context) ? everWorkedWhere(context.parentGroupId) : workingWhere(context.parentGroupId);
  const row = await prisma.personProfile.findFirst({ where: { AND: [{ id: personId }, scope] }, select: personSelect(context.parentGroupId) });
  if (!row) throw new AccessError("NOT_FOUND");
  return { row, isSelf: self };
}

export async function getWorkProfile(context: UserContext, personId: string): Promise<WorkProfileDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row, isSelf } = await visiblePerson(context, personId);
  const card = toCard(row);
  const userId = row.user?.id ?? null;

  const [details, assignments, projects, employments, reach] = await Promise.all([
    prisma.personProfile.findFirstOrThrow({ where: { id: row.id, parentGroupId: context.parentGroupId }, select: { professionalBio: true, parentGroup: { select: { name: true } } } }),
    userId
      ? prisma.departmentAssignment.findMany({
          where: { userId, parentGroupId: context.parentGroupId },
          select: {
            positionLevel: true,
            status: true,
            startsAt: true,
            endsAt: true,
            companyId: true,
            createdAt: true,
            groupDepartment: { select: { id: true, code: true, name: true, status: true } },
            companyDepartment: { select: { status: true } },
            company: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    userId ? projectsOf(context, userId) : Promise.resolve([]),
    employmentsVisibleTo(context, row.id),
    personInRecordReach(context, row.id),
  ]);

  const now = new Date();
  const current = assignments.filter((row) => row.status === "ACTIVE" && (!row.endsAt || row.endsAt > now) && (!row.startsAt || row.startsAt <= now));
  // Positions — head or manager — are what the profile has always named; member places are listed with them below (E-13 §87).
  const live = current.filter((row) => row.positionLevel !== "MEMBER");
  const RANK = { GROUP_HEAD: 3, COMPANY_MANAGER: 2, MEMBER: 1 } as const;
  const departments: PersonDepartmentDTO[] = current
    .filter((row) => row.groupDepartment.status === "ACTIVE" && (!row.companyDepartment || row.companyDepartment.status === "ACTIVE"))
    .map((row) => ({ department: { id: row.groupDepartment.id, code: row.groupDepartment.code, name: row.groupDepartment.name }, company: row.company, position: row.positionLevel }))
    .sort((a, b) => a.department.name.localeCompare(b.department.name) || RANK[b.position] - RANK[a.position] || (a.company?.name ?? "").localeCompare(b.company?.name ?? ""));
  const positionText = (position: (typeof assignments)[number]) =>
    position.positionLevel === "GROUP_HEAD" ? `Head of Group ${position.groupDepartment.name}` : `${position.groupDepartment.name} manager, ${position.company?.name ?? ""}`.trim();

  const companies: PersonPlacementDTO[] = activeMemberships(row).map((membership) => ({
    company: { id: membership.company.id, name: membership.company.name },
    role: { key: membership.role.key, label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name },
    jobTitle: membership.jobTitle,
    department: membership.department?.name ?? null,
    positions: live.filter((position) => position.companyId === membership.companyId).map((position) => `${position.groupDepartment.name} manager`),
  }));

  const employment = primaryEmployment(row);
  const manager = employment?.managerMember
    ? {
        personId: employment.managerMember.user.personProfileId,
        name: `${employment.managerMember.user.firstName} ${employment.managerMember.user.lastName}`,
        // The manager's title where they manage from: their membership carries their employment's (ADR 0004).
        jobTitle: employment.managerMember.jobTitle ?? employment.managerMember.user.personProfile?.jobTitle ?? null,
      }
    : null;
  const membership = primaryMembership(row);

  const activity: PersonActivityDTO[] = [
    ...projects.flatMap((project) => [
      ...(project.joinedAt ? [{ at: project.joinedAt, kind: "PROJECT_JOINED" as const, text: `Joined ${project.name}` }] : []),
      ...(project.leftAt ? [{ at: project.leftAt, kind: "PROJECT_LEFT" as const, text: `Left ${project.name}` }] : []),
    ]),
    ...assignments.filter((position) => position.positionLevel !== "MEMBER").flatMap((position) => {
      const text = positionText(position);
      const started = position.startsAt ?? position.createdAt;
      return [
        { at: started.toISOString(), kind: "POSITION_STARTED" as const, text: `Became ${text}` },
        ...(position.endsAt && position.endsAt <= now ? [{ at: position.endsAt.toISOString(), kind: "POSITION_ENDED" as const, text: `No longer ${text}` }] : []),
      ];
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  return {
    ...card,
    professionalBio: details.professionalBio,
    parentGroup: { name: details.parentGroup.name },
    role: membership ? { key: membership.role.key, label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name } : null,
    manager,
    companies,
    groupPositions: live.filter((position) => position.positionLevel === "GROUP_HEAD").map(positionText),
    departments,
    projects,
    activity,
    capabilities: {
      isSelf,
      canEditOwn: isSelf && can(context, "people.profile.edit_self"),
      canManage: can(context, "person_profile.update") && reach,
      canViewEmployment: employments.length > 0,
      canViewHistory: employments.length > 0 && (await canViewPersonHistory(context, row.id)),
      canViewPrivate: isSelf || (can(context, "person_profile.view") && reach),
    },
  };
}

/**
 * Projects from `ProjectMember` alone (E-01 §41-§46): what the person is on and
 * was on, with a link only where this reader can open the project. Seeing
 * that somebody works on a project is not access to it (§44).
 */
async function projectsOf(context: UserContext, userId: string): Promise<PersonProjectDTO[]> {
  const rows = await prisma.projectMember.findMany({
    where: { member: { userId, company: { parentGroupId: context.parentGroupId } }, project: { archivedAt: null } },
    select: {
      status: true,
      projectRole: true,
      joinedAt: true,
      leftAt: true,
      project: { select: { id: true, code: true, name: true, company: { select: { id: true, name: true } } } },
    },
    orderBy: [{ status: "asc" }, { joinedAt: { sort: "desc", nulls: "last" } }],
    take: 50,
  });
  if (rows.length === 0) return [];
  const portfolio = await resolveProjectPortfolio(context);
  const openable = new Set(
    (await prisma.project.findMany({ where: { AND: [portfolioProjectWhere(portfolio), { id: { in: rows.map((row) => row.project.id) } }] }, select: { id: true } })).map((row) => row.id),
  );
  return rows.map((row) => ({
    projectId: openable.has(row.project.id) ? row.project.id : null,
    code: row.project.code,
    name: row.project.name,
    company: row.project.company,
    projectRole: row.projectRole,
    status: row.status,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    leftAt: row.leftAt?.toISOString() ?? null,
    href: openable.has(row.project.id) ? `/projects/${row.project.id}` : null,
  }));
}

/** The Employment tab (E-01 §98): HR's records of the person, as HR lets this reader see them. */
export async function getEmploymentView(context: UserContext, personId: string): Promise<EmploymentViewDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row } = await visiblePerson(context, personId);
  const employments = await employmentsVisibleTo(context, row.id);
  // Nothing visible is a refusal, not an empty tab: the tab does not exist for this reader (§165, §170).
  if (employments.length === 0) throw new AccessError("FORBIDDEN");
  return employments;
}

/** The private view (E-01 §34, §100): the person themselves, or those who keep person records within their reach. */
export async function getPrivateProfile(context: UserContext, personId: string): Promise<PrivateProfileDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row, isSelf } = await visiblePerson(context, personId);
  if (!isSelf && !(can(context, "person_profile.view") && (await personInRecordReach(context, row.id)))) throw new AccessError("FORBIDDEN");
  const person = await prisma.personProfile.findFirstOrThrow({
    where: { id: row.id, parentGroupId: context.parentGroupId },
    select: { personalEmail: true, personalPhone: true, dateOfBirth: true, address: true, city: true, country: true },
  });
  return { ...person, dateOfBirth: person.dateOfBirth?.toISOString().slice(0, 10) ?? null };
}

/* -------------------------------------------------------------------------- */
/* Changing a work profile                                                     */
/* -------------------------------------------------------------------------- */

async function applyChange(context: UserContext, personId: string, change: WorkProfileChange, via: "SELF" | "MANAGED"): Promise<WorkProfileDTO> {
  const before = await prisma.personProfile.findFirstOrThrow({
    where: { id: personId, parentGroupId: context.parentGroupId },
    select: { firstName: true, lastName: true, preferredName: true, jobTitle: true, workEmail: true, workPhoneExtension: true, officeLocation: true, professionalBio: true },
  });
  const changed = Object.fromEntries(Object.entries(change).filter(([key, value]) => value !== undefined && value !== before[key as keyof typeof before])) as WorkProfileChange;
  if (Object.keys(changed).length > 0) {
    await prisma.$transaction(async (tx) => {
      await updatePersonWorkProfile(tx, { personProfileId: personId, parentGroupId: context.parentGroupId, change: changed });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PERSON_WORK_PROFILE_UPDATED,
          entity: { type: "PersonProfile", id: personId, label: `${before.firstName} ${before.lastName}` },
          before: Object.fromEntries(Object.keys(changed).map((key) => [key, before[key as keyof typeof before]])),
          after: changed,
          metadata: { via },
        },
        { tx },
      );
    });
  }
  return getWorkProfile(context, personId);
}

/** Your own bio, extension, office and preferred name (E-01 §53, §116, §124). Name and phone stay your account's. */
export async function updateOwnWorkProfile(context: UserContext, input: OwnWorkProfileInput): Promise<WorkProfileDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.edit_self");
  const personId = await ownPersonId(context);
  if (!personId) throw new AccessError("NOT_FOUND");
  return applyChange(context, personId, input, "SELF");
}

/** Somebody's work profile, by those who keep person records within their reach (E-01 §116, §125, §133). */
export async function updateManagedWorkProfile(context: UserContext, personId: string, input: ManagedWorkProfileInput): Promise<WorkProfileDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "person_profile.update");
  const { row } = await visiblePerson(context, personId);
  if (!(await personInRecordReach(context, personId))) throw new AccessError("NOT_FOUND");
  // Somebody employed has the title their employment says, changed as a dated
  // change in HR and kept as history — not overwritten here (E-03 §187, ADR 0004).
  const employed = row.employments.some((employment) => employment.employmentStatus !== "ENDED");
  if (employed && input.jobTitle !== undefined && (input.jobTitle ?? null) !== (row.jobTitle ?? null)) {
    throw new AccessError("CONFLICT", "Their job title comes from their employment. Change it in HR, where the change is kept as history.", { field: "jobTitle", code: "TITLE_FROM_EMPLOYMENT" });
  }
  return applyChange(context, personId, { preferredName: input.preferredName, jobTitle: employed ? undefined : input.jobTitle, workEmail: input.workEmail, workPhoneExtension: input.workPhoneExtension, officeLocation: input.officeLocation }, "MANAGED");
}

/** The signed-in person's own profile id, for `/people/me`. */
export async function myPersonId(context: UserContext): Promise<string | null> {
  return ownPersonId(context);
}
