import { Prisma, type LeaveRequestStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import {
  businessDateString,
  calculateLeaveDays,
  leaveYearOf,
  toBusinessDate,
} from "../hr.date";
import { buildEmployeeScopeWhere, buildLeaveScopeWhere, isSelf } from "../hr.scope";
import {
  blocksOverlap,
  canTransitionLeave,
  isBalanceTracked,
  isLeaveEditable,
  isLeaveSubmittable,
} from "../hr.status";
import type { CreateLeaveInput, LeaveListQuery, UpdateLeaveInput } from "../hr.schema";
import type { LeaveRequestDTO } from "../hr.types";
import { adjustUsedDays, availableDays, ensureBalance, lockBalance } from "./leave.balance";
import { syncAttendanceForLeave, removeAttendanceForLeave } from "../attendance/attendance.sync";

/**
 * Leave (PRD #16 §69–§96).
 *
 * Four rules, all enforced here:
 *
 *   1. **No overlapping leave.** A person cannot hold two pending or approved
 *      requests covering the same day (PRD #16 §83).
 *   2. **Annual leave is capped by the balance**, checked again inside the
 *      approval transaction — the check at submission is a courtesy, the one at
 *      approval is the guarantee (PRD #16 §84, §196).
 *   3. **Nobody approves their own leave** (PRD #16 §90, §194).
 *   4. **The reason may be medical**, so it reaches only the requester and a
 *      reader holding `hr.leave.reason.view` (PRD #16 §95).
 */

const MODULE = "hr" as const;
const ENTITY = "LeaveRequest";

const SELECT = {
  id: true,
  employeeProfileId: true,
  companyMemberId: true,
  leaveType: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  status: true,
  submittedAt: true,
  approvedByMemberId: true,
  approvedAt: true,
  rejectedByMemberId: true,
  rejectedAt: true,
  cancelledByMemberId: true,
  cancelledAt: true,
  decisionNote: true,
  createdByMemberId: true,
  updatedAt: true,
  employeeProfile: {
    select: {
      id: true,
      companyMemberId: true,
      companyMember: {
        select: {
          id: true,
          departmentId: true,
          user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
        },
      },
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type LeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof SELECT }>;

const ORDER: Record<string, Prisma.LeaveRequestOrderByWithRelationInput[]> = {
  "start-desc": [{ startDate: "desc" }],
  "start-asc": [{ startDate: "asc" }],
  "created-desc": [{ createdAt: "desc" }],
  "days-desc": [{ days: "desc" }],
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listLeave(context: UserContext, query: LeaveListQuery) {
  assertModule(context, MODULE);

  const canSeeOthers = can(context, "hr.leave.view");
  if (!canSeeOthers) assertPermission(context, "hr.self.leave");

  const filters: Prisma.LeaveRequestWhereInput[] = [buildLeaveScopeWhere(context)];

  // Without the module grant, self-service means their own requests only —
  // whatever the scope resolver would otherwise allow (PRD #16 §16).
  if (!canSeeOthers || query.mine) {
    filters.push({ companyMemberId: context.membershipId });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        {
          employeeProfile: {
            companyMember: { user: { firstName: { contains: term, mode: "insensitive" } } },
          },
        },
        {
          employeeProfile: {
            companyMember: { user: { lastName: { contains: term, mode: "insensitive" } } },
          },
        },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.leaveType?.length) filters.push({ leaveType: { in: query.leaveType } });
  if (query.companyMemberId) filters.push({ companyMemberId: query.companyMemberId });
  // A date filter asks "was anybody off in this window", so it matches an
  // overlap rather than a containment.
  if (query.from) filters.push({ endDate: { gte: query.from } });
  if (query.to) filters.push({ startDate: { lte: query.to } });

  const where: Prisma.LeaveRequestWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.leaveRequest.findMany({
      where,
      orderBy: ORDER[query.sort] ?? ORDER["start-desc"],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SELECT,
    }),
    prisma.leaveRequest.count({ where }),
  ]);

  return {
    data: rows.map((row) => toDTO(context, row)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getLeave(
  context: UserContext,
  leaveId: string,
): Promise<LeaveRequestDTO> {
  assertModule(context, MODULE);

  const row = assertFound(
    await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: leaveId }] },
      select: SELECT,
    }),
  );

  // Scope alone is not enough: a department-scoped reader with no leave grant
  // still only reaches their own (PRD #16 §16).
  if (!can(context, "hr.leave.view") && !isSelf(context, row.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }

  return toDTO(context, row);
}

/** An employee's balances for a year (PRD #16 §79). */
export async function getBalances(context: UserContext, memberId: string, year: number) {
  assertModule(context, MODULE);

  const own = isSelf(context, memberId);
  if (!can(context, "hr.leave.balance.view") && !(own && can(context, "hr.self.leave"))) {
    assertPermission(context, "hr.leave.balance.view");
  }

  const profile = await requireProfile(context, memberId);
  const { balancesFor, toBalanceDTO } = await import("./leave.balance");
  const rows = await balancesFor(profile.id, year);
  return rows.map(toBalanceDTO);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createLeave(
  context: UserContext,
  input: CreateLeaveInput,
): Promise<LeaveRequestDTO> {
  assertModule(context, MODULE);

  // Filing for somebody else needs the module grant; filing your own needs only
  // self-service (PRD #16 §74, §191).
  const forSelf = !input.companyMemberId || isSelf(context, input.companyMemberId);
  if (forSelf) {
    if (!can(context, "hr.leave.create") && !can(context, "hr.self.leave")) {
      assertPermission(context, "hr.self.leave");
    }
  } else {
    assertPermission(context, "hr.leave.create");
  }

  const memberId = input.companyMemberId ?? context.membershipId;
  const profile = await requireProfile(context, memberId);

  const startDate = toBusinessDate(input.startDate);
  const endDate = toBusinessDate(input.endDate);
  const days = calculateLeaveDays(startDate, endDate);

  if (days.lessThanOrEqualTo(0)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That range contains no working days. V0.1 counts Monday to Friday.",
    );
  }

  const leaveId = await prisma.$transaction(async (tx) => {
    await assertNoOverlap(tx, profile.id, startDate, endDate, null);

    const request = await tx.leaveRequest.create({
      data: {
        companyId: context.companyId,
        employeeProfileId: profile.id,
        companyMemberId: memberId,
        leaveType: input.leaveType,
        startDate,
        endDate,
        days,
        reason: input.reason ?? null,
        status: "DRAFT",
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: request.id,
      action: "HR_LEAVE_CREATED",
      // No reason in the message: it may be medical (PRD #16 §95, §269).
      message: `drafted ${days.toFixed(2)} days of ${input.leaveType.toLowerCase()} leave`,
      metadata: {
        memberId,
        leaveType: input.leaveType,
        startDate: businessDateString(startDate),
        endDate: businessDateString(endDate),
      } as Prisma.InputJsonValue,
    });

    return request.id;
  });

  return getLeave(context, leaveId);
}

export async function updateLeave(
  context: UserContext,
  leaveId: string,
  input: UpdateLeaveInput,
): Promise<LeaveRequestDTO> {
  assertModule(context, MODULE);

  const existing = await requireLeave(context, leaveId);
  assertMayEdit(context, existing);

  if (!isLeaveEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only a draft or rejected request can be edited. Cancel it and file a new one instead.",
    );
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This request was updated by another user. Refresh and review the latest changes.",
    );
  }

  const startDate = toBusinessDate(input.startDate);
  const endDate = toBusinessDate(input.endDate);
  const days = calculateLeaveDays(startDate, endDate);

  if (days.lessThanOrEqualTo(0)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That range contains no working days. V0.1 counts Monday to Friday.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await assertNoOverlap(tx, existing.employeeProfileId, startDate, endDate, leaveId);

    await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        leaveType: input.leaveType,
        startDate,
        endDate,
        days,
        reason: input.reason ?? null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_UPDATED",
      message: `updated the request to ${days.toFixed(2)} days`,
      metadata: { memberId: existing.companyMemberId } as Prisma.InputJsonValue,
    });
  });

  return getLeave(context, leaveId);
}

export async function submitLeave(context: UserContext, leaveId: string): Promise<void> {
  assertModule(context, MODULE);

  const existing = await requireLeave(context, leaveId);
  assertMayEdit(context, existing);

  if (!isLeaveSubmittable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      `A ${existing.status.toLowerCase()} request cannot be submitted.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await assertNoOverlap(
      tx,
      existing.employeeProfileId,
      existing.startDate,
      existing.endDate,
      leaveId,
    );
    // Checked here as a courtesy so the problem is found before an approver
    // looks at it; checked again at approval, which is the guarantee.
    await assertSufficientBalance(tx, context, existing);

    await moveStatus(tx, existing, "PENDING", {
      submittedAt: new Date(),
      // A resubmission clears the previous decision, so the record does not
      // read as both pending and rejected.
      rejectedByMemberId: null,
      rejectedAt: null,
      decisionNote: null,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_SUBMITTED",
      message: "submitted a leave request for approval",
      metadata: { memberId: existing.companyMemberId } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Approves leave (PRD #16 §87, §91).
 *
 * The whole transaction: re-validate, draw down the balance, write the
 * `ON_LEAVE` attendance days, record the decision. Anything less and a balance
 * can be spent twice by two approvers pressing at the same moment.
 */
export async function approveLeave(
  context: UserContext,
  leaveId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.approve");

  const existing = await requireLeave(context, leaveId);
  assertNotSelfApproval(context, existing);

  if (existing.status !== "PENDING") {
    throw new AccessError("CONFLICT", "This request is not waiting for a decision.");
  }

  await prisma.$transaction(async (tx) => {
    await assertNoOverlap(
      tx,
      existing.employeeProfileId,
      existing.startDate,
      existing.endDate,
      leaveId,
    );

    const balance = await assertSufficientBalance(tx, context, existing);

    await moveStatus(tx, existing, "APPROVED", {
      approvedByMemberId: context.membershipId,
      approvedAt: new Date(),
      decisionNote: note,
    });

    if (balance) await adjustUsedDays(tx, balance.id, existing.days);

    // Approved leave writes the days it covers into attendance, so the two
    // never disagree about who was in (PRD #16 §108).
    await syncAttendanceForLeave(tx, context, {
      leaveRequestId: leaveId,
      employeeProfileId: existing.employeeProfileId,
      companyMemberId: existing.companyMemberId,
      startDate: existing.startDate,
      endDate: existing.endDate,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_APPROVED",
      message: `approved ${existing.days.toFixed(2)} days of leave`,
      metadata: { memberId: existing.companyMemberId } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_LEAVE_REQUEST_APPROVED,
        entity: { type: ENTITY, id: leaveId },
        before: { status: existing.status },
        after: {
          status: "APPROVED",
          startDate: businessDateString(existing.startDate),
          endDate: businessDateString(existing.endDate),
        },
      },
      { tx },
    );

    // The person who asked is the person waiting for the answer (PRD #25 §33).
    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.LEAVE_DECIDED,
      moduleKey: "hr",
      entityType: "leave_request",
      entityId: leaveId,
      actorMemberId: context.membershipId,
      payload: { memberId: existing.companyMemberId, decision: "APPROVED" },
    });
  });
}

export async function rejectLeave(
  context: UserContext,
  leaveId: string,
  note: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.reject");

  const existing = await requireLeave(context, leaveId);
  assertNotSelfApproval(context, existing);

  if (existing.status !== "PENDING") {
    throw new AccessError("CONFLICT", "This request is not waiting for a decision.");
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, existing, "REJECTED", {
      rejectedByMemberId: context.membershipId,
      rejectedAt: new Date(),
      decisionNote: note,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_REJECTED",
      message: "rejected a leave request",
      metadata: { memberId: existing.companyMemberId, note } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.HR_LEAVE_REQUEST_REJECTED,
        entity: { type: ENTITY, id: leaveId },
        before: { status: existing.status },
        after: { status: "REJECTED" },
        reason: note,
      },
      { tx },
    );

    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.LEAVE_DECIDED,
      moduleKey: "hr",
      entityType: "leave_request",
      entityId: leaveId,
      actorMemberId: context.membershipId,
      payload: { memberId: existing.companyMemberId, decision: "REJECTED", reason: note },
    });
  });
}

/**
 * Cancels leave (PRD #16 §89, §93).
 *
 * A person may withdraw their own draft or pending request. Cancelling
 * *approved* leave gives days back and removes the attendance it wrote, so it
 * needs the grant — otherwise a balance could be refilled at will.
 */
export async function cancelLeave(context: UserContext, leaveId: string): Promise<void> {
  assertModule(context, MODULE);

  const existing = await requireLeave(context, leaveId);
  const own = isSelf(context, existing.companyMemberId);

  if (existing.status === "APPROVED") {
    assertPermission(context, "hr.leave.cancel");
  } else if (!can(context, "hr.leave.cancel") && !(own && can(context, "hr.self.leave"))) {
    assertPermission(context, "hr.leave.cancel");
  }

  if (!canTransitionLeave(existing.status, "CANCELLED")) {
    throw new AccessError(
      "CONFLICT",
      `A ${existing.status.toLowerCase()} request cannot be cancelled.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const wasApproved = existing.status === "APPROVED";

    await moveStatus(tx, existing, "CANCELLED", {
      cancelledByMemberId: context.membershipId,
      cancelledAt: new Date(),
    });

    if (wasApproved) {
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeProfileId_leaveType_year: {
            employeeProfileId: existing.employeeProfileId,
            leaveType: existing.leaveType,
            year: leaveYearOf(existing.startDate),
          },
        },
        select: { id: true },
      });

      if (balance) await adjustUsedDays(tx, balance.id, existing.days.negated());

      // Exactly the rows this request wrote, identified by source — a day
      // somebody entered by hand is left alone (PRD #16 §109, §110).
      await removeAttendanceForLeave(tx, leaveId);
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_CANCELLED",
      message: wasApproved
        ? `cancelled approved leave, returning ${existing.days.toFixed(2)} days`
        : "cancelled a leave request",
      metadata: { memberId: existing.companyMemberId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireLeave(context: UserContext, leaveId: string): Promise<LeaveRow> {
  const row = assertFound(
    await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: leaveId }] },
      select: SELECT,
    }),
  );

  if (!can(context, "hr.leave.view") && !isSelf(context, row.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }

  return row;
}

async function requireProfile(context: UserContext, memberId: string) {
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: memberId }] },
      select: { id: true, companyMemberId: true, employmentStatus: true },
    }),
  );
}

/** Editing somebody else's request needs the module grant (PRD #16 §192). */
function assertMayEdit(context: UserContext, row: LeaveRow): void {
  if (isSelf(context, row.companyMemberId)) {
    if (can(context, "hr.self.leave") || can(context, "hr.leave.update")) return;
    assertPermission(context, "hr.self.leave");
    return;
  }
  assertPermission(context, "hr.leave.update");
}

/** Nobody decides their own request (PRD #16 §90, §194). */
function assertNotSelfApproval(context: UserContext, row: LeaveRow): void {
  if (!isSelf(context, row.companyMemberId)) return;
  throw new AccessError(
    "FORBIDDEN",
    "This is your own leave, so somebody else has to decide it.",
  );
}

async function moveStatus(
  tx: Prisma.TransactionClient,
  existing: LeaveRow,
  next: LeaveRequestStatus,
  extra: Prisma.LeaveRequestUpdateInput = {},
): Promise<void> {
  if (!canTransitionLeave(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A leave request cannot move from ${existing.status} to ${next}.`,
    );
  }

  // Conditional on the status we read, so two people acting at once cannot both
  // win (PRD #16 §265).
  const result = await tx.leaveRequest.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: next, ...extra },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This request changed while you were working on it.");
  }
}

/** No two pending or approved requests may cover the same day (PRD #16 §83). */
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  employeeProfileId: string,
  startDate: Date,
  endDate: Date,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.leaveRequest.findFirst({
    where: {
      employeeProfileId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { startDate: true, endDate: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Leave is already booked from ${businessDateString(clash.startDate)} to ${businessDateString(clash.endDate)}.`,
    );
  }
}

/**
 * Annual leave is capped by the balance; other types are not (PRD #16 §84, §85).
 *
 * Refusing a sick day because a counter ran out would be worse than not
 * counting it, and company policies vary too much for V0.1 to guess.
 */
async function assertSufficientBalance(
  tx: Prisma.TransactionClient,
  context: UserContext,
  request: LeaveRow,
) {
  if (!isBalanceTracked(request.leaveType)) return null;

  const created = await ensureBalance(tx, {
    companyId: context.companyId,
    employeeProfileId: request.employeeProfileId,
    companyMemberId: request.companyMemberId,
    leaveType: request.leaveType,
    year: leaveYearOf(request.startDate),
  });

  // Lock first, then read: checking a figure another transaction is about to
  // change is the same as not checking it (PRD #16 §196).
  await lockBalance(tx, created.id);
  const balance = await tx.leaveBalance.findUniqueOrThrow({ where: { id: created.id } });

  const available = availableDays(balance);
  if (request.days.greaterThan(available)) {
    throw new AccessError(
      "CONFLICT",
      `That is ${request.days.toFixed(2)} days, and only ${available.toFixed(2)} remain for ${leaveYearOf(request.startDate)}.`,
    );
  }

  return balance;
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function toDTO(context: UserContext, row: LeaveRow): LeaveRequestDTO {
  const own = isSelf(context, row.companyMemberId);
  const user = row.employeeProfile.companyMember.user;

  // The reason may be a medical detail, so it travels only to the requester
  // and to a reader who holds the grant (PRD #16 §95).
  const showReason = own || can(context, "hr.leave.reason.view");

  const decidedBy = row.approvedByMemberId ?? row.rejectedByMemberId ?? null;
  const decidedAt = row.approvedAt ?? row.rejectedAt ?? null;

  const mayEditOwn = own && can(context, "hr.self.leave");

  return {
    id: row.id,
    employee: {
      memberId: row.companyMemberId,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    leaveType: row.leaveType,
    startDate: businessDateString(row.startDate),
    endDate: businessDateString(row.endDate),
    days: row.days.toFixed(2),
    ...(showReason ? { reason: row.reason } : {}),
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedBy,
    decidedAt: decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    updatedAt: row.updatedAt.toISOString(),

    capabilities: {
      canEdit: isLeaveEditable(row.status) && (mayEditOwn || can(context, "hr.leave.update")),
      canSubmit:
        isLeaveSubmittable(row.status) &&
        (mayEditOwn || can(context, "hr.leave.submit") || can(context, "hr.leave.update")),
      // Never on your own request, whatever grants you hold (PRD #16 §194).
      canApprove: row.status === "PENDING" && !own && can(context, "hr.leave.approve"),
      canReject: row.status === "PENDING" && !own && can(context, "hr.leave.reject"),
      canCancel:
        canTransitionLeave(row.status, "CANCELLED") &&
        (row.status === "APPROVED"
          ? can(context, "hr.leave.cancel")
          : mayEditOwn || can(context, "hr.leave.cancel")),
      canViewDocuments:
        (can(context, "hr.document.view") || (own && can(context, "hr.self.documents"))) &&
        can(context, "document.view"),
    },
  };
}

export { blocksOverlap };

/**
 * Sets an employee's entitlement for a year (PRD #16 §81, §217).
 *
 * `usedDays` is deliberately not settable: it is maintained from approved leave
 * and nothing else, so a balance can never be made to disagree with the
 * requests behind it (PRD #16 §218).
 */
export async function setLeaveBalance(
  context: UserContext,
  memberId: string,
  input: { leaveType: Prisma.LeaveBalanceCreateInput["leaveType"]; year: number; entitledDays: string; adjustmentDays: string },
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.balance.manage");

  // An entitlement is set for somebody, not by them: HR adding days to their
  // own balance is the self-approval the leave workflow already refuses
  // (PRD #16 §81, PRD #47 §98). Repairing a balance stays open — it only
  // recounts approved leave.
  if (memberId === context.membershipId) {
    throw new AccessError("FORBIDDEN", "Your own leave entitlement is set by somebody else in HR.");
  }

  const profile = await requireProfile(context, memberId);

  await prisma.$transaction(async (tx) => {
    const balance = await ensureBalance(tx, {
      companyId: context.companyId,
      employeeProfileId: profile.id,
      companyMemberId: memberId,
      leaveType: input.leaveType,
      year: input.year,
    });

    await tx.leaveBalance.update({
      where: { id: balance.id },
      data: {
        entitledDays: input.entitledDays,
        adjustmentDays: input.adjustmentDays,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "LeaveBalance",
      entityId: balance.id,
      action: "HR_LEAVE_BALANCE_SET",
      message: `set ${input.leaveType.toLowerCase()} leave to ${input.entitledDays} days for ${input.year}`,
      metadata: {
        memberId,
        leaveType: input.leaveType,
        year: input.year,
      } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Recomputes `usedDays` from approved leave (PRD #16 §219).
 *
 * A repair, not part of the ordinary flow: the number is maintained
 * transactionally, and this exists so a balance that has somehow drifted can be
 * put right without editing it by hand.
 */
export async function repairLeaveBalance(
  context: UserContext,
  memberId: string,
  year: number,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.balance.manage");

  const profile = await requireProfile(context, memberId);
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

  await prisma.$transaction(async (tx) => {
    const grouped = await tx.leaveRequest.groupBy({
      by: ["leaveType"],
      where: {
        employeeProfileId: profile.id,
        status: "APPROVED",
        startDate: { gte: from, lte: to },
      },
      _sum: { days: true },
    });

    const balances = await tx.leaveBalance.findMany({
      where: { employeeProfileId: profile.id, year },
      select: { id: true, leaveType: true },
    });

    for (const balance of balances) {
      const used =
        grouped.find((row) => row.leaveType === balance.leaveType)?._sum.days ??
        new Prisma.Decimal(0);
      await tx.leaveBalance.update({ where: { id: balance.id }, data: { usedDays: used } });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "LeaveBalance",
      entityId: profile.id,
      action: "HR_LEAVE_BALANCE_REPAIRED",
      message: `recalculated leave balances for ${year}`,
      metadata: { memberId, year } as Prisma.InputJsonValue,
    });
  });
}
