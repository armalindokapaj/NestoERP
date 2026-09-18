import { Prisma } from "@prisma/client";

import { AccessError, invalidRecordLink, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { addDays, dayOf, dbDay, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { accountStatusOf } from "@/lib/modules/hr/hr.person";
import { requireTrade } from "./trade.service";
import { assertWorkforce, canManageCrewOn, coversDay, notEnded, readableCrewWhere, seesWholeCompany } from "./workforce.permissions";
import type { CreateCrewInput, CrewAssignmentInput, EndAssignmentInput, UpdateCrewInput } from "./workforce.schema";
import { assertWithinEmployment, lockWorker, personName, requireProject, requireSite, workforceRaced } from "./workforce.shared";
import type { CrewDetailDTO, CrewMemberDTO, CrewMembershipDTO, CrewSummaryDTO } from "./workforce.types";

/**
 * Crews (E-04 §28-§32, §114, §159): a supervisor — the foreman, who needs no
 * login (§31, §32) — and the people who work with them, on a project and a site
 * or across the company. Somebody is in one crew at a time, and moving them is
 * closing one membership and opening the next: history is never overwritten
 * (§30, §110), and the database refuses two memberships that overlap.
 */

const ENTITY = "WorkforceCrew";
const MEMBER_ENTITY = "WorkforceCrewMember";

const SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  notes: true,
  projectId: true,
  project: { select: { id: true, name: true, code: true } },
  site: { select: { id: true, name: true } },
  trade: { select: { id: true, name: true } },
  supervisor: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.WorkforceCrewSelect;

type CrewRow = Prisma.WorkforceCrewGetPayload<{ select: typeof SUMMARY_SELECT }>;

const MEMBER_SELECT = {
  id: true,
  role: true,
  startDate: true,
  endDate: true,
  endReason: true,
  employeeProfile: {
    select: {
      id: true,
      personProfileId: true,
      personProfile: { select: { firstName: true, lastName: true } },
      trade: { select: { name: true } },
      companyMember: { select: { status: true, user: { select: { status: true } } } },
    },
  },
} satisfies Prisma.WorkforceCrewMemberSelect;

type MemberRow = Prisma.WorkforceCrewMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

function toSummary(row: CrewRow, memberCount: number): CrewSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    notes: row.notes,
    project: row.project,
    site: row.site,
    trade: row.trade,
    supervisor: row.supervisor ? { employeeId: row.supervisor.id, personId: row.supervisor.personProfileId, name: personName(row.supervisor.personProfile) } : null,
    memberCount,
  };
}

function toMember(row: MemberRow): CrewMemberDTO {
  const employment = row.employeeProfile;
  return {
    membershipId: row.id,
    employeeId: employment.id,
    personId: employment.personProfileId,
    name: personName(employment.personProfile),
    trade: employment.trade?.name ?? null,
    role: row.role,
    startDate: dayOf(row.startDate),
    endDate: row.endDate ? dayOf(row.endDate) : null,
    endReason: row.endReason,
    accountStatus: accountStatusOf(employment.companyMember),
  };
}

async function memberCounts(crewIds: string[]): Promise<Map<string, number>> {
  if (crewIds.length === 0) return new Map();
  const rows = await prisma.workforceCrewMember.groupBy({ by: ["crewId"], where: { crewId: { in: crewIds }, ...coversDay() }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.crewId, row._count._all]));
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listCrews(context: UserContext, filter: { status?: "ACTIVE" | "ARCHIVED"; projectId?: string; search?: string } = {}): Promise<CrewSummaryDTO[]> {
  assertWorkforce(context);
  const rows = await prisma.workforceCrew.findMany({
    where: {
      AND: [
        readableCrewWhere(context),
        { status: filter.status ?? "ACTIVE" },
        ...(filter.projectId ? [{ projectId: filter.projectId }] : []),
        ...(filter.search ? [{ name: { contains: filter.search, mode: "insensitive" as const } }] : []),
      ],
    },
    orderBy: [{ name: "asc" }],
    take: 500,
    select: SUMMARY_SELECT,
  });
  const counts = await memberCounts(rows.map((row) => row.id));
  return rows.map((row) => toSummary(row, counts.get(row.id) ?? 0));
}

export async function getCrew(context: UserContext, crewId: string): Promise<CrewDetailDTO> {
  assertWorkforce(context);
  const row = await prisma.workforceCrew.findFirst({ where: { AND: [readableCrewWhere(context), { id: crewId }] }, select: SUMMARY_SELECT });
  if (!row) throw new AccessError("NOT_FOUND");
  const memberships = await prisma.workforceCrewMember.findMany({ where: { crewId: row.id, companyId: context.companyId }, orderBy: [{ startDate: "desc" }], select: MEMBER_SELECT });
  const today = todayDay();
  const members = memberships.filter((membership) => !membership.endDate || dayOf(membership.endDate) >= today).map(toMember);
  const history = memberships.filter((membership) => membership.endDate && dayOf(membership.endDate) < today).map(toMember);
  members.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ...toSummary(row, members.filter((member) => member.startDate <= today).length),
    members,
    history,
    capabilities: { canManage: canManageCrewOn(context, row.projectId !== null) },
  };
}

/** Crews a manager may put somebody in: readable, in use, and theirs to change. */
export async function crewChoices(context: UserContext): Promise<Array<{ value: string; label: string }>> {
  const rows = await prisma.workforceCrew.findMany({
    where: { AND: [readableCrewWhere(context), { status: "ACTIVE" }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, projectId: true, project: { select: { name: true } } },
  });
  return rows.filter((row) => canManageCrewOn(context, row.projectId !== null)).map((row) => ({ value: row.id, label: row.project ? `${row.name} · ${row.project.name}` : row.name }));
}

/** A person's crews for their profile (§30, §139): today's and any to come, then those that have ended. */
export async function crewMembershipsOf(context: UserContext, employeeId: string): Promise<{ live: CrewMembershipDTO[]; history: CrewMembershipDTO[] }> {
  const rows = await prisma.workforceCrewMember.findMany({
    where: { employeeProfileId: employeeId, companyId: context.companyId, crew: readableCrewWhere(context) },
    orderBy: { startDate: "desc" },
    select: { id: true, role: true, startDate: true, endDate: true, endReason: true, crew: { select: { id: true, name: true, projectId: true } } },
  });
  const today = todayDay();
  const dto = (row: (typeof rows)[number]): CrewMembershipDTO => {
    const start = dayOf(row.startDate);
    const end = row.endDate ? dayOf(row.endDate) : null;
    return {
      id: row.id,
      crew: { id: row.crew.id, name: row.crew.name },
      role: row.role,
      startDate: start,
      endDate: end,
      endReason: row.endReason,
      current: start <= today && (end === null || end >= today),
      canManage: end === null && canManageCrewOn(context, row.crew.projectId !== null),
    };
  };
  const all = rows.map(dto);
  const live = all.filter((row) => row.endDate === null || row.endDate >= today).reverse();
  return { live, history: all.filter((row) => !live.includes(row)) };
}

/* -------------------------------------------------------------------------- */
/* The crew itself                                                             */
/* -------------------------------------------------------------------------- */

async function assertNameFree(tx: Prisma.TransactionClient, companyId: string, name: string, exceptId?: string) {
  const clash = await tx.workforceCrew.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) {
    const message = `There is already a crew called "${name}".`;
    throw new AccessError("CONFLICT", message, { name: [message] });
  }
}

/** The supervisor: an employment of this company that has not ended — login or not (§31, §174). */
async function requireSupervisor(tx: Prisma.TransactionClient, companyId: string, employeeId: string | null | undefined, current: string | null = null): Promise<string | null> {
  if (!employeeId) return null;
  if (employeeId === current) return employeeId;
  const row = await tx.employeeProfile.findFirst({ where: { id: employeeId, companyId, employmentStatus: { not: "ENDED" } }, select: { id: true } });
  if (!row) throw invalidRecordLink("supervisorEmployeeId", "CROSS_COMPANY_REFERENCE", "Choose somebody employed by this company.");
  return row.id;
}

export async function createCrew(context: UserContext, input: CreateCrewInput): Promise<CrewSummaryDTO> {
  assertWorkforce(context, "workforce.crew.manage");
  // A crew with no project is the company's, and only somebody with the company in view keeps those (§150).
  if (!input.projectId && !seesWholeCompany(context)) throw invalidRecordLink("projectId", "SCOPE_DENIED", "Choose one of your projects.");

  const created = await prisma.$transaction(async (tx) => {
    await assertNameFree(tx, context.companyId, input.name);
    const project = input.projectId ? await requireProject(tx, context, input.projectId) : null;
    if (project?.archivedAt) throw stateDenied("That project is archived.");
    const data = {
      companyId: context.companyId,
      name: input.name,
      projectId: project?.id ?? null,
      siteId: await requireSite(tx, context.companyId, project?.id ?? null, input.siteId),
      tradeId: await requireTrade(tx, context.companyId, input.tradeId),
      supervisorEmployeeId: await requireSupervisor(tx, context.companyId, input.supervisorEmployeeId),
      notes: input.notes ?? null,
      createdByMemberId: context.membershipId,
    };
    const row = await tx.workforceCrew.create({ data, select: SUMMARY_SELECT });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.WORKFORCE_CREW_CREATED,
        entity: { type: ENTITY, id: row.id, label: row.name },
        projectId: row.projectId,
        after: { name: row.name, projectId: data.projectId, siteId: data.siteId, tradeId: data.tradeId, supervisorEmployeeId: data.supervisorEmployeeId, status: row.status },
      },
      { tx },
    );
    return row;
  });
  return toSummary(created, 0);
}

/**
 * Rename, move to another project or site, change the supervisor, archive.
 * A crew with people in it is not archived and does not change project: its
 * members' memberships are ended or moved first, so nobody's history says they
 * were in a crew somewhere they never were.
 */
export async function updateCrew(context: UserContext, crewId: string, input: UpdateCrewInput): Promise<CrewSummaryDTO> {
  assertWorkforce(context, "workforce.crew.manage");
  const existing = await prisma.workforceCrew.findFirst({
    where: { AND: [readableCrewWhere(context), { id: crewId }] },
    select: { id: true, name: true, projectId: true, siteId: true, tradeId: true, supervisorEmployeeId: true, notes: true, status: true },
  });
  if (!existing) throw new AccessError("NOT_FOUND");
  if (!canManageCrewOn(context, existing.projectId !== null)) throw new AccessError("FORBIDDEN");

  const updated = await prisma.$transaction(async (tx) => {
    const name = input.name ?? existing.name;
    if (name.toLowerCase() !== existing.name.toLowerCase()) await assertNameFree(tx, context.companyId, name, crewId);
    const projectId = input.projectId === undefined ? existing.projectId : input.projectId;
    if (!projectId && !seesWholeCompany(context)) throw invalidRecordLink("projectId", "SCOPE_DENIED", "Choose one of your projects.");
    if (projectId && projectId !== existing.projectId) await requireProject(tx, context, projectId);
    const siteInput = input.siteId === undefined ? (projectId === existing.projectId ? existing.siteId : null) : input.siteId;
    const next = {
      name,
      projectId,
      siteId: await requireSite(tx, context.companyId, projectId, siteInput, existing.siteId),
      tradeId: input.tradeId === undefined ? existing.tradeId : await requireTrade(tx, context.companyId, input.tradeId, existing.tradeId),
      supervisorEmployeeId: input.supervisorEmployeeId === undefined ? existing.supervisorEmployeeId : await requireSupervisor(tx, context.companyId, input.supervisorEmployeeId, existing.supervisorEmployeeId),
      notes: input.notes === undefined ? existing.notes : input.notes,
      status: input.status ?? existing.status,
    };

    const moving = next.projectId !== existing.projectId || next.status === "ARCHIVED";
    if (moving) {
      const members = await tx.workforceCrewMember.count({ where: { crewId, companyId: context.companyId, ...notEnded() } });
      if (members > 0) {
        const what = next.status === "ARCHIVED" && existing.status !== "ARCHIVED" ? "archived" : "moved to another project";
        throw new AccessError("CONFLICT", `The crew still has ${members} ${members === 1 ? "member" : "members"}. End or move their memberships before it is ${what}.`, { code: "CREW_HAS_MEMBERS" });
      }
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (next[key] !== existing[key]) {
        before[key] = existing[key];
        after[key] = next[key];
      }
    }
    const row = await tx.workforceCrew.update({
      where: { companyId: context.companyId, id: crewId, status: existing.status },
      data: {
        name: next.name,
        projectId: next.projectId,
        siteId: next.siteId,
        tradeId: next.tradeId,
        supervisorEmployeeId: next.supervisorEmployeeId,
        notes: next.notes,
        status: next.status,
        archivedAt: next.status === "ARCHIVED" ? (existing.status === "ARCHIVED" ? undefined : new Date()) : null,
        updatedByMemberId: context.membershipId,
      },
      select: SUMMARY_SELECT,
    });
    if (Object.keys(after).length > 0) {
      await recordUserAction(context, { actionKey: AuditAction.WORKFORCE_CREW_UPDATED, entity: { type: ENTITY, id: row.id, label: row.name }, projectId: row.projectId, before, after }, { tx });
    }
    return row;
  }).catch(workforceRaced);
  const counts = await memberCounts([updated.id]);
  return toSummary(updated, counts.get(updated.id) ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Membership (§29, §30, §114)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Puts somebody in a crew from a day. Already in another crew then: refused
 * unless the request says to move them, and then only by somebody who may
 * change that crew too — their old membership ends the day before.
 */
export async function assignToCrew(context: UserContext, employeeId: string, input: CrewAssignmentInput): Promise<CrewMembershipDTO> {
  assertWorkforce(context, "workforce.crew.manage");
  const crew = await prisma.workforceCrew.findFirst({ where: { AND: [readableCrewWhere(context), { id: input.crewId }] }, select: { id: true, name: true, status: true, projectId: true } });
  if (!crew) throw invalidRecordLink("crewId", "SCOPE_DENIED", "Choose one of your crews.");
  if (!canManageCrewOn(context, crew.projectId !== null)) throw new AccessError("FORBIDDEN");
  if (crew.status === "ARCHIVED") throw stateDenied("This crew is archived.");

  const membershipId = await prisma
    .$transaction(async (tx) => {
      const worker = await lockWorker(tx, context.companyId, employeeId);
      assertWithinEmployment(worker, input.startDate);
      const start = input.startDate;
      const open = await tx.workforceCrewMember.findMany({
        where: { employeeProfileId: worker.id, companyId: context.companyId, OR: [{ endDate: null }, { endDate: { gte: dbDay(start) } }] },
        select: { id: true, crewId: true, startDate: true, endDate: true, crew: { select: { name: true, projectId: true } } },
      });
      const later = open.find((row) => dayOf(row.startDate) >= start);
      if (later) {
        throw new AccessError("CONFLICT", `${worker.name} joins ${later.crew.name} on ${dayOf(later.startDate)}. Change that membership first.`, { code: "LATER_MEMBERSHIP" });
      }
      const current = open[0];
      let transferredFromCrewId: string | null = null;
      if (current) {
        if (current.crewId === crew.id) throw new AccessError("CONFLICT", `${worker.name} is already in ${crew.name}.`, { code: "ALREADY_IN_CREW" });
        if (!input.transfer) {
          throw new AccessError("CONFLICT", `${worker.name} is in ${current.crew.name}. Move them to ${crew.name} instead.`, { code: "IN_ANOTHER_CREW", crew: current.crew.name });
        }
        const theirs = await tx.workforceCrew.count({ where: { AND: [readableCrewWhere(context), { id: current.crewId }] } });
        if (!theirs || !canManageCrewOn(context, current.crew.projectId !== null)) {
          throw new AccessError("FORBIDDEN", `${worker.name} is in a crew you do not manage.`, { code: "OTHER_CREW_NOT_YOURS" });
        }
        const lastDay = addDays(start, -1);
        await tx.workforceCrewMember.update({ where: { companyId: context.companyId, id: current.id }, data: { endDate: dbDay(lastDay), endReason: `Moved to ${crew.name}`, endedByUserId: context.userId } });
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.WORKFORCE_CREW_ASSIGNMENT_ENDED,
            entity: { type: MEMBER_ENTITY, id: current.id, label: worker.name },
            projectId: current.crew.projectId,
            before: { crewId: current.crewId, employeeProfileId: worker.id, startDate: dayOf(current.startDate), endDate: current.endDate ? dayOf(current.endDate) : null },
            after: { crewId: current.crewId, employeeProfileId: worker.id, endDate: lastDay, endReason: `Moved to ${crew.name}` },
          },
          { tx },
        );
        transferredFromCrewId = current.crewId;
      }
      const row = await tx.workforceCrewMember.create({
        data: { companyId: context.companyId, crewId: crew.id, employeeProfileId: worker.id, role: input.role ?? null, startDate: dbDay(start), createdByUserId: context.userId },
        select: { id: true },
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKFORCE_CREW_ASSIGNED,
          entity: { type: MEMBER_ENTITY, id: row.id, label: worker.name },
          projectId: crew.projectId,
          after: { crewId: crew.id, employeeProfileId: worker.id, role: input.role ?? null, startDate: start, transferredFromCrewId },
        },
        { tx },
      );
      return row.id;
    })
    .catch(workforceRaced);

  const { live, history } = await crewMembershipsOf(context, employeeId);
  const dto = [...live, ...history].find((row) => row.id === membershipId);
  if (!dto) throw new AccessError("NOT_FOUND");
  return dto;
}

/** Takes somebody out of their crew after a last day (§114 removeFromCrew). */
export async function endCrewMembership(context: UserContext, employeeId: string, membershipId: string, input: EndAssignmentInput): Promise<void> {
  assertWorkforce(context, "workforce.crew.manage");
  const membership = await prisma.workforceCrewMember.findFirst({
    where: { id: membershipId, employeeProfileId: employeeId, companyId: context.companyId, crew: readableCrewWhere(context) },
    select: { id: true, crewId: true, startDate: true, endDate: true, crew: { select: { name: true, projectId: true } }, employeeProfile: { select: { personProfile: { select: { firstName: true, lastName: true } } } } },
  });
  if (!membership) throw new AccessError("NOT_FOUND");
  if (!canManageCrewOn(context, membership.crew.projectId !== null)) throw new AccessError("FORBIDDEN");
  if (membership.endDate) throw stateDenied("This membership has already ended.");
  const start = dayOf(membership.startDate);
  if (input.endDate < start) {
    const message = `The membership began on ${start}; it cannot end before that.`;
    throw new AccessError("VALIDATION_ERROR", message, { endDate: [message] });
  }
  const name = personName(membership.employeeProfile.personProfile);
  await prisma
    .$transaction(async (tx) => {
      const ended = await tx.workforceCrewMember.updateMany({ where: { id: membership.id, companyId: context.companyId, endDate: null }, data: { endDate: dbDay(input.endDate), endReason: input.reason ?? null, endedByUserId: context.userId } });
      if (ended.count === 0) throw stateDenied("This membership has already ended.");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKFORCE_CREW_ASSIGNMENT_ENDED,
          entity: { type: MEMBER_ENTITY, id: membership.id, label: name },
          projectId: membership.crew.projectId,
          before: { crewId: membership.crewId, employeeProfileId: employeeId, startDate: start, endDate: null },
          after: { crewId: membership.crewId, employeeProfileId: employeeId, endDate: input.endDate, endReason: input.reason ?? null },
        },
        { tx },
      );
    })
    .catch(workforceRaced);
}
