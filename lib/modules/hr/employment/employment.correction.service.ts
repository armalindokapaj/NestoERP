import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { addDays, dayOf, type Day } from "./employment.dates";
import { loadTarget, type ChangeOptions } from "./employment.change.service";
import {
  ASSIGNMENT_ROW,
  STATUS_ROW,
  assignmentFacts,
  auditEmployment,
  historyRaced,
  insertAssignment,
  insertStatus,
  lockEmployment,
  mirrorToMembership,
  placementOf,
  supersede,
  syncCache,
  type Placement,
} from "./employment.history";
import type { CorrectionInput } from "./employment.schema";
import { validateDocument } from "./employment.validate";

/**
 * Correcting history (E-03 §42-§44, §76, §171, §211, §224).
 *
 * A correction is not an edit. The row that was wrong stays, marked superseded,
 * and a corrected row names it and says why — so HR sees the original, the
 * correction and the reason, and the audit trail keeps both. Moving a row's
 * start moves the end of the row before it, which is corrected the same way.
 * History may name what has since closed — a department deactivated, a manager
 * who left — because it was true then (§117-§119); it may not name another
 * company's department or document.
 */

const ENTITY = "EmployeeProfile";

export async function correctEmploymentHistory(context: UserContext, employmentId: string, input: CorrectionInput, options: Pick<ChangeOptions, "placement">): Promise<void> {
  assertModule(context, "hr");
  assertPermission(context, "hr.employment_history.correct");
  if (input.kind === "STATUS" && input.privateReason !== undefined) assertPermission(context, "hr.employment_history.view_private");
  const target = await loadTarget(context, employmentId);
  if (input.documentId) await validateDocument(context, target.companyId, input.documentId);

  await prisma
    .$transaction(async (tx) => {
      await lockEmployment(tx, target.id);
      const facts = input.kind === "ASSIGNMENT" ? await correctAssignment(tx, context, target.id, target.companyId, input) : await correctStatus(tx, context, target.id, target.companyId, input);
      await syncCache(tx, target, { actorMemberId: context.membershipId });
      await mirrorToMembership(tx, { employmentId: target.id, companyId: target.companyId, placement: options.placement, actor: context });
      await auditEmployment(tx, { kind: "member", context }, target.companyId, {
        actionKey: AuditAction.HR_EMPLOYMENT_HISTORY_CORRECTED,
        entity: { type: ENTITY, id: target.id, label: target.name },
        before: facts.before,
        after: { ...facts.after, correctionReason: input.correctionReason, kind: input.kind },
      });
      await recordActivity(tx, context, {
        module: "hr",
        entityType: ENTITY,
        entityId: target.id,
        action: "HR_EMPLOYMENT_HISTORY_CORRECTED",
        message: "corrected their employment history",
        metadata: { memberId: target.companyMemberId, employmentId: target.id, rowId: input.rowId, kind: input.kind } as Prisma.InputJsonValue,
      });
    })
    .catch(historyRaced);
}

type Facts = { before: Record<string, unknown>; after: Record<string, unknown> };

async function correctAssignment(tx: Prisma.TransactionClient, context: UserContext, employmentId: string, companyId: string, input: Extract<CorrectionInput, { kind: "ASSIGNMENT" }>): Promise<Facts> {
  const row = await tx.employmentAssignment.findFirst({ where: { id: input.rowId, employeeProfileId: employmentId, companyId }, select: { ...ASSIGNMENT_ROW, supersededAt: true, note: true } });
  if (!row) throw new AccessError("NOT_FOUND");
  if (row.supersededAt) throw new AccessError("CONFLICT", "That row has already been corrected. Correct the row that replaced it.", { code: "ALREADY_SUPERSEDED" });

  const placement: Placement = { ...placementOf(row) };
  if (input.departmentId !== undefined) {
    if (input.departmentId !== null && !(await tx.department.count({ where: { id: input.departmentId, companyId } }))) {
      throw new AccessError("VALIDATION_ERROR", "That department is not one of this company's.", { field: "departmentId" });
    }
    placement.departmentId = input.departmentId;
  }
  if (input.managerMemberId !== undefined) {
    if (input.managerMemberId !== null) {
      const manager = await tx.companyMember.findFirst({ where: { id: input.managerMemberId, companyId }, select: { id: true } });
      if (!manager) throw new AccessError("VALIDATION_ERROR", "That manager was never a member of this company.", { field: "managerMemberId" });
      const subject = await tx.employeeProfile.findFirstOrThrow({ where: { id: employmentId, companyId }, select: { companyMemberId: true } });
      if (subject.companyMemberId === manager.id) throw new AccessError("VALIDATION_ERROR", "Somebody cannot be their own manager.", { field: "managerMemberId", code: "SELF_MANAGER" });
    }
    placement.managerMemberId = input.managerMemberId;
  }
  if (input.jobTitle !== undefined) placement.jobTitle = input.jobTitle;
  if (input.workLocationType !== undefined) placement.workLocationType = input.workLocationType;
  if (input.workLocation !== undefined) placement.workLocation = input.workLocation;
  if (input.employmentType) placement.employmentType = input.employmentType;

  const start = dayOf(row.startDate);
  const end = row.endDate ? dayOf(row.endDate) : null;
  const newStart: Day = input.startDate ?? start;
  if (end && newStart > end) throw new AccessError("VALIDATION_ERROR", `The row ends on ${end}; it cannot start after that.`, { field: "startDate" });

  const unchanged =
    newStart === start &&
    (input.reason ?? row.reason) === row.reason &&
    (input.documentId === undefined || input.documentId === row.sourceDocumentId) &&
    JSON.stringify(placement) === JSON.stringify(placementOf(row));
  if (unchanged) throw new AccessError("VALIDATION_ERROR", "Nothing would change.", { code: "NO_CHANGE" });

  const before: Record<string, unknown> = { row: assignmentFacts(row) };
  const after: Record<string, unknown> = {};

  // The row before it ends the day before the new start. Both are superseded before either is rewritten,
  // so the rewritten rows never meet the originals they replace.
  let previous: Awaited<ReturnType<typeof tx.employmentAssignment.findFirst<{ select: typeof ASSIGNMENT_ROW }>>> = null;
  if (newStart !== start) {
    previous = await tx.employmentAssignment.findFirst({ where: { employeeProfileId: employmentId, supersededAt: null, isPrimary: true, endDate: new Date(`${addDays(start, -1)}T00:00:00.000Z`) }, select: ASSIGNMENT_ROW });
    const blocking = await tx.employmentAssignment.findFirst({
      where: {
        employeeProfileId: employmentId,
        supersededAt: null,
        isPrimary: true,
        id: { notIn: [row.id, ...(previous ? [previous.id] : [])] },
        startDate: { lte: new Date(`${end ?? "9999-12-31"}T00:00:00.000Z`) },
        OR: [{ endDate: null }, { endDate: { gte: new Date(`${newStart}T00:00:00.000Z`) } }],
      },
      select: { id: true },
    });
    if (blocking) throw new AccessError("VALIDATION_ERROR", "That start would overlap another period of the history. Correct that one first.", { field: "startDate", code: "OVERLAP" });
    if (previous && newStart <= dayOf(previous.startDate)) {
      throw new AccessError("VALIDATION_ERROR", `The period before it began on ${dayOf(previous.startDate)}; the new start must be after it.`, { field: "startDate" });
    }
  }

  if (previous) await supersede(tx, "assignment", previous.id, companyId, context.userId);
  await supersede(tx, "assignment", row.id, companyId, context.userId);
  if (previous) {
    const replaced = await insertAssignment(tx, {
      employmentId,
      companyId,
      placement: placementOf(previous),
      startDate: dayOf(previous.startDate),
      endDate: addDays(newStart, -1),
      reason: previous.reason,
      source: "CORRECTION",
      documentId: previous.sourceDocumentId,
      actorUserId: context.userId,
      correctsId: previous.id,
      correctionReason: input.correctionReason,
    });
    before.previous = assignmentFacts(previous);
    after.previous = assignmentFacts(replaced);
  }
  const corrected = await insertAssignment(tx, {
    employmentId,
    companyId,
    placement,
    startDate: newStart,
    endDate: end,
    reason: input.reason ?? row.reason,
    source: "CORRECTION",
    documentId: input.documentId !== undefined ? input.documentId : row.sourceDocumentId,
    note: row.note,
    actorUserId: context.userId,
    correctsId: row.id,
    correctionReason: input.correctionReason,
  });
  after.row = assignmentFacts(corrected);
  return { before, after };
}

async function correctStatus(tx: Prisma.TransactionClient, context: UserContext, employmentId: string, companyId: string, input: Extract<CorrectionInput, { kind: "STATUS" }>): Promise<Facts> {
  const row = await tx.employmentStatusHistory.findFirst({
    where: { id: input.rowId, employeeProfileId: employmentId, companyId },
    select: { ...STATUS_ROW, supersededAt: true, privateReason: true, sourceDocumentId: true },
  });
  if (!row) throw new AccessError("NOT_FOUND");
  if (row.supersededAt) throw new AccessError("CONFLICT", "That row has already been corrected. Correct the row that replaced it.", { code: "ALREADY_SUPERSEDED" });

  const from = dayOf(row.effectiveFrom);
  const to = row.effectiveTo ? dayOf(row.effectiveTo) : null;
  const newFrom: Day = input.effectiveFrom ?? from;
  if (to && newFrom > to) throw new AccessError("VALIDATION_ERROR", `The period ends on ${to}; it cannot start after that.`, { field: "effectiveFrom" });
  const unchanged =
    newFrom === from &&
    (input.reason ?? row.reason) === row.reason &&
    (input.privateReason === undefined || input.privateReason === row.privateReason) &&
    (input.documentId === undefined || input.documentId === row.sourceDocumentId);
  if (unchanged) throw new AccessError("VALIDATION_ERROR", "Nothing would change.", { code: "NO_CHANGE" });

  const facts = (value: { id: string; status: string; effectiveFrom: Date; effectiveTo: Date | null; reason: string }) => ({
    statusHistoryId: value.id,
    employmentStatus: value.status,
    effectiveFrom: dayOf(value.effectiveFrom),
    effectiveTo: value.effectiveTo ? dayOf(value.effectiveTo) : null,
    statusReason: value.reason,
  });
  const before: Record<string, unknown> = { row: facts(row) };
  const after: Record<string, unknown> = {};

  const STATUS_WITH_REASON = { ...STATUS_ROW, privateReason: true, sourceDocumentId: true } as const;
  let previous: Awaited<ReturnType<typeof tx.employmentStatusHistory.findFirst<{ select: typeof STATUS_WITH_REASON }>>> = null;
  if (newFrom !== from) {
    previous = await tx.employmentStatusHistory.findFirst({
      where: { employeeProfileId: employmentId, supersededAt: null, effectiveTo: new Date(`${addDays(from, -1)}T00:00:00.000Z`) },
      select: STATUS_WITH_REASON,
    });
    const blocking = await tx.employmentStatusHistory.findFirst({
      where: {
        employeeProfileId: employmentId,
        supersededAt: null,
        id: { notIn: [row.id, ...(previous ? [previous.id] : [])] },
        effectiveFrom: { lte: new Date(`${to ?? "9999-12-31"}T00:00:00.000Z`) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(`${newFrom}T00:00:00.000Z`) } }],
      },
      select: { id: true },
    });
    if (blocking) throw new AccessError("VALIDATION_ERROR", "That date would overlap another period of the history. Correct that one first.", { field: "effectiveFrom", code: "OVERLAP" });
    if (previous && newFrom <= dayOf(previous.effectiveFrom)) {
      throw new AccessError("VALIDATION_ERROR", `The status before it began on ${dayOf(previous.effectiveFrom)}; the new date must be after it.`, { field: "effectiveFrom" });
    }
  }

  if (previous) await supersede(tx, "status", previous.id, companyId, context.userId);
  await supersede(tx, "status", row.id, companyId, context.userId);
  if (previous) {
    const replaced = await insertStatus(tx, {
      employmentId,
      companyId,
      status: previous.status,
      effectiveFrom: dayOf(previous.effectiveFrom),
      effectiveTo: addDays(newFrom, -1),
      reason: previous.reason,
      privateReason: previous.privateReason,
      documentId: previous.sourceDocumentId,
      source: "CORRECTION",
      actorUserId: context.userId,
      correctsId: previous.id,
      correctionReason: input.correctionReason,
    });
    before.previous = facts(previous);
    after.previous = facts(replaced);
  }
  const corrected = await insertStatus(tx, {
    employmentId,
    companyId,
    status: row.status,
    effectiveFrom: newFrom,
    effectiveTo: to,
    reason: input.reason ?? row.reason,
    privateReason: input.privateReason !== undefined ? input.privateReason : row.privateReason,
    documentId: input.documentId !== undefined ? input.documentId : row.sourceDocumentId,
    source: "CORRECTION",
    actorUserId: context.userId,
    correctsId: row.id,
    correctionReason: input.correctionReason,
  });
  after.row = { ...facts(corrected), privateReasonChanged: input.privateReason !== undefined && can(context, "hr.employment_history.view_private") };
  return { before, after };
}
