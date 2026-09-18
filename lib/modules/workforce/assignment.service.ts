import type { Prisma } from "@prisma/client";

import { AccessError, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { addDays, dayOf, dbDay, todayDay } from "@/lib/modules/hr/employment/employment.dates";
import { requireTrade } from "./trade.service";
import { assertWorkforce, canManageAssignments, readableAssignmentWhere, workforceProjectWhere } from "./workforce.permissions";
import type { EndAssignmentInput, ProjectAssignmentInput } from "./workforce.schema";
import { assertWithinEmployment, lockWorker, personName, requireProject, requireSite, workforceRaced } from "./workforce.shared";
import type { ProjectAssignmentDTO, WorkerRef } from "./workforce.types";

/**
 * Where people work (E-04 §33-§42, §115, §160): an employment on a project —
 * and a site of it — for a period. This is the real workforce assignment, and
 * it is not project membership: a worker without a login is assigned here and
 * never becomes a ProjectMember, which is NESTO access (§35, §36).
 *
 * Nobody is on one project twice at once, and one assignment at a time may be
 * their primary one (§40) — the database refuses anything else, even two
 * requests racing (§221). A transfer closes the old assignment the day before
 * the new one starts; nothing is overwritten (§41, §42).
 */

const ENTITY = "EmployeeProjectAssignment";

const SELECT = {
  id: true,
  isPrimary: true,
  role: true,
  startDate: true,
  endDate: true,
  endReason: true,
  project: { select: { id: true, name: true, code: true } },
  site: { select: { id: true, name: true } },
  trade: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeProjectAssignmentSelect;

type Row = Prisma.EmployeeProjectAssignmentGetPayload<{ select: typeof SELECT }>;

function toDTO(row: Row, canManage: boolean): ProjectAssignmentDTO {
  const today = todayDay();
  const start = dayOf(row.startDate);
  const end = row.endDate ? dayOf(row.endDate) : null;
  return {
    id: row.id,
    project: row.project,
    site: row.site,
    trade: row.trade,
    role: row.role,
    isPrimary: row.isPrimary,
    startDate: start,
    endDate: end,
    endReason: row.endReason,
    current: start <= today && (end === null || end >= today),
    canManage: canManage && end === null,
  };
}

/** A person's assignments on the projects this reader reaches (§39, §41): today's and to come, then past ones. */
export async function assignmentsOf(context: UserContext, employeeId: string): Promise<{ live: ProjectAssignmentDTO[]; history: ProjectAssignmentDTO[] }> {
  const rows = await prisma.employeeProjectAssignment.findMany({
    where: { AND: [readableAssignmentWhere(context), { employeeProfileId: employeeId }] },
    orderBy: [{ startDate: "desc" }],
    select: SELECT,
  });
  const manage = canManageAssignments(context);
  const today = todayDay();
  const all = rows.map((row) => toDTO(row, manage));
  const live = all.filter((row) => row.endDate === null || row.endDate >= today).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.startDate.localeCompare(b.startDate));
  return { live, history: all.filter((row) => !live.includes(row)) };
}

/** Who works on a project today and who is due to start (§181), for its Workforce tab. */
export async function projectWorkforce(context: UserContext, projectId: string): Promise<Array<ProjectAssignmentDTO & { worker: WorkerRef; tradeName: string | null }>> {
  assertWorkforce(context);
  const rows = await prisma.employeeProjectAssignment.findMany({
    where: { AND: [readableAssignmentWhere(context), { projectId }, { OR: [{ endDate: null }, { endDate: { gte: dbDay(todayDay()) } }] }] },
    orderBy: [{ startDate: "asc" }],
    select: { ...SELECT, employeeProfile: { select: { id: true, personProfileId: true, personProfile: { select: { firstName: true, lastName: true } }, trade: { select: { name: true } } } } },
  });
  const manage = canManageAssignments(context);
  return rows
    .map((row) => ({
      ...toDTO(row, manage),
      worker: { employeeId: row.employeeProfile.id, personId: row.employeeProfile.personProfileId, name: personName(row.employeeProfile.personProfile) },
      tradeName: row.trade?.name ?? row.employeeProfile.trade?.name ?? null,
    }))
    .sort((a, b) => a.worker.name.localeCompare(b.worker.name));
}

/**
 * Assigns somebody to a project from a day (§115 assignToProject), or moves
 * them from one of their assignments (§115 transferProject): that one ends the
 * day before, and a primary assignment's primacy moves with it.
 */
export async function assignToProject(context: UserContext, employeeId: string, input: ProjectAssignmentInput): Promise<ProjectAssignmentDTO> {
  assertWorkforce(context, "workforce.project_assignment.manage");
  const start = input.startDate;

  const id = await prisma
    .$transaction(async (tx) => {
      const worker = await lockWorker(tx, context.companyId, employeeId);
      assertWithinEmployment(worker, start);
      const project = await requireProject(tx, context, input.projectId);
      if (project.archivedAt || project.status === "ARCHIVED") throw stateDenied("That project is archived.");
      const siteId = await requireSite(tx, context.companyId, project.id, input.siteId);
      const tradeId = await requireTrade(tx, context.companyId, input.tradeId);

      let source: { id: string; isPrimary: boolean; project: { id: string; name: string } } | null = null;
      if (input.transferFromId) {
        const row = await tx.employeeProjectAssignment.findFirst({
          where: { id: input.transferFromId, employeeProfileId: worker.id, companyId: context.companyId, project: workforceProjectWhere(context), OR: [{ endDate: null }, { endDate: { gte: dbDay(start) } }] },
          select: { id: true, isPrimary: true, startDate: true, endDate: true, siteId: true, project: { select: { id: true, name: true } } },
        });
        if (!row) throw new AccessError("VALIDATION_ERROR", "Choose one of their current assignments to move from.", { transferFromId: ["Choose one of their current assignments to move from."] });
        if (dayOf(row.startDate) >= start) {
          const message = `That assignment only starts on ${dayOf(row.startDate)}. Move them from a later day.`;
          throw new AccessError("VALIDATION_ERROR", message, { startDate: [message] });
        }
        if (row.project.id === project.id && (row.siteId ?? null) === siteId) throw new AccessError("VALIDATION_ERROR", "They already work there.", { siteId: ["They already work there."] });
        const lastDay = addDays(start, -1);
        await tx.employeeProjectAssignment.update({ where: { companyId: context.companyId, id: row.id }, data: { endDate: dbDay(lastDay), endReason: `Moved to ${project.name}`, endedByUserId: context.userId } });
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.WORKFORCE_PROJECT_ASSIGNMENT_ENDED,
            entity: { type: ENTITY, id: row.id, label: worker.name },
            projectId: row.project.id,
            before: { projectId: row.project.id, siteId: row.siteId, employeeProfileId: worker.id, startDate: dayOf(row.startDate), endDate: row.endDate ? dayOf(row.endDate) : null },
            after: { projectId: row.project.id, employeeProfileId: worker.id, endDate: lastDay, endReason: `Moved to ${project.name}` },
          },
          { tx },
        );
        source = row;
      }

      const isPrimary = input.isPrimary || Boolean(source?.isPrimary);
      const overlapping = await tx.employeeProjectAssignment.findMany({
        where: { employeeProfileId: worker.id, companyId: context.companyId, OR: [{ endDate: null }, { endDate: { gte: dbDay(start) } }], ...(source ? { id: { not: source.id } } : {}) },
        select: { projectId: true, isPrimary: true, project: { select: { name: true } } },
      });
      const same = overlapping.find((row) => row.projectId === project.id);
      if (same) throw new AccessError("CONFLICT", `${worker.name} is already assigned to ${project.name} from then.`, { code: "ALREADY_ON_PROJECT" });
      const primary = overlapping.find((row) => row.isPrimary);
      if (isPrimary && primary) {
        throw new AccessError("CONFLICT", `${primary.project.name} is already ${worker.name}'s main project. Move them from it, or make this one secondary.`, { code: "PRIMARY_EXISTS" });
      }

      const row = await tx.employeeProjectAssignment.create({
        data: { companyId: context.companyId, employeeProfileId: worker.id, projectId: project.id, siteId, tradeId, role: input.role ?? null, isPrimary, startDate: dbDay(start), createdByUserId: context.userId },
        select: { id: true },
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKFORCE_PROJECT_ASSIGNED,
          entity: { type: ENTITY, id: row.id, label: worker.name },
          projectId: project.id,
          after: { projectId: project.id, siteId, tradeId, employeeProfileId: worker.id, role: input.role ?? null, isPrimary, startDate: start, transferredFromId: source?.id ?? null },
        },
        { tx },
      );
      return row.id;
    })
    .catch(workforceRaced);

  const row = await prisma.employeeProjectAssignment.findFirstOrThrow({ where: { id, companyId: context.companyId }, select: SELECT });
  return toDTO(row, true);
}

/** Ends an assignment after its last day (§115 endProjectAssignment). */
export async function endProjectAssignment(context: UserContext, employeeId: string, assignmentId: string, input: EndAssignmentInput): Promise<void> {
  assertWorkforce(context, "workforce.project_assignment.manage");
  const row = await prisma.employeeProjectAssignment.findFirst({
    where: { AND: [readableAssignmentWhere(context), { id: assignmentId, employeeProfileId: employeeId }] },
    select: { id: true, projectId: true, siteId: true, startDate: true, endDate: true, employeeProfile: { select: { personProfile: { select: { firstName: true, lastName: true } } } } },
  });
  if (!row) throw new AccessError("NOT_FOUND");
  if (row.endDate) throw stateDenied("This assignment has already ended.");
  const start = dayOf(row.startDate);
  if (input.endDate < start) {
    const message = `The assignment began on ${start}; it cannot end before that.`;
    throw new AccessError("VALIDATION_ERROR", message, { endDate: [message] });
  }
  const name = personName(row.employeeProfile.personProfile);
  await prisma
    .$transaction(async (tx) => {
      const ended = await tx.employeeProjectAssignment.updateMany({ where: { id: row.id, companyId: context.companyId, endDate: null }, data: { endDate: dbDay(input.endDate), endReason: input.reason ?? null, endedByUserId: context.userId } });
      if (ended.count === 0) throw stateDenied("This assignment has already ended.");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORKFORCE_PROJECT_ASSIGNMENT_ENDED,
          entity: { type: ENTITY, id: row.id, label: name },
          projectId: row.projectId,
          before: { projectId: row.projectId, siteId: row.siteId, employeeProfileId: employeeId, startDate: start, endDate: null },
          after: { projectId: row.projectId, employeeProfileId: employeeId, endDate: input.endDate, endReason: input.reason ?? null },
        },
        { tx },
      );
    })
    .catch(workforceRaced);
}
