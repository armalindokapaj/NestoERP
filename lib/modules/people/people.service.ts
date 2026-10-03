import { assignedCompany } from "@/lib/access/project-ownership";
import { Prisma, type EmploymentStatus } from "@prisma/client";

import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { listEmployeeDocuments } from "@/lib/modules/hr/documents/employee-document.service";
import type { EmployeeDocumentsDTO } from "@/lib/modules/hr/documents/employee-document.types";
import { employmentsVisibleTo } from "@/lib/modules/hr/employees/employment.view";
import { canViewPersonHistory } from "@/lib/modules/hr/employment/employment.query";
import { personInRecordReach, updatePersonWorkProfile, type WorkProfileChange } from "@/lib/modules/hr/person.doors";
import { summaryQualificationWhere } from "@/lib/modules/hr/qualifications/qualification.access";
import { getPersonQualifications } from "@/lib/modules/hr/qualifications/qualification.service";
import { QUALIFICATION_TYPE_RULES, type PersonQualificationsDTO } from "@/lib/modules/hr/qualifications/qualification.types";
import { portfolioProjectWhere, resolveProjectPortfolio } from "@/lib/modules/projects/project.portfolio";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor } from "@/lib/modules/shared/list-query";
import type { PersonDepartmentDTO } from "@/lib/modules/organization/departments/department.types";
import { ALL_COMPANIES } from "./people.schema";
import type { DirectoryQuery, ManagedWorkProfileInput, OwnWorkProfileInput } from "./people.schema";
import type {
  AccessSummaryDTO,
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
/** People working in the group today: the directory's own reach, which search reuses so it never finds somebody the directory would not list. */
export function workingPeopleWhere(parentGroupId: string): Prisma.PersonProfileWhereInput {
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

/**
 * People who worked in the group and no longer do (E-08 §54): an ended
 * employment, or a login whose place in the group was closed. Not a candidate
 * or somebody whose employment has not started (§119), and not somebody
 * suspended — they are away, not gone.
 */
function formerPeopleWhere(parentGroupId: string): Prisma.PersonProfileWhereInput {
  return {
    AND: [
      { parentGroupId },
      { NOT: workingPeopleWhere(parentGroupId) },
      {
        OR: [
          { employments: { some: { company: { parentGroupId }, employmentStatus: "ENDED" } } },
          { user: { is: { memberships: { some: { company: { parentGroupId }, status: "INACTIVE" } } } } },
          { user: { is: { status: "INACTIVE", memberships: { some: { company: { parentGroupId } } } } } },
        ],
      },
    ],
  };
}

/** Whether "people who no longer work here" is this reader's to see (E-01 §40): those who keep person records. */
function seesFormerPeople(context: UserContext): boolean {
  return can(context, "person_profile.view");
}

/**
 * Opens the profile of anybody who has been in the group, working or not: those
 * who keep person records, and the access administrators — Group IT creates a
 * selected candidate's login from her profile and closes a leaver's (E-08 §46,
 * §117). The directory still lists them only for the former (§54).
 */
function opensEveryone(context: UserContext): boolean {
  return seesFormerPeople(context) || can(context, "organization.access.view");
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
    photoChecksum: true,
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
    photoUrl: photoUrlOf(row.id, row.photoChecksum),
  };
}

/** A photo's URL carries its checksum, so a new photo is a new URL and an old one may be cached (E-08 §43, §108). */
export function photoUrlOf(personId: string, checksum: string | null): string | null {
  return checksum ? `/api/people/${personId}/photo?v=${checksum.slice(0, 16)}` : null;
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
  // The workspace is the directory's *default* scope, not a wall (Workspace
  // Context §46, §85): a company workspace opens on that company's people, and
  // the company filter still widens to the whole group, because the directory
  // is the group's for everyone who works in it (E-01 §103). The Group
  // workspace opens on the group, which the same filter may narrow (§86, §87).
  const workspaceCompany = context.workspace.scopeType === "COMPANY" ? context.companyId : null;
  const companyFilter = query.company === ALL_COMPANIES ? undefined : (query.company ?? workspaceCompany ?? undefined);

  const and: Prisma.PersonProfileWhereInput[] = [includeFormer ? everWorkedWhere(group) : workingPeopleWhere(group)];
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
  if (companyFilter) {
    and.push({
      OR: [
        { user: { is: { memberships: { some: { companyId: companyFilter, company: { parentGroupId: group }, ...(includeFormer ? {} : { status: "ACTIVE" }) } } } } },
        { employments: { some: { companyId: companyFilter, company: { parentGroupId: group }, ...(includeFormer ? {} : { employmentStatus: { in: WORKING } }) } } },
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
    // Only a project the reader may open, in any company of theirs: a project they cannot see is no
    // result at all, not a list of its members (AUD-08 §3, DT-22).
    const openable = portfolioProjectWhere(await resolveProjectPortfolio(context));
    and.push({ user: { is: { memberships: { some: { company: { parentGroupId: group }, projectMemberships: { some: { projectId: query.project, status: "ACTIVE", project: openable } } } } } } });
  }
  if (query.location) {
    and.push({ OR: [{ officeLocation: contains(query.location) }, { employments: { some: { company: { parentGroupId: group }, workLocation: contains(query.location) } } }] });
  }
  if (query.manager) {
    // Reports to them: a running employment in the group whose manager is one of the manager's memberships (E-08 §20, §41).
    and.push({ employments: { some: { company: { parentGroupId: group }, employmentStatus: { in: WORKING }, managerMember: { user: { personProfileId: query.manager } } } } });
  }
  if (query.role) {
    and.push({ user: { is: { memberships: { some: { status: "ACTIVE", company: { parentGroupId: group }, role: { key: query.role } } } } } });
  }
  if (query.view === "company" && workspaceCompany === null) {
    // The reader's own company has no meaning in the Group workspace, which has none (§4).
    and.push({ id: { in: [] } });
  } else if (query.view === "company") {
    and.push({
      OR: [
        { user: { is: { memberships: { some: { companyId: context.companyId, status: "ACTIVE" } } } } },
        { employments: { some: { companyId: context.companyId, employmentStatus: { in: WORKING } } } },
      ],
    });
  } else if (query.view === "department") {
    // The reader's own group department, across the group's companies (E-08 §14).
    const own = await prisma.companyMember.findFirst({ where: { id: context.membershipId, companyId: context.companyId }, select: { department: { select: { groupDepartment: { select: { key: true } } } } } });
    const key = own?.department?.groupDepartment?.key;
    and.push(
      key
        ? {
            OR: [
              { user: { is: { memberships: { some: { status: "ACTIVE", company: { parentGroupId: group }, department: { groupDepartment: { key } } } } } } },
              { employments: { some: { company: { parentGroupId: group }, employmentStatus: { in: WORKING }, department: { groupDepartment: { key } } } } },
            ],
          }
        : { id: { in: [] } },
    );
  } else if (query.view === "projects") {
    // Colleagues on a project the reader is on (E-08 §15, §91).
    const mine = await prisma.projectMember.findMany({ where: { companyMemberId: context.membershipId, status: "ACTIVE" }, select: { projectId: true } });
    and.push({ user: { is: { memberships: { some: { company: { parentGroupId: group }, projectMemberships: { some: { status: "ACTIVE", projectId: { in: mine.map((row) => row.projectId) } } } } } } } });
  }

  const where: Prisma.PersonProfileWhereInput = { AND: and };
  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "people.directory.list",
    async (tx) => {
      const window = pageWindow(await tx.personProfile.count({ where }), query.page, query.limit);
      const rows = await tx.personProfile.findMany({
        where,
        select: personSelect(group),
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        skip: skipFor(window.page, window.limit),
        take: window.limit,
      });
      return { rows, window };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 },
  );

  return { data: rows.map(toCard), pagination: window, canIncludeInactive: seesFormerPeople(context) };
}

export type DirectoryFilterOptionsDTO = {
  companies: Array<{ id: string; name: string }>;
  departments: Array<{ key: string; name: string }>;
  roles: Array<{ key: string; label: string }>;
};

/** What the directory can be narrowed by: the group's companies and departments (E-01 §38). */
export async function directoryFilterOptions(context: UserContext): Promise<DirectoryFilterOptionsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.directory.view");
  const [companies, departments, roles] = await Promise.all([
    // Offered in either workspace: a company workspace opens on its own company
    // and the filter is how somebody widens to the group's directory (§85, §86).
    prisma.company.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.groupDepartment.findMany({ where: { parentGroupId: context.parentGroupId, status: "ACTIVE" }, select: { key: true, name: true }, orderBy: { name: "asc" } }),
    // The roles somebody in the group holds today (§41), not every role NESTO knows.
    prisma.role.findMany({ where: { members: { some: { status: "ACTIVE", company: { parentGroupId: context.parentGroupId, status: "ACTIVE" } } } }, select: { key: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { companies, departments, roles: roles.map((role) => ({ key: role.key, label: isMembershipRoleKey(role.key) ? roleLabel(role.key) : role.name })) };
}

/* -------------------------------------------------------------------------- */
/* One person                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The person, if this reader may see them at all: somebody who works or has
 * worked in the group, and yourself. Anything else — another group's person, a
 * candidate — is not found. `former` is somebody who no longer works here, seen
 * by a colleague rather than by those who keep person records: their name and
 * where they were still resolve from the records they left behind, as E-08
 * §54-§55 asks, but nothing that reached them at work (§118).
 */
async function visiblePerson(context: UserContext, personId: string): Promise<{ row: PersonRow; isSelf: boolean; former: boolean }> {
  const self = (await ownPersonId(context)) === personId;
  const group = context.parentGroupId;
  const hr = opensEveryone(context);
  const scope = self ? { parentGroupId: group } : hr ? everWorkedWhere(group) : { OR: [workingPeopleWhere(group), formerPeopleWhere(group)] };
  const row = await prisma.personProfile.findFirst({ where: { AND: [{ id: personId }, scope] }, select: personSelect(group) });
  if (!row) throw new AccessError("NOT_FOUND");
  const former = !self && !hr && (await prisma.personProfile.count({ where: { AND: [{ id: personId }, workingPeopleWhere(group)] } })) === 0;
  return { row, isSelf: self, former };
}

export async function getWorkProfile(context: UserContext, personId: string): Promise<WorkProfileDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row, isSelf, former } = await visiblePerson(context, personId);
  const card = toCard(row);
  if (former) return formerProfile(card);
  const userId = row.user?.id ?? null;

  const membershipIds = row.user?.memberships.map((membership) => membership.id) ?? [];
  const [details, assignments, projects, employments, reach, verified, own, reports] = await Promise.all([
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
    // Professional activity colleagues may see: what the person shares with the group, once verified (E-02 §145, §146).
    prisma.personQualification.findMany({
      where: { AND: [summaryQualificationWhere(context), { personProfileId: row.id, verifiedAt: { not: null } }] },
      select: { type: true, title: true, verifiedAt: true },
      orderBy: { verifiedAt: "desc" },
      take: 20,
    }),
    ownPersonId(context),
    // The other side of "Reports to" (E-08 §21): running employments in the group that name one of their memberships as manager.
    membershipIds.length
      ? prisma.employeeProfile.findMany({
          where: { managerMemberId: { in: membershipIds }, employmentStatus: { in: WORKING }, company: { parentGroupId: context.parentGroupId, status: "ACTIVE" } },
          select: { jobTitle: true, company: { select: { name: true } }, personProfile: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: [{ personProfile: { lastName: "asc" } }, { personProfile: { firstName: "asc" } }],
          take: 100,
        })
      : Promise.resolve([]),
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
    ...verified.map((qualification) => ({ at: qualification.verifiedAt!.toISOString(), kind: "QUALIFICATION_VERIFIED" as const, text: `${QUALIFICATION_TYPE_RULES[qualification.type].label} verified: ${qualification.title}` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  return {
    ...card,
    professionalBio: details.professionalBio,
    parentGroup: { name: details.parentGroup.name },
    role: membership ? { key: membership.role.key, label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name } : null,
    manager,
    directReports: reports.map((report) => ({ personId: report.personProfile.id, name: `${report.personProfile.firstName} ${report.personProfile.lastName}`, jobTitle: report.jobTitle, company: report.company.name })),
    companies,
    groupPositions: live.filter((position) => position.positionLevel === "GROUP_HEAD").map(positionText),
    departments,
    projects,
    activity,
    former: false,
    capabilities: {
      isSelf,
      canEditOwn: isSelf && can(context, "people.profile.edit_self"),
      canManage: can(context, "person_profile.update") && reach,
      canChangePhoto: (own === row.id && can(context, "people.profile.edit_self")) || (can(context, "person_profile.update") && reach),
      canViewEmployment: employments.length > 0,
      canViewHistory: employments.length > 0 && (await canViewPersonHistory(context, row.id)),
      canViewPrivate: isSelf || (can(context, "person_profile.view") && reach),
      canViewAccess: can(context, "organization.access.view"),
    },
  };
}

/**
 * A former employee as a colleague sees them (E-08 §54, §55, §118): the name,
 * the last title and company, and that they no longer work here. No work
 * contact, photo, projects, places or activity — those described somebody at
 * work, and they are no longer at work.
 */
function formerProfile(card: PersonCardDTO): WorkProfileDTO {
  return {
    ...card,
    workEmail: null,
    workPhone: null,
    workPhoneExtension: null,
    officeLocation: null,
    photoUrl: null,
    activeProjectCount: 0,
    professionalBio: null,
    parentGroup: { name: "" },
    role: null,
    manager: null,
    directReports: [],
    companies: [],
    groupPositions: [],
    departments: [],
    projects: [],
    activity: [],
    former: true,
    capabilities: { isSelf: false, canEditOwn: false, canManage: false, canChangePhoto: false, canViewEmployment: false, canViewHistory: false, canViewPrivate: false, canViewAccess: false },
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
    company: assignedCompany(row.project),
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

/* -------------------------------------------------------------------------- */
/* Documents and qualifications (E-02)                                         */
/* -------------------------------------------------------------------------- */

/**
 * The Skills & qualifications tab (E-02 §100-§105): the person as this reader
 * may see them at all, then what the qualification rules give this reader —
 * the full records, or the verified summaries shared with the group.
 */
export async function getQualificationsTab(context: UserContext, personId: string): Promise<PersonQualificationsDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row, former } = await visiblePerson(context, personId);
  // A former employee's professional record is not a colleague's to read any more (E-08 §118).
  if (former) throw new AccessError("FORBIDDEN");
  return getPersonQualifications(context, row.id);
}

export type DocumentsTabDTO = {
  /** The person's employments in this company, each as the employee-file policy lets this reader see it. */
  employments: EmployeeDocumentsDTO[];
  /** Companies of the group that keep this person's other employment files — read there, not here (E-02 §9, §127). */
  elsewhere: string[];
};

/**
 * The Documents tab (E-02 §94-§99): an employee's documents belong to their
 * employment, and an employment to one company, so this company's files are
 * listed here and the others are named, not shown.
 */
export async function getDocumentsTab(context: UserContext, personId: string): Promise<DocumentsTabDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { row, former } = await visiblePerson(context, personId);
  if (former) throw new AccessError("FORBIDDEN");
  const here = [...row.employments.filter((employment) => employment.companyId === context.companyId)].sort(
    (a, b) => EMPLOYMENT_RANK[a.employmentStatus] - EMPLOYMENT_RANK[b.employmentStatus] || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const employments: EmployeeDocumentsDTO[] = [];
  if (context.moduleAccess.hr?.enabled) {
    for (const employment of here) {
      const documents = await listEmployeeDocuments(context, employment.id).catch((error: unknown) => (error instanceof AccessError && error.code === "NOT_FOUND" ? null : Promise.reject(error)));
      if (documents) employments.push(documents);
    }
  }
  const elsewhere = [...new Set(row.employments.filter((employment) => employment.companyId !== context.companyId).map((employment) => employment.company.name))];
  return { employments, elsewhere };
}

/**
 * The Access section (E-08 §29, §53, §66, §97): the person's account, their
 * places and roles in the group, project access, delegated grants and how
 * complete their record is — for the Owner, Group IT and access administrators
 * (`organization.access.view`), never an ordinary colleague. Last login needs
 * `team.member.security_metadata.view` as well (PRD #14 §49). The person
 * themselves is not an access administrator of their own account.
 */
export async function getAccessSummary(context: UserContext, personId: string): Promise<AccessSummaryDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "organization.access.view");
  const { row } = await visiblePerson(context, personId);
  const group = context.parentGroupId;
  const showsLastLogin = can(context, "team.member.security_metadata.view");
  const person = await prisma.personProfile.findFirstOrThrow({
    where: { id: row.id, parentGroupId: group },
    select: {
      workEmail: true,
      photoChecksum: true,
      user: {
        select: {
          id: true,
          username: true,
          status: true,
          createdAt: true,
          lastLoginAt: true,
          mustChangePassword: true,
          memberships: {
            where: { company: { parentGroupId: group } },
            select: { id: true, status: true, createdAt: true, role: { select: { key: true, name: true } }, company: { select: { id: true, name: true } }, department: { select: { name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      provisioningRequests: { where: { parentGroupId: group }, select: { id: true, status: true, submittedAt: true, company: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const userId = person.user?.id ?? null;
  const [positions, projects, grants] = await Promise.all([
    userId
      ? prisma.departmentAssignment.findMany({
          where: { userId, parentGroupId: group, status: "ACTIVE" },
          select: { positionLevel: true, groupDepartment: { select: { name: true } }, company: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    userId
      ? prisma.projectMember.findMany({
          where: { member: { userId, company: { parentGroupId: group } }, project: { archivedAt: null } },
          select: { projectRole: true, status: true, project: { select: { code: true, name: true, company: { select: { name: true } } } } },
          orderBy: [{ status: "asc" }, { joinedAt: { sort: "desc", nulls: "last" } }],
          take: 100,
        })
      : Promise.resolve([]),
    userId
      ? prisma.accessGrant.findMany({ where: { userId, parentGroupId: group, revokedAt: null }, select: { functionKey: true, scopeType: true, accessLevel: true, expiresAt: true }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const card = toCard(row);
  const employment = primaryEmployment(row);
  const request = person.provisioningRequests[0];
  return {
    account: person.user
      ? { username: person.user.username, status: person.user.status, createdAt: person.user.createdAt.toISOString(), lastLoginAt: showsLastLogin ? (person.user.lastLoginAt?.toISOString() ?? null) : null, mustChangePassword: person.user.mustChangePassword }
      : null,
    provisioning:
      request && (!person.user || request.status !== "PROVISIONED")
        ? {
            status: request.status,
            company: request.company.name,
            submittedAt: request.submittedAt?.toISOString() ?? null,
            // Where the account is created from (§117), for a reader who may open the request.
            href: can(context, "organization.provisioning_request.view") ? `/organization/provisioning/${request.id}` : null,
          }
        : null,
    memberships: (person.user?.memberships ?? []).map((membership) => ({
      company: membership.company,
      role: { key: membership.role.key, label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name },
      status: membership.status,
      department: membership.department?.name ?? null,
      since: membership.createdAt.toISOString(),
    })),
    positions: positions.map((position) => ({ department: position.groupDepartment.name, company: position.company?.name ?? null, position: position.positionLevel })),
    projects: projects.map((project) => ({ code: project.project.code, name: project.project.name, company: assignedCompany(project.project).name, role: project.projectRole, status: project.status })),
    grants: grants.map((grant) => ({ functionKey: grant.functionKey, scopeType: grant.scopeType, accessLevel: grant.accessLevel, expiresAt: grant.expiresAt?.toISOString() ?? null })),
    completeness: {
      photo: person.photoChecksum !== null,
      workEmail: Boolean(person.workEmail),
      company: card.employingCompany !== null,
      department: card.department !== null,
      manager: Boolean(employment?.managerMember),
      role: (person.user?.memberships ?? []).some((membership) => membership.status === "ACTIVE"),
      account: person.user?.status === "ACTIVE",
    },
    showsLastLogin,
  };
}

/**
 * The person's photo, if this reader may see it: whoever may read their full
 * work profile — a colleague of somebody who works here, the person, and those
 * who keep person records. A former employee's photo is not a colleague's
 * (E-08 §118). Null when there is none.
 */
export async function readablePhoto(context: UserContext, personId: string): Promise<{ storageKey: string; contentType: string; checksum: string } | null> {
  assertModule(context, MODULE);
  assertPermission(context, "people.profile.view");
  const { former } = await visiblePerson(context, personId);
  if (former) throw new AccessError("NOT_FOUND");
  const photo = await prisma.personProfile.findFirst({ where: { id: personId, parentGroupId: context.parentGroupId }, select: { photoStorageKey: true, photoContentType: true, photoChecksum: true } });
  if (!photo?.photoStorageKey || !photo.photoContentType || !photo.photoChecksum) return null;
  return { storageKey: photo.photoStorageKey, contentType: photo.photoContentType, checksum: photo.photoChecksum };
}

/** Who may change this person's photo, and whether it is their own (E-08 §93). */
export async function photoAuthority(context: UserContext, personId: string | "me"): Promise<{ personId: string; via: "SELF" | "MANAGED" }> {
  assertModule(context, MODULE);
  const own = await ownPersonId(context);
  if (personId === "me" || personId === own) {
    assertPermission(context, "people.profile.edit_self");
    if (!own) throw new AccessError("NOT_FOUND");
    return { personId: own, via: "SELF" };
  }
  assertPermission(context, "person_profile.update");
  await visiblePerson(context, personId);
  if (!(await personInRecordReach(context, personId))) throw new AccessError("NOT_FOUND");
  return { personId, via: "MANAGED" };
}

/** The signed-in person's own profile id, for `/people/me`. */
export async function myPersonId(context: UserContext): Promise<string | null> {
  return ownPersonId(context);
}
