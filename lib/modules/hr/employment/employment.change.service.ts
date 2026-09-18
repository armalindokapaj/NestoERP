import type { EmploymentChangeType, EmploymentStatus, EmploymentStatusReason, Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { Permission } from "@/config/permissions";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import type { PlacementDoor } from "@/lib/modules/team/team.placement";
import * as repository from "../employees/employee.repository";
import { canTransitionEmployment } from "../hr.status";
import { addDays, dayOf, todayDay, type Day } from "./employment.dates";
import {
  assignmentFacts,
  auditEmployment,
  closeAssignment,
  historyRaced,
  insertAssignment,
  insertStatus,
  lastAssignment,
  lockEmployment,
  mirrorToMembership,
  openAssignment,
  openStatus,
  placementOf,
  startHistory,
  supersede,
  syncCache,
  writeAssignment,
  writeStatus,
  type AssignmentWrite,
  type HistoryActor,
  type Placement,
  type PlacementPatch,
} from "./employment.history";
import { changeTypeLabels } from "./employment.labels";
import type { EmploymentChangeInput } from "./employment.schema";
import type { EmploymentChangeResultDTO } from "./employment.types";
import { documentStillThere, validateDepartment, validateDocument, validateManager } from "./employment.validate";

/**
 * Employment changes (E-03 §35-§41, §91-§104, §96-§102; ADR 0004).
 *
 * One typed change per semantic action — promote, transfer a department or a
 * company, change the manager, the location, the employment type or the status,
 * end the employment, rehire — and one service applying it, never a PATCH of
 * organization fields (§37). When a change takes effect decides who may make it
 * and how:
 *
 *   today           the history changes now
 *   in the future   it is scheduled, and the worker applies it on the day,
 *                   with `hr.employment.schedule` (§31-§34, §153-§157)
 *   in the past     it is backdated, with `hr.employment_history.correct`,
 *                   and only within the current period — anything earlier is
 *                   a correction (§86-§88)
 *
 * A planned employment has not begun, so a change to it revises the plan; the
 * plan becomes history when HR starts it (activation). Ended employment changes
 * only by a rehire, or by correcting its history.
 */

const MODULE = "hr" as const;
const ENTITY = "EmployeeProfile";

export type ChangeOptions = { placement: PlacementDoor };

export type Target = {
  id: string;
  companyId: string;
  companyMemberId: string | null;
  personProfileId: string;
  employmentStatus: EmploymentStatus;
  offboardingStatus: string;
  name: string;
};

type Timing = "PAST" | "TODAY" | "FUTURE";

const CHANGE_TYPE: Record<EmploymentChangeInput["action"], EmploymentChangeType | null> = {
  POSITION: "POSITION_CHANGE",
  DEPARTMENT: "DEPARTMENT_TRANSFER",
  MANAGER: "MANAGER_CHANGE",
  LOCATION: "LOCATION_CHANGE",
  EMPLOYMENT_TYPE: "EMPLOYMENT_TYPE_CHANGE",
  STATUS: "STATUS_CHANGE",
  TERMINATE: "TERMINATION",
  LEGAL_ENTITY: "LEGAL_ENTITY_TRANSFER",
  REHIRE: null,
};

const PLACEMENT_ACTIONS = new Set<EmploymentChangeInput["action"]>(["POSITION", "DEPARTMENT", "MANAGER", "LOCATION", "EMPLOYMENT_TYPE"]);

type PlacementInput = Extract<EmploymentChangeInput, { action: "POSITION" | "DEPARTMENT" | "MANAGER" | "LOCATION" | "EMPLOYMENT_TYPE" }>;

function isPlacement(input: EmploymentChangeInput): input is PlacementInput {
  return PLACEMENT_ACTIONS.has(input.action);
}

/** The permissions a change asks for (E-03 §63, ADR 0004 decision 11). */
export function changePermissions(input: EmploymentChangeInput, timing: Timing): Permission[] {
  const need: Permission[] = [];
  switch (input.action) {
    case "POSITION":
    case "DEPARTMENT":
      need.push("hr.employment.update");
      if (input.managerMemberId !== undefined) need.push("hr.employee.manager.assign");
      break;
    case "MANAGER":
      need.push("hr.employee.manager.assign");
      break;
    case "LOCATION":
    case "EMPLOYMENT_TYPE":
      need.push("hr.employment.update");
      break;
    case "STATUS":
    case "TERMINATE":
    case "REHIRE":
      need.push("hr.employee.status.update");
      break;
    case "LEGAL_ENTITY":
      need.push("hr.employment.transfer_entity");
      break;
  }
  if (timing === "FUTURE") need.push("hr.employment.schedule");
  if (timing === "PAST") need.push("hr.employment_history.correct");
  return need;
}

/** An employment within HR's scope, with or without a login; out of scope is not found (PRD #16 §202, E-04 §86). */
export async function loadTarget(context: UserContext, employmentId: string): Promise<Target> {
  // Out of HR's scope answers "not found" (PRD #16 §202).
  const row = await repository.findEmployee(context, employmentId);
  if (!row) throw new AccessError("NOT_FOUND");
  return {
    id: row.id,
    companyId: context.companyId,
    companyMemberId: row.companyMemberId,
    personProfileId: row.personProfileId,
    employmentStatus: row.employmentStatus,
    offboardingStatus: row.offboardingStatus,
    name: `${row.personProfile.firstName} ${row.personProfile.lastName}`,
  };
}

/** What a state allows (E-03 §103): ended employment only rehires; planned employment only starts, is revised or is cancelled. */
function assertAllowedInState(status: EmploymentStatus, input: EmploymentChangeInput): void {
  if (status === "ENDED") {
    if (input.action !== "REHIRE") throw stateDenied("Ended employment is history. Rehire the person, or correct the history.");
    return;
  }
  if (input.action === "REHIRE") throw new AccessError("CONFLICT", "Only ended employment can be reopened by a rehire.", { code: "NOT_ENDED" });
  if (status === "PLANNED") {
    if (input.action === "STATUS" && input.status !== "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A planned employment starts before anything else about its status changes.", { code: "NOT_STARTED" });
    if (input.action === "LEGAL_ENTITY") throw new AccessError("VALIDATION_ERROR", "Start the employment, or plan it in the other company instead.", { code: "NOT_STARTED" });
    return;
  }
  if (input.action === "STATUS") {
    if (input.status === status) throw new AccessError("CONFLICT", `The employment is already ${status.toLowerCase().replace("_", " ")}.`, { code: "NO_CHANGE" });
    if (!canTransitionEmployment(status, input.status)) throw new AccessError("VALIDATION_ERROR", `Employment cannot move from ${status} to ${input.status}.`, { code: "INVALID_TRANSITION" });
  }
}

function effectiveOf(input: EmploymentChangeInput): Day {
  return input.action === "TERMINATE" ? addDays(input.lastWorkingDay, 1) : input.effectiveDate;
}

/** A change to a planned employment revises its plan, whatever date it names (ADR 0004 decision 8). */
function revisesPlan(status: EmploymentStatus, input: EmploymentChangeInput): boolean {
  return status === "PLANNED" && (PLACEMENT_ACTIONS.has(input.action) || input.action === "TERMINATE");
}

function timingOf(status: EmploymentStatus, input: EmploymentChangeInput, today: Day): Timing {
  if (revisesPlan(status, input)) return "TODAY";
  const effective = effectiveOf(input);
  // A rehire in the future is planned, the way a hire is — nothing waits on the worker.
  if (input.action === "REHIRE" && effective > today) return "TODAY";
  return effective > today ? "FUTURE" : effective < today ? "PAST" : "TODAY";
}

/**
 * Applies, or schedules, one employment change for the employment this
 * membership holds (E-03 §35, §74).
 */
export async function applyEmploymentChange(
  context: UserContext,
  employmentId: string,
  input: EmploymentChangeInput,
  options: ChangeOptions,
): Promise<EmploymentChangeResultDTO> {
  assertModule(context, MODULE);
  const target = await loadTarget(context, employmentId);
  const today = todayDay();
  const timing = timingOf(target.employmentStatus, input, today);
  for (const permission of changePermissions(input, timing)) assertPermission(context, permission);
  assertAllowedInState(target.employmentStatus, input);
  if (input.documentId) await validateDocument(context, target.companyId, input.documentId);

  let acting: UserContext | null = null;
  if (input.action === "LEGAL_ENTITY") acting = await authorityIn(context, input.targetCompanyId, target.companyId);

  if (timing === "FUTURE") return scheduleChange(context, target, input, effectiveOf(input));

  const result = await prisma
    .$transaction(async (tx) => {
      await lockEmployment(tx, target.id);
      const fresh = await tx.employeeProfile.findFirstOrThrow({ where: { id: target.id, companyId: target.companyId }, select: { employmentStatus: true, offboardingStatus: true } });
      if (fresh.employmentStatus !== target.employmentStatus) {
        throw new AccessError("CONFLICT", "The employment changed since you opened it. Refresh and review it.", { code: "STALE_STATUS" });
      }
      return performChange(tx, {
        actor: { kind: "member", context },
        target: { ...target, offboardingStatus: fresh.offboardingStatus },
        input,
        effective: effectiveOf(input),
        source: "CHANGE",
        placement: options.placement,
        targetContext: acting,
      });
    })
    .catch(historyRaced);
  return result;
}

/** The actor's standing in the company a transfer goes to (E-03 §66, §67, §98, §196). */
async function authorityIn(context: UserContext, targetCompanyId: string, sourceCompanyId: string): Promise<UserContext> {
  if (targetCompanyId === sourceCompanyId) throw new AccessError("VALIDATION_ERROR", "Choose a different company to transfer to.", { field: "targetCompanyId" });
  const company = await prisma.company.findFirst({ where: { id: targetCompanyId, parentGroupId: context.parentGroupId }, select: { id: true, name: true, status: true } });
  // Another group's company, or none: not found, whatever id was sent (§5, §197).
  if (!company) throw new AccessError("VALIDATION_ERROR", "That company is not one of this group's.", { field: "targetCompanyId" });
  if (company.status !== "ACTIVE") throw new AccessError("VALIDATION_ERROR", `${company.name} is not active.`, { field: "targetCompanyId", code: "COMPANY_INACTIVE" });
  const there = await contextInCompany(context, targetCompanyId);
  if (!there || !there.enabledModules.includes("hr") || !can(there, "hr.employee.create_profile")) {
    throw new AccessError("FORBIDDEN", `Transferring somebody to ${company.name} needs HR authority there too.`, { code: "NO_AUTHORITY_IN_TARGET" });
  }
  return there;
}

/* -------------------------------------------------------------------------- */
/* Applying a change                                                           */
/* -------------------------------------------------------------------------- */

type PerformInput = {
  actor: HistoryActor;
  target: Target;
  input: EmploymentChangeInput;
  effective: Day;
  source: "CHANGE" | "SCHEDULED";
  placement: PlacementDoor;
  /** The actor in the company a transfer goes to; null for the worker. */
  targetContext: UserContext | null;
  scheduledChangeId?: string;
};

/**
 * One change, inside a transaction that has locked the employment. Used by the
 * immediate path and by the worker applying a scheduled change, so both follow
 * exactly the same rules (E-03 §38, §154).
 */
export async function performChange(tx: Prisma.TransactionClient, run: PerformInput): Promise<EmploymentChangeResultDTO> {
  const { input, target } = run;
  const userId = run.actor.kind === "member" ? run.actor.context.userId : run.actor.onBehalfOfUserId;
  if (run.actor.kind === "system" && input.documentId && !(await documentStillThere(tx, target.companyId, input.documentId))) {
    throw new AccessError("VALIDATION_ERROR", "The supporting document is no longer available.", { field: "documentId" });
  }
  const applied: EmploymentChangeResultDTO = { outcome: "APPLIED", employmentId: target.id, scheduledChangeId: run.scheduledChangeId ?? null, needsAccountIn: null };

  if (isPlacement(input)) {
    const open = await openAssignment(tx, target.id);
    if (!open) throw new AccessError("CONFLICT", "This employment has no current assignment to change.", { code: "NO_OPEN_ASSIGNMENT" });
    const { patch, reason } = await placementChange(tx, target, input);
    const effective = target.employmentStatus === "PLANNED" ? dayOf(open.startDate) : run.effective;
    const write = await writeAssignment(tx, {
      employmentId: target.id,
      companyId: target.companyId,
      patch,
      effective,
      reason,
      source: run.source,
      documentId: input.documentId ?? null,
      note: input.note ?? null,
      actorUserId: userId,
      expectedAssignmentId: run.source === "CHANGE" ? input.expectedAssignmentId : undefined,
    });
    if (!write) {
      if (run.source === "SCHEDULED") return applied;
      throw new AccessError("VALIDATION_ERROR", "Nothing would change.", { code: "NO_CHANGE" });
    }
    await syncCache(tx, target, { actorMemberId: memberOf(run.actor, target.companyId) });
    await mirrorToMembership(tx, { employmentId: target.id, companyId: target.companyId, placement: run.placement, actor: run.actor.kind === "member" ? run.actor.context : null });
    await recordAssignmentChange(tx, run, write, effective, CHANGE_TYPE[input.action]!);
    return applied;
  }

  switch (input.action) {
    case "STATUS":
      await changeStatus(tx, run, input.status, input.reason ?? null, input.privateReason ?? null);
      return applied;
    case "TERMINATE":
      await terminate(tx, run, input.lastWorkingDay, input.reason, input.privateReason ?? null);
      return applied;
    case "REHIRE":
      await rehire(tx, run, input);
      return applied;
    case "LEGAL_ENTITY":
      return transferToCompany(tx, run, input);
    default:
      throw new AccessError("VALIDATION_ERROR", "Unknown change.");
  }
}

function memberOf(actor: HistoryActor, companyId: string): string | null | undefined {
  return actor.kind === "member" && actor.context.companyId === companyId ? actor.context.membershipId : undefined;
}

async function placementChange(
  tx: Prisma.TransactionClient,
  target: Target,
  input: PlacementInput,
): Promise<{ patch: PlacementPatch; reason: Parameters<typeof writeAssignment>[1]["reason"] }> {
  const patch: PlacementPatch = {};
  const manager = async (id: string | null | undefined) => {
    if (id === undefined) return;
    patch.managerMemberId = id === null ? null : (await validateManager(tx, { companyId: target.companyId, managerMemberId: id, subjectMemberId: target.companyMemberId })).id;
  };
  switch (input.action) {
    case "POSITION":
      patch.jobTitle = input.jobTitle;
      if (input.departmentId) patch.departmentId = (await validateDepartment(tx, target.companyId, input.departmentId)).id;
      await manager(input.managerMemberId);
      return { patch, reason: input.reason };
    case "DEPARTMENT":
      patch.departmentId = (await validateDepartment(tx, target.companyId, input.departmentId)).id;
      await manager(input.managerMemberId);
      if (input.workLocationType) patch.workLocationType = input.workLocationType;
      if (input.workLocation !== undefined) patch.workLocation = input.workLocation;
      return { patch, reason: "DEPARTMENT_TRANSFER" };
    case "MANAGER":
      await manager(input.managerMemberId);
      return { patch, reason: "MANAGER_CHANGE" };
    case "LOCATION":
      patch.workLocationType = input.workLocationType;
      patch.workLocation = input.workLocation ?? null;
      return { patch, reason: "LOCATION_CHANGE" };
    case "EMPLOYMENT_TYPE":
      patch.employmentType = input.employmentType;
      return { patch, reason: "EMPLOYMENT_TYPE_CHANGE" };
  }
}

async function recordAssignmentChange(tx: Prisma.TransactionClient, run: PerformInput, write: AssignmentWrite, effective: Day, changeType: EmploymentChangeType): Promise<void> {
  const { target } = run;
  await auditEmployment(tx, run.actor, target.companyId, {
    actionKey: AuditAction.HR_EMPLOYMENT_ASSIGNMENT_CHANGED,
    entity: { type: ENTITY, id: target.id, label: target.name },
    before: assignmentFacts(write.before),
    after: { ...assignmentFacts(write.after), effectiveDate: effective, changeType, source: run.source, scheduledChangeId: run.scheduledChangeId ?? null },
  });
  const summary = describeAssignmentChange(write);
  if (run.actor.kind === "member" && run.actor.context.companyId === target.companyId) {
    await recordActivity(tx, run.actor.context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: `HR_EMPLOYMENT_${changeType}`,
      message: `${summary}, effective ${effective}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, assignmentId: write.after.id, effectiveDate: effective, changeType } as Prisma.InputJsonValue,
    });
  }
  // The employee hears of a promotion, a new department or a new manager — never why (E-03 §151, §152).
  if (target.companyMemberId && (changeType === "POSITION_CHANGE" || changeType === "DEPARTMENT_TRANSFER" || changeType === "MANAGER_CHANGE") && effective <= todayDay()) {
    await enqueueNotificationEvent(tx, {
      companyId: target.companyId,
      eventType: NotificationEvent.EMPLOYMENT_CHANGE_EFFECTIVE,
      moduleKey: MODULE,
      entityType: "employee",
      entityId: target.id,
      actorMemberId: memberOf(run.actor, target.companyId) ?? null,
      payload: { memberId: target.companyMemberId, change: summary, effectiveDate: effective },
    });
  }
}

/** "Promoted to Senior Architect", "Moved to Finance", "Manager is now Ana Hoxha" (E-03 §132, §151). */
export function describeAssignmentChange(write: AssignmentWrite): string {
  const after = write.after;
  const parts: string[] = [];
  if (write.changed.includes("jobTitle")) parts.push(after.reason === "PROMOTION" ? `Promoted to ${after.jobTitle ?? "a new position"}` : `Title changed to ${after.jobTitle ?? "none"}`);
  if (write.changed.includes("departmentId")) parts.push(after.departmentName ? `Moved to ${after.departmentName}` : "No longer in a department");
  if (write.changed.includes("managerMemberId")) parts.push(after.managerName ? `Manager is now ${after.managerName}` : "No manager");
  if (write.changed.includes("workLocationType") || write.changed.includes("workLocation")) parts.push(`Works at ${[after.workLocationType?.toLowerCase(), after.workLocation].filter(Boolean).join(", ") || "no set location"}`);
  if (write.changed.includes("employmentType")) parts.push(`Employment type is now ${after.employmentType.toLowerCase().replace("_", " ")}`);
  return parts.join("; ") || "Supporting document linked";
}

/* Status (E-03 §22, §102, §103) --------------------------------------------- */

const DEFAULT_STATUS_REASON: Record<"ACTIVE" | "ON_LEAVE" | "SUSPENDED", EmploymentStatusReason> = { ACTIVE: "RETURN", ON_LEAVE: "LEAVE", SUSPENDED: "SUSPENSION" };

async function changeStatus(tx: Prisma.TransactionClient, run: PerformInput, next: "ACTIVE" | "ON_LEAVE" | "SUSPENDED", reason: EmploymentStatusReason | null, privateReason: string | null): Promise<void> {
  const { target } = run;
  const current = await tx.employeeProfile.findFirstOrThrow({ where: { id: target.id, companyId: target.companyId }, select: { employmentStatus: true } });
  const userId = run.actor.kind === "member" ? run.actor.context.userId : run.actor.onBehalfOfUserId;
  if (current.employmentStatus === "PLANNED") {
    if (next !== "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A planned employment starts before anything else about its status changes.", { code: "NOT_STARTED" });
    await activate(tx, run, userId);
  } else {
    if (current.employmentStatus === next || !canTransitionEmployment(current.employmentStatus, next)) {
      throw new AccessError("VALIDATION_ERROR", `Employment cannot move from ${current.employmentStatus} to ${next}.`, { code: "INVALID_TRANSITION" });
    }
    await writeStatus(tx, { employmentId: target.id, companyId: target.companyId, status: next, effective: run.effective, reason: reason ?? DEFAULT_STATUS_REASON[next], privateReason, documentId: run.input.documentId ?? null, source: run.source, actorUserId: userId });
  }
  await syncCache(tx, target, { actorMemberId: memberOf(run.actor, target.companyId) });
  await auditEmployment(tx, run.actor, target.companyId, {
    actionKey: AuditAction.HR_EMPLOYMENT_STATUS_CHANGED,
    entity: { type: ENTITY, id: target.id, label: target.name },
    before: { employmentStatus: current.employmentStatus },
    after: { employmentStatus: next, effectiveDate: run.effective, statusReason: reason ?? (current.employmentStatus === "PLANNED" ? "HIRE" : DEFAULT_STATUS_REASON[next]), privateReasonRecorded: Boolean(privateReason), documentId: run.input.documentId ?? null, source: run.source },
  });
  if (run.actor.kind === "member" && run.actor.context.companyId === target.companyId) {
    await recordActivity(tx, run.actor.context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: `HR_EMPLOYMENT_${next}`,
      message: current.employmentStatus === "PLANNED" ? `started their employment on ${run.effective}` : `set their employment to ${next.toLowerCase().replace("_", " ")} from ${run.effective}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, from: current.employmentStatus, to: next, effectiveDate: run.effective } as Prisma.InputJsonValue,
    });
  }
}

/**
 * A planned employment begins (E-03 §25). The plan was never in effect, so its
 * rows are replaced by ones starting on the real first day — which may be
 * earlier than the day the record was made, when HR records a start after the
 * fact.
 */
async function activate(tx: Prisma.TransactionClient, run: PerformInput, userId: string | null): Promise<void> {
  const { target } = run;
  const planned = await openStatus(tx, target.id);
  const plan = await openAssignment(tx, target.id);
  if (!planned || !plan) throw new AccessError("CONFLICT", "This employment has no plan to start.", { code: "NO_HISTORY" });
  const previousEnd = await tx.employmentAssignment.findFirst({
    where: { employeeProfileId: target.id, supersededAt: null, endDate: { not: null } },
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });
  if (previousEnd?.endDate && run.effective <= dayOf(previousEnd.endDate)) {
    throw new AccessError("VALIDATION_ERROR", `The previous period ended on ${dayOf(previousEnd.endDate)}; the start must be after it.`, { field: "effectiveDate", code: "BEFORE_CURRENT_PERIOD" });
  }
  const reason: EmploymentStatusReason = planned.reason === "REHIRE" ? "REHIRE" : planned.reason === "LEGAL_ENTITY_TRANSFER" ? "LEGAL_ENTITY_TRANSFER" : "HIRE";
  if (run.effective > dayOf(planned.effectiveFrom)) {
    await writeStatus(tx, { employmentId: target.id, companyId: target.companyId, status: "ACTIVE", effective: run.effective, reason, documentId: run.input.documentId ?? null, source: run.source, actorUserId: userId });
  } else {
    await supersede(tx, "status", planned.id, target.companyId, userId);
    await insertStatus(tx, { employmentId: target.id, companyId: target.companyId, status: "ACTIVE", effectiveFrom: run.effective, effectiveTo: null, reason, documentId: run.input.documentId ?? null, source: run.source, actorUserId: userId, correctsId: planned.id });
  }
  if (dayOf(plan.startDate) !== run.effective) {
    await supersede(tx, "assignment", plan.id, target.companyId, userId);
    await insertAssignment(tx, { employmentId: target.id, companyId: target.companyId, placement: placementOf(plan), startDate: run.effective, endDate: null, reason: plan.reason, source: run.source, documentId: plan.sourceDocumentId, actorUserId: userId, correctsId: plan.id });
  }
}

/* Ending (E-03 §91-§93, §104) ------------------------------------------------ */

async function terminate(tx: Prisma.TransactionClient, run: PerformInput, lastWorkingDay: Day, reason: EmploymentStatusReason, privateReason: string | null): Promise<void> {
  const { target } = run;
  const userId = run.actor.kind === "member" ? run.actor.context.userId : run.actor.onBehalfOfUserId;
  const current = await tx.employeeProfile.findFirstOrThrow({ where: { id: target.id, companyId: target.companyId }, select: { employmentStatus: true, offboardingStatus: true } });
  let effective = addDays(lastWorkingDay, 1);

  if (current.employmentStatus === "PLANNED") {
    // A plan that never began is withdrawn: its assignment was never in effect.
    effective = todayDay();
    const plan = await openAssignment(tx, target.id);
    if (plan) await supersede(tx, "assignment", plan.id, target.companyId, userId);
  } else {
    await closeAssignment(tx, target.id, target.companyId, lastWorkingDay);
  }
  await writeStatus(tx, { employmentId: target.id, companyId: target.companyId, status: "ENDED", effective, reason, privateReason, documentId: run.input.documentId ?? null, source: run.source, actorUserId: userId });
  // Nothing scheduled after the end can happen (E-03 §157).
  // (A scheduled change being applied now is already APPLIED, so it is not among them.)
  const cancelled = await tx.employmentChange.updateMany({
    where: { employeeProfileId: target.id, companyId: target.companyId, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: userId, cancelReason: "The employment ended." },
  });
  // Ending employment opens offboarding (PRD #16 §124). Company access is Team's decision, not this one (E-03 §92, §149).
  await tx.employeeProfile.updateMany({
    where: { id: target.id, companyId: target.companyId, offboardingStatus: current.offboardingStatus },
    data: { offboardingStatus: current.offboardingStatus === "NOT_REQUIRED" && current.employmentStatus !== "PLANNED" ? "NOT_STARTED" : current.offboardingStatus },
  });
  await syncCache(tx, target, { actorMemberId: memberOf(run.actor, target.companyId) });
  await auditEmployment(tx, run.actor, target.companyId, {
    actionKey: AuditAction.HR_EMPLOYMENT_TERMINATED,
    entity: { type: ENTITY, id: target.id, label: target.name },
    before: { employmentStatus: current.employmentStatus },
    after: { employmentStatus: "ENDED", lastWorkingDay: current.employmentStatus === "PLANNED" ? null : lastWorkingDay, effectiveDate: effective, statusReason: reason, privateReasonRecorded: Boolean(privateReason), documentId: run.input.documentId ?? null, cancelledScheduledChanges: cancelled.count, source: run.source },
  });
  if (run.actor.kind === "member" && run.actor.context.companyId === target.companyId) {
    await recordActivity(tx, run.actor.context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: "HR_EMPLOYMENT_ENDED",
      message: current.employmentStatus === "PLANNED" ? "withdrew the planned employment" : `recorded the end of their employment, last day ${lastWorkingDay}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, lastWorkingDay, effectiveDate: effective } as Prisma.InputJsonValue,
    });
  }
}

/* Rehire (E-03 §26, §95; E-04 §108) ------------------------------------------ */

async function rehire(tx: Prisma.TransactionClient, run: PerformInput, input: Extract<EmploymentChangeInput, { action: "REHIRE" }>): Promise<void> {
  const { target } = run;
  const userId = run.actor.kind === "member" ? run.actor.context.userId : run.actor.onBehalfOfUserId;
  const ended = await openStatus(tx, target.id);
  if (!ended || ended.status !== "ENDED") throw new AccessError("CONFLICT", "Only ended employment can be reopened by a rehire.", { code: "NOT_ENDED" });
  const endedFrom = dayOf(ended.effectiveFrom);
  if (input.effectiveDate <= endedFrom) {
    throw new AccessError("VALIDATION_ERROR", `The employment ended from ${endedFrom}. A rehire starts later; to undo the ending, correct the history.`, { field: "effectiveDate", code: "BEFORE_CURRENT_PERIOD" });
  }
  const last = await lastAssignment(tx, target.id);
  if (!last) throw new AccessError("CONFLICT", "This employment has no history to continue.", { code: "NO_HISTORY" });

  const placement: Placement = { ...placementOf(last) };
  if (input.jobTitle) placement.jobTitle = input.jobTitle;
  if (input.departmentId) placement.departmentId = (await validateDepartment(tx, target.companyId, input.departmentId)).id;
  if (input.managerMemberId !== undefined) {
    placement.managerMemberId = input.managerMemberId === null ? null : (await validateManager(tx, { companyId: target.companyId, managerMemberId: input.managerMemberId, subjectMemberId: target.companyMemberId })).id;
  } else if (placement.managerMemberId) {
    // A manager who has since left is not carried over into the new period.
    const stillHere = await tx.companyMember.count({ where: { id: placement.managerMemberId, companyId: target.companyId, status: "ACTIVE" } });
    if (!stillHere) placement.managerMemberId = null;
  }
  if (!input.departmentId && placement.departmentId) {
    const open = await tx.department.count({ where: { id: placement.departmentId, companyId: target.companyId, status: "ACTIVE" } });
    if (!open) placement.departmentId = null;
  }
  if (input.employmentType) placement.employmentType = input.employmentType;
  if (input.workLocationType) placement.workLocationType = input.workLocationType;
  if (input.workLocation !== undefined) placement.workLocation = input.workLocation;

  const today = todayDay();
  const startsNow = input.effectiveDate <= today;
  await writeStatus(tx, {
    employmentId: target.id,
    companyId: target.companyId,
    status: startsNow ? "ACTIVE" : "PLANNED",
    // Still ended on the day it ended from; planned from the day after at the earliest.
    effective: startsNow ? input.effectiveDate : today > endedFrom ? today : addDays(endedFrom, 1),
    reason: "REHIRE",
    documentId: input.documentId ?? null,
    source: run.source,
    actorUserId: userId,
  });
  await insertAssignment(tx, { employmentId: target.id, companyId: target.companyId, placement, startDate: input.effectiveDate, endDate: null, reason: "REHIRE", source: run.source, documentId: input.documentId ?? null, note: input.note ?? null, actorUserId: userId });
  await tx.employeeProfile.updateMany({ where: { id: target.id, companyId: target.companyId, employmentStatus: "ENDED" }, data: { onboardingStatus: "NOT_STARTED", offboardingStatus: "NOT_REQUIRED" } });
  await syncCache(tx, target, { clearPlannedEnd: true, actorMemberId: memberOf(run.actor, target.companyId) });
  await mirrorToMembership(tx, { employmentId: target.id, companyId: target.companyId, placement: run.placement, actor: run.actor.kind === "member" ? run.actor.context : null });
  await auditEmployment(tx, run.actor, target.companyId, {
    actionKey: AuditAction.HR_EMPLOYMENT_REHIRED,
    entity: { type: ENTITY, id: target.id, label: target.name },
    before: { employmentStatus: "ENDED", endedFrom },
    after: { employmentStatus: startsNow ? "ACTIVE" : "PLANNED", effectiveDate: input.effectiveDate, departmentId: placement.departmentId, jobTitle: placement.jobTitle, managerMemberId: placement.managerMemberId, employmentType: placement.employmentType, documentId: input.documentId ?? null, source: run.source },
  });
  if (run.actor.kind === "member" && run.actor.context.companyId === target.companyId) {
    await recordActivity(tx, run.actor.context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: "HR_EMPLOYEE_REHIRED",
      message: `rehired them from ${input.effectiveDate}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, previousEndDate: addDays(endedFrom, -1), effectiveDate: input.effectiveDate } as Prisma.InputJsonValue,
    });
  }
}

/* Company transfer (E-03 §13, §98, §221) ------------------------------------- */

/**
 * The person moves to another company of the group (E-03 §13, §98; ADR 0004
 * decision 5). A company is its own legal entity and its employment its own
 * record, so the employment here ends the day before and one there begins — the
 * one they had there before, reopened, if they worked there once. Their login's
 * membership there, if they have one, is linked; if not, an account request is
 * the next step (§92). Access here is not touched: that is Team's decision.
 */
async function transferToCompany(tx: Prisma.TransactionClient, run: PerformInput, input: Extract<EmploymentChangeInput, { action: "LEGAL_ENTITY" }>): Promise<EmploymentChangeResultDTO> {
  const { target } = run;
  const userId = run.actor.kind === "member" ? run.actor.context.userId : run.actor.onBehalfOfUserId;
  const effective = run.effective;
  const lastDay = addDays(effective, -1);
  const company = await tx.company.findFirst({
    where: { id: input.targetCompanyId, status: "ACTIVE", parentGroup: { companies: { some: { id: target.companyId } } } },
    select: { id: true, name: true },
  });
  if (!company || company.id === target.companyId) throw new AccessError("VALIDATION_ERROR", "That company is not one this employment can move to.", { field: "targetCompanyId" });

  const person = await tx.personProfile.findFirstOrThrow({ where: { id: target.personProfileId, employments: { some: { id: target.id, companyId: target.companyId } } }, select: { user: { select: { id: true } } } });
  const membership = person.user ? await tx.companyMember.findFirst({ where: { companyId: company.id, userId: person.user.id }, select: { id: true, employeeProfile: { select: { id: true } } } }) : null;
  const department = await validateDepartment(tx, company.id, input.departmentId);
  const manager = input.managerMemberId ? await validateManager(tx, { companyId: company.id, managerMemberId: input.managerMemberId, subjectMemberId: membership?.id ?? null }) : null;

  const existing = await tx.employeeProfile.findFirst({
    where: { companyId: company.id, personProfileId: target.personProfileId },
    orderBy: { createdAt: "desc" },
    select: { id: true, employmentStatus: true, companyMemberId: true },
  });
  if (existing && existing.employmentStatus !== "ENDED") {
    throw new AccessError("CONFLICT", `${target.name} already has an employment in ${company.name}.`, { code: "ALREADY_EMPLOYED" });
  }

  // Here: the last day, and ended by the transfer.
  const source = await openAssignment(tx, target.id);
  if (!source) throw new AccessError("CONFLICT", "This employment has no current assignment.", { code: "NO_OPEN_ASSIGNMENT" });
  await closeAssignment(tx, target.id, target.companyId, lastDay);
  await writeStatus(tx, { employmentId: target.id, companyId: target.companyId, status: "ENDED", effective, reason: "LEGAL_ENTITY_TRANSFER", documentId: input.documentId ?? null, source: run.source, actorUserId: userId });
  await tx.employmentChange.updateMany({
    where: { employeeProfileId: target.id, companyId: target.companyId, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: userId, cancelReason: `Transferred to ${company.name}.` },
  });
  await syncCache(tx, target, { actorMemberId: memberOf(run.actor, target.companyId) });

  // There: a new period, in the reopened or a new employment record.
  const placement: Placement = {
    departmentId: department.id,
    jobTitle: input.jobTitle,
    managerMemberId: manager?.id ?? null,
    workLocationType: input.workLocationType ?? source.workLocationType,
    workLocation: input.workLocation !== undefined ? input.workLocation : source.workLocation,
    employmentType: input.employmentType ?? source.employmentType,
  };
  const linkable = membership && (!membership.employeeProfile || membership.employeeProfile.id === existing?.id) ? membership.id : null;
  let employmentId: string;
  if (existing) {
    employmentId = existing.id;
    await lockEmployment(tx, existing.id);
    const ended = await openStatus(tx, existing.id);
    if (ended && dayOf(ended.effectiveFrom) >= effective) {
      throw new AccessError("CONFLICT", `The earlier employment in ${company.name} ended too recently to reopen from ${effective}.`, { code: "BEFORE_CURRENT_PERIOD" });
    }
    await writeStatus(tx, { employmentId, companyId: company.id, status: "ACTIVE", effective, reason: "LEGAL_ENTITY_TRANSFER", documentId: null, source: run.source, actorUserId: userId });
    await insertAssignment(tx, { employmentId, companyId: company.id, placement, startDate: effective, endDate: null, reason: "LEGAL_ENTITY_TRANSFER", source: run.source, note: input.note ?? null, actorUserId: userId });
    await tx.employeeProfile.updateMany({ where: { id: employmentId, companyId: company.id, employmentStatus: "ENDED" }, data: { companyMemberId: existing.companyMemberId ?? linkable, onboardingStatus: "NOT_STARTED", offboardingStatus: "NOT_REQUIRED" } });
  } else {
    const created = await tx.employeeProfile.create({
      data: {
        companyId: company.id,
        personProfileId: target.personProfileId,
        companyMemberId: linkable,
        employmentStatus: "ACTIVE",
        employmentType: placement.employmentType,
        createdByMemberId: run.targetContext?.membershipId ?? null,
      },
      select: { id: true },
    });
    employmentId = created.id;
    await startHistory(tx, { employmentId, companyId: company.id, placement, start: effective, status: "ACTIVE", statusFrom: effective, assignmentReason: "LEGAL_ENTITY_TRANSFER", statusReason: "LEGAL_ENTITY_TRANSFER", source: run.source, actorUserId: userId });
  }
  await syncCache(tx, { id: employmentId, companyId: company.id }, { clearPlannedEnd: true, actorMemberId: run.targetContext?.membershipId });
  await mirrorToMembership(tx, { employmentId, companyId: company.id, placement: run.placement, actor: run.targetContext });

  const facts = { employeeProfileId: target.id, companyId: target.companyId, targetCompanyId: company.id, targetEmploymentId: employmentId, effectiveDate: effective, lastWorkingDay: lastDay, departmentId: department.id, departmentName: department.name, jobTitle: input.jobTitle, managerMemberId: manager?.id ?? null, documentId: input.documentId ?? null, reopened: Boolean(existing), source: run.source };
  await auditEmployment(tx, run.actor, target.companyId, { actionKey: AuditAction.HR_EMPLOYMENT_ENTITY_TRANSFERRED, entity: { type: ENTITY, id: target.id, label: target.name }, before: { employmentStatus: target.employmentStatus }, after: { ...facts, employmentStatus: "ENDED" } });
  await auditEmployment(tx, run.targetContext ? { kind: "member", context: run.targetContext } : run.actor, company.id, { actionKey: AuditAction.HR_EMPLOYMENT_ENTITY_TRANSFERRED, entity: { type: ENTITY, id: employmentId, label: target.name }, after: { ...facts, employmentStatus: "ACTIVE" } });
  if (run.actor.kind === "member" && run.actor.context.companyId === target.companyId) {
    await recordActivity(tx, run.actor.context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: "HR_EMPLOYMENT_LEGAL_ENTITY_TRANSFER",
      message: `transferred them to ${company.name} from ${effective}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, targetEmploymentId: employmentId, targetCompanyId: company.id, effectiveDate: effective } as Prisma.InputJsonValue,
    });
  }
  const linked = await tx.employeeProfile.findFirstOrThrow({ where: { id: employmentId, companyId: company.id }, select: { companyMemberId: true } });
  if (linked.companyMemberId && effective <= todayDay()) {
    await enqueueNotificationEvent(tx, {
      companyId: company.id,
      eventType: NotificationEvent.EMPLOYMENT_CHANGE_EFFECTIVE,
      moduleKey: MODULE,
      entityType: "employee",
      entityId: employmentId,
      actorMemberId: run.targetContext?.membershipId ?? null,
      payload: { memberId: linked.companyMemberId, change: `You now work for ${company.name}`, effectiveDate: effective },
    });
  }
  return {
    outcome: "APPLIED",
    employmentId,
    scheduledChangeId: run.scheduledChangeId ?? null,
    needsAccountIn: linked.companyMemberId ? null : { companyId: company.id, companyName: company.name, employmentId },
  };
}

/* -------------------------------------------------------------------------- */
/* Scheduling (E-03 §31-§34, §77, §169, §170)                                  */
/* -------------------------------------------------------------------------- */

async function scheduleChange(context: UserContext, target: Target, input: EmploymentChangeInput, effective: Day): Promise<EmploymentChangeResultDTO> {
  const type = CHANGE_TYPE[input.action];
  if (!type) throw new AccessError("VALIDATION_ERROR", "This change cannot be scheduled.", { code: "NOT_SCHEDULABLE" });

  return prisma
    .$transaction(async (tx) => {
      await lockEmployment(tx, target.id);
      // What it names must exist now; it is checked again on the day (§156).
      if (isPlacement(input)) await placementChange(tx, target, input);
      if (input.action === "LEGAL_ENTITY") {
        await validateDepartment(tx, input.targetCompanyId, input.departmentId);
        if (input.managerMemberId) await validateManager(tx, { companyId: input.targetCompanyId, managerMemberId: input.managerMemberId, subjectMemberId: null });
      }
      const scheduled = await tx.employmentChange.findMany({ where: { employeeProfileId: target.id, status: "SCHEDULED" }, select: { effectiveDate: true, type: true } });
      const clash = scheduled.find((row) => dayOf(row.effectiveDate) === effective);
      if (clash) throw new AccessError("CONFLICT", `A ${changeTypeLabels[clash.type].toLowerCase()} is already scheduled for ${effective}. Cancel it or choose another day.`, { code: "SCHEDULE_CLASH" });
      const ending = scheduled.find((row) => (row.type === "TERMINATION" || row.type === "LEGAL_ENTITY_TRANSFER") && dayOf(row.effectiveDate) <= effective);
      if (ending) throw new AccessError("CONFLICT", `The employment is scheduled to end from ${dayOf(ending.effectiveDate)}; nothing can be scheduled after that.`, { code: "SCHEDULED_AFTER_END" });
      if ((type === "TERMINATION" || type === "LEGAL_ENTITY_TRANSFER") && scheduled.some((row) => dayOf(row.effectiveDate) > effective)) {
        throw new AccessError("CONFLICT", "Changes are scheduled after that day. Cancel them first.", { code: "SCHEDULED_AFTER_END" });
      }
      const change = await tx.employmentChange.create({
        data: {
          companyId: target.companyId,
          employeeProfileId: target.id,
          type,
          effectiveDate: new Date(`${effective}T00:00:00.000Z`),
          payload: input as unknown as Prisma.InputJsonValue,
          sourceDocumentId: input.documentId ?? null,
          requestedByUserId: context.userId,
        },
        select: { id: true },
      });
      await auditEmployment(tx, { kind: "member", context }, target.companyId, {
        actionKey: AuditAction.HR_EMPLOYMENT_CHANGE_SCHEDULED,
        entity: { type: ENTITY, id: target.id, label: target.name },
        after: { scheduledChangeId: change.id, changeType: type, effectiveDate: effective, documentId: input.documentId ?? null, ...(input.action === "LEGAL_ENTITY" ? { targetCompanyId: input.targetCompanyId } : {}) },
      });
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: target.id,
        action: "HR_EMPLOYMENT_CHANGE_SCHEDULED",
        message: `scheduled a ${changeTypeLabels[type].toLowerCase()} for ${effective}`,
        metadata: { memberId: target.companyMemberId, employmentId: target.id, scheduledChangeId: change.id, changeType: type, effectiveDate: effective } as Prisma.InputJsonValue,
      });
      return { outcome: "SCHEDULED" as const, employmentId: target.id, scheduledChangeId: change.id, needsAccountIn: null };
    })
    .catch(historyRaced);
}

/** Cancels a change before it applies (E-03 §157, §210). After, the history is corrected instead. */
export async function cancelScheduledChange(context: UserContext, employmentId: string, changeId: string, reason: string | undefined): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employment.schedule");
  const target = await loadTarget(context, employmentId);
  await prisma.$transaction(async (tx) => {
    const change = await tx.employmentChange.findFirst({ where: { id: changeId, employeeProfileId: target.id, companyId: target.companyId }, select: { id: true, status: true, type: true, effectiveDate: true } });
    if (!change) throw new AccessError("NOT_FOUND");
    const cancelled = await tx.employmentChange.updateMany({
      where: { id: change.id, companyId: target.companyId, status: "SCHEDULED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: context.userId, cancelReason: reason ?? null },
    });
    if (cancelled.count === 0) {
      throw new AccessError("CONFLICT", change.status === "APPLIED" ? "This change has already taken effect. Correct the history instead." : "This change is no longer scheduled.", { code: "NOT_SCHEDULED" });
    }
    await auditEmployment(tx, { kind: "member", context }, target.companyId, {
      actionKey: AuditAction.HR_EMPLOYMENT_CHANGE_CANCELLED,
      entity: { type: ENTITY, id: target.id, label: target.name },
      before: { scheduledChangeId: change.id, changeStatus: "SCHEDULED" },
      after: { scheduledChangeId: change.id, changeStatus: "CANCELLED", changeType: change.type, effectiveDate: dayOf(change.effectiveDate) },
    });
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: target.id,
      action: "HR_EMPLOYMENT_CHANGE_CANCELLED",
      message: `cancelled the ${changeTypeLabels[change.type].toLowerCase()} scheduled for ${dayOf(change.effectiveDate)}`,
      metadata: { memberId: target.companyMemberId, employmentId: target.id, scheduledChangeId: change.id } as Prisma.InputJsonValue,
    });
  });
}
