import { Prisma, type EmploymentStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { businessDateString, toBusinessDate } from "../hr.date";
import { buildHrMemberScopeWhere, isSelf } from "../hr.scope";
import { canTransitionEmployment } from "../hr.status";
import type {
  CreateEmployeeProfileInput,
  EmployeeListQuery,
  EmploymentStatusInput,
  UpdateEmployeeProfileInput,
} from "../hr.schema";
import type { EmployeeDetailDTO, EmployeeSummaryDTO } from "../hr.types";
import * as repository from "./employee.repository";

/**
 * Employment records (PRD #16 §25–§57).
 *
 * Three rules live here and nowhere else:
 *
 *   1. **Employment is not access.** Ending somebody's employment does not
 *      deactivate their membership, and deactivating a membership does not end
 *      their employment. Both are deliberate, separate decisions — HR records
 *      what happened, Team decides who can sign in (PRD #16 §29, §230, §231).
 *   2. **Pay is never part of an employee DTO.** Compensation has its own
 *      service and its own permission; `hr.employee.view` tells you somebody
 *      works here and nothing about what they earn (PRD #16 §15, §17).
 *   3. **Nobody manages themselves.** A manager loop would make the department
 *      approval chain infinite (PRD #16 §32).
 */

const MODULE = "hr" as const;
const ENTITY = "EmployeeProfile";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listEmployees(context: UserContext, query: EmployeeListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.view");

  const { rows, total } = await repository.listEmployees(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/**
 * One employment record, addressed by membership id.
 *
 * Self-service is the second door: somebody with no HR permission at all still
 * reaches their own record through `hr.self.employment` (PRD #16 §16).
 */
export async function getEmployee(
  context: UserContext,
  memberId: string,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);

  const own = isSelf(context, memberId);
  if (!can(context, "hr.employee.view") && !(own && can(context, "hr.self.employment"))) {
    assertPermission(context, "hr.employee.view");
  }

  // Out of scope answers "not found", so the response cannot confirm that
  // somebody works here to a reader who may not see them (PRD #16 §202).
  const profile = assertFound(await repository.findEmployeeByMember(context, memberId));
  const guards = await employmentGuards(context, profile.id, profile.companyMemberId);

  return toDetailDTO(context, profile, guards);
}

/** Whether a profile exists for this member at all, for the Team cross-link. */
export async function hasEmployeeProfile(
  context: UserContext,
  memberId: string,
): Promise<boolean> {
  if (!can(context, "hr.employee.view") && !isSelf(context, memberId)) return false;
  const found = await repository.findEmployeeByMember(context, memberId);
  return found !== null;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createEmployeeProfile(
  context: UserContext,
  input: CreateEmployeeProfileInput,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.create_profile");

  const member = await validateMember(context, input.companyMemberId);
  const manager = await validateManager(context, input.managerMemberId, input.companyMemberId);

  const memberId = await prisma.$transaction(async (tx) => {
    const existing = await tx.employeeProfile.findUnique({
      where: { companyMemberId: member.id },
      select: { id: true },
    });
    if (existing) {
      throw new AccessError("CONFLICT", "That person already has an employment record.");
    }

    if (input.employeeNumber) {
      await assertNumberIsFree(tx, context, input.employeeNumber, null);
    }

    await tx.employeeProfile.create({
      data: {
        companyId: context.companyId,
        companyMemberId: member.id,
        employeeNumber: input.employeeNumber ?? null,
        // A profile always starts PLANNED. Making somebody active is its own
        // action, so the date it happened is recorded (PRD #16 §38, §54).
        employmentStatus: "PLANNED",
        employmentType: input.employmentType,
        startDate: input.startDate ? toBusinessDate(input.startDate) : null,
        probationEndDate: input.probationEndDate
          ? toBusinessDate(input.probationEndDate)
          : null,
        endDate: input.endDate ? toBusinessDate(input.endDate) : null,
        managerMemberId: manager?.id ?? null,
        workLocation: input.workLocation ?? null,
        weeklyHours: input.weeklyHours ?? null,
        createdByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: member.id,
      action: "HR_EMPLOYEE_PROFILE_CREATED",
      message: `created an employment record for ${member.name}`,
      metadata: { memberId: member.id, employmentType: input.employmentType } as Prisma.InputJsonValue,
    });

    return member.id;
  });

  return getEmployee(context, memberId);
}

export async function updateEmployeeProfile(
  context: UserContext,
  memberId: string,
  input: UpdateEmployeeProfileInput,
): Promise<EmployeeDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employment.update");

  const existing = assertFound(await repository.findEmployeeByMember(context, memberId));

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This record was updated by another user. Refresh and review the latest changes.",
    );
  }

  const managerChanged = (input.managerMemberId ?? null) !== (existing.managerMember?.id ?? null);
  if (managerChanged) assertPermission(context, "hr.employee.manager.assign");

  const manager = managerChanged
    ? await validateManager(context, input.managerMemberId, memberId)
    : existing.managerMember;

  await prisma.$transaction(async (tx) => {
    if (input.employeeNumber) {
      await assertNumberIsFree(tx, context, input.employeeNumber, existing.id);
    }

    await tx.employeeProfile.update({
      where: { id: existing.id },
      data: {
        employeeNumber: input.employeeNumber ?? null,
        employmentType: input.employmentType,
        startDate: input.startDate ? toBusinessDate(input.startDate) : null,
        probationEndDate: input.probationEndDate
          ? toBusinessDate(input.probationEndDate)
          : null,
        endDate: input.endDate ? toBusinessDate(input.endDate) : null,
        managerMemberId: manager?.id ?? null,
        workLocation: input.workLocation ?? null,
        weeklyHours: input.weeklyHours ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (managerChanged) {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: memberId,
        action: "HR_EMPLOYEE_MANAGER_CHANGED",
        message: manager
          ? `set their manager to ${managerName(manager)}`
          : "removed their manager",
        metadata: {
          memberId,
          ...(changeMetadata({
            managerMemberId: {
              from: existing.managerMember?.id ?? null,
              to: manager?.id ?? null,
            },
          }) as object),
        } as Prisma.InputJsonValue,
      });
    } else {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: memberId,
        action: "HR_EMPLOYEE_PROFILE_UPDATED",
        message: "updated their employment record",
        metadata: { memberId } as Prisma.InputJsonValue,
      });
    }
  });

  return getEmployee(context, memberId);
}

/**
 * Changes employment status (PRD #16 §54, §55).
 *
 * Company access is deliberately untouched. Ending employment and removing
 * somebody's login are two decisions, taken by two modules, and a person whose
 * last day is next Friday still needs to sign in until then (PRD #16 §230).
 */
export async function changeEmploymentStatus(
  context: UserContext,
  memberId: string,
  input: EmploymentStatusInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.status.update");

  const existing = assertFound(await repository.findEmployeeByMember(context, memberId));
  const next = input.status as EmploymentStatus;

  if (existing.employmentStatus === next) {
    throw new AccessError("CONFLICT", `This record is already ${next.toLowerCase()}.`);
  }

  if (!canTransitionEmployment(existing.employmentStatus, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      existing.employmentStatus === "ENDED"
        ? "Ended employment is reopened by rehiring, which needs a new start date."
        : `Employment cannot move from ${existing.employmentStatus} to ${next}.`,
    );
  }

  if (next === "ENDED" && !input.endDate && !existing.endDate) {
    throw new AccessError("VALIDATION_ERROR", "An end date is required to end employment.");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.employeeProfile.updateMany({
      where: { id: existing.id, employmentStatus: existing.employmentStatus },
      data: {
        employmentStatus: next,
        ...(next === "ENDED"
          ? {
              endDate: input.endDate ? toBusinessDate(input.endDate) : existing.endDate,
              // Ending employment opens offboarding, rather than silently
              // leaving it "not required" (PRD #16 §124).
              offboardingStatus:
                existing.offboardingStatus === "NOT_REQUIRED"
                  ? "NOT_STARTED"
                  : existing.offboardingStatus,
            }
          : {}),
        updatedByMemberId: context.membershipId,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This record changed while you were working on it.");
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: memberId,
      action: `HR_EMPLOYMENT_${next}`,
      message: STATUS_MESSAGES[next],
      metadata: {
        memberId,
        ...(input.note ? { note: input.note } : {}),
        ...(changeMetadata({
          employmentStatus: { from: existing.employmentStatus, to: next },
        }) as object),
      } as Prisma.InputJsonValue,
    });

    // Employment status decides pay, leave and access downstream, so its
    // policy is `required` (PRD #28 §124, §136).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_EMPLOYMENT_STATUS_CHANGED,
        entity: {
          type: ENTITY,
          id: memberId,
          label: managerName(existing.companyMember),
        },
        before: { employmentStatus: existing.employmentStatus },
        after: { employmentStatus: next },
        reason: input.note ?? null,
      },
      { tx },
    );
  });
}

/**
 * Rehire (PRD #16 §56).
 *
 * Its own action rather than a transition, because it needs a new start date
 * and must clear the old end date — an "ENDED → ACTIVE" edit would leave a
 * record claiming somebody both left and is working.
 */
export async function rehireEmployee(
  context: UserContext,
  memberId: string,
  startDate: Date,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.employee.status.update");

  const existing = assertFound(await repository.findEmployeeByMember(context, memberId));

  if (existing.employmentStatus !== "ENDED") {
    throw new AccessError("CONFLICT", "Only ended employment can be reopened by a rehire.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { id: existing.id },
      data: {
        employmentStatus: "ACTIVE",
        startDate: toBusinessDate(startDate),
        endDate: null,
        onboardingStatus: "NOT_STARTED",
        offboardingStatus: "NOT_REQUIRED",
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: memberId,
      action: "HR_EMPLOYEE_REHIRED",
      message: `rehired them from ${businessDateString(toBusinessDate(startDate))}`,
      metadata: {
        memberId,
        previousEndDate: existing.endDate ? businessDateString(existing.endDate) : null,
      } as Prisma.InputJsonValue,
    });
  });
}

/** Onboarding and offboarding progress (PRD #16 §117, §121, §123). */
export async function setProgress(
  context: UserContext,
  memberId: string,
  kind: "onboarding" | "offboarding",
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "NOT_REQUIRED",
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(
    context,
    kind === "onboarding" ? "hr.onboarding.manage" : "hr.offboarding.manage",
  );

  const existing = assertFound(await repository.findEmployeeByMember(context, memberId));

  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({
      where: { id: existing.id },
      data: {
        ...(kind === "onboarding"
          ? { onboardingStatus: status }
          : { offboardingStatus: status }),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: memberId,
      action: kind === "onboarding" ? "HR_ONBOARDING_UPDATED" : "HR_OFFBOARDING_UPDATED",
      message:
        kind === "onboarding"
          ? `set onboarding to ${status.toLowerCase().replace("_", " ")}`
          : `set offboarding to ${status.toLowerCase().replace("_", " ")}`,
      metadata: { memberId, status } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

const STATUS_MESSAGES: Record<EmploymentStatus, string> = {
  PLANNED: "set their employment back to planned",
  ACTIVE: "marked their employment active",
  ON_LEAVE: "marked them on extended leave",
  SUSPENDED: "suspended their employment",
  ENDED: "recorded the end of their employment",
};

async function validateMember(context: UserContext, companyMemberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildHrMemberScopeWhere(context), { id: companyMemberId }] },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) throw new AccessError("VALIDATION_ERROR", "That team member does not exist.");
  return { id: member.id, name: `${member.user.firstName} ${member.user.lastName}` };
}

/**
 * A manager must be somebody else in this company (PRD #16 §32).
 *
 * Self-management is refused here and by a check constraint, because an
 * approval chain that loops back to the requester is not an approval chain.
 */
async function validateManager(
  context: UserContext,
  managerMemberId: string | undefined,
  subjectMemberId: string,
) {
  if (!managerMemberId) return null;

  if (managerMemberId === subjectMemberId) {
    throw new AccessError("VALIDATION_ERROR", "Somebody cannot be their own manager.");
  }

  const manager = await prisma.companyMember.findFirst({
    where: { companyId: context.companyId, id: managerMemberId, status: "ACTIVE" },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!manager) {
    throw new AccessError("VALIDATION_ERROR", "That manager is not an active team member.");
  }
  return manager;
}

function managerName(manager: {
  user: { firstName: string; lastName: string };
}): string {
  return `${manager.user.firstName} ${manager.user.lastName}`;
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  employeeNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.employeeProfile.findFirst({
    where: {
      companyId: context.companyId,
      employeeNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Employee number ${employeeNumber} is already used in this company.`,
    );
  }
}

/** Facts that make an action unavailable for a reason other than permission. */
async function employmentGuards(
  context: UserContext,
  profileId: string,
  memberId: string,
): Promise<EmployeeDetailDTO["guards"]> {
  const [openLeaveRequests, managedEmployees] = await Promise.all([
    prisma.leaveRequest.count({
      where: { employeeProfileId: profileId, status: { in: ["PENDING", "APPROVED"] } },
    }),
    prisma.employeeProfile.count({
      where: { companyId: context.companyId, managerMemberId: memberId },
    }),
  ]);

  return { openLeaveRequests, managedEmployees };
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

export function toSummaryDTO(row: repository.EmployeeRow): EmployeeSummaryDTO {
  return {
    id: row.id,
    memberId: row.companyMemberId,
    name: {
      firstName: row.companyMember.user.firstName,
      lastName: row.companyMember.user.lastName,
      fullName: `${row.companyMember.user.firstName} ${row.companyMember.user.lastName}`,
    },
    email: row.companyMember.user.email,
    avatarUrl: row.companyMember.user.avatarUrl,
    employeeNumber: row.employeeNumber,
    jobTitle: row.companyMember.jobTitle,
    department: row.companyMember.department,
    employmentStatus: row.employmentStatus,
    employmentType: row.employmentType,
    startDate: row.startDate ? businessDateString(row.startDate) : null,
    endDate: row.endDate ? businessDateString(row.endDate) : null,
    manager: row.managerMember
      ? { memberId: row.managerMember.id, fullName: managerName(row.managerMember) }
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.EmployeeDetailRow,
  guards: EmployeeDetailDTO["guards"],
): EmployeeDetailDTO {
  const own = isSelf(context, row.companyMemberId);
  const ended = row.employmentStatus === "ENDED";

  return {
    ...toSummaryDTO(row as unknown as repository.EmployeeRow),
    probationEndDate: row.probationEndDate ? businessDateString(row.probationEndDate) : null,
    workLocation: row.workLocation,
    weeklyHours: row.weeklyHours?.toString() ?? null,
    onboardingStatus: row.onboardingStatus,
    offboardingStatus: row.offboardingStatus,
    phone: row.companyMember.user.phone,
    role: row.companyMember.role,
    membershipStatus: row.companyMember.status,
    createdAt: row.createdAt.toISOString(),

    capabilities: {
      canEditEmployment: !ended && can(context, "hr.employment.update"),
      canChangeStatus: can(context, "hr.employee.status.update"),
      canAssignManager: can(context, "hr.employee.manager.assign"),
      // Pay is its own decision, and seeing your own is not implied either
      // (PRD #16 §67).
      canViewCompensation: can(context, "hr.compensation.view"),
      canEditCompensation: can(context, "hr.compensation.update"),
      canViewLeave:
        can(context, "hr.leave.view") || (own && can(context, "hr.self.leave")),
      canViewAttendance:
        can(context, "hr.attendance.view") || (own && can(context, "hr.self.attendance")),
      canViewDocuments:
        (can(context, "hr.document.view") || (own && can(context, "hr.self.documents"))) &&
        can(context, "document.view"),
      canViewActivity: can(context, "hr.activity.view"),
      canManageOnboarding: can(context, "hr.onboarding.manage"),
    },

    guards,
  };
}
