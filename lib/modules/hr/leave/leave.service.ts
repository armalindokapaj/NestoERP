import { Prisma, type LeaveRequestStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { APPROVAL_CYCLE_REQUIRED, APPROVAL_SOURCE_CHANGED, requireDecisionNote } from "@/lib/core/approvals/approval-guard";
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
  companyId: true,
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
      // The employment's login now, which is whose request it is for self-service (E-04 §7).
      companyMemberId: true,
      startDate: true,
      endDate: true,
      personProfile: { select: { firstName: true, lastName: true, workEmail: true } },
      companyMember: { select: { user: { select: { email: true, avatarUrl: true } } } },
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
    filters.push({ employeeProfile: { companyMemberId: context.membershipId } });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { employeeProfile: { personProfile: { firstName: { contains: term, mode: "insensitive" } } } },
        { employeeProfile: { personProfile: { lastName: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.leaveType?.length) filters.push({ leaveType: { in: query.leaveType } });
  if (query.employeeId) filters.push({ employeeProfileId: query.employeeId });
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

  const deciders = await deciderNames(context.companyId, rows);
  return {
    data: rows.map((row) => toDTO(context, row, deciders)),
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
  if (!can(context, "hr.leave.view") && !isSelf(context, row.employeeProfile.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }

  return toDTO(context, row, await deciderNames(context.companyId, [row]));
}

/** An employee's balances for a year (PRD #16 §79). */
export async function getBalances(context: UserContext, employmentId: string | null, year: number) {
  assertModule(context, MODULE);

  if (!can(context, "hr.leave.balance.view") && !can(context, "hr.self.leave")) {
    assertPermission(context, "hr.leave.balance.view");
  }

  // No employment named: the reader's own.
  const profile = employmentId ? await requireProfile(context, employmentId) : await requireOwnProfile(context);
  if (!can(context, "hr.leave.balance.view") && !isSelf(context, profile.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }
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
  // self-service (PRD #16 §74, §191). Somebody with no login never files their
  // own: HR files it for them (E-04 §63).
  if (!can(context, "hr.leave.create") && !can(context, "hr.self.leave")) {
    assertPermission(context, "hr.self.leave");
  }
  const profile = input.employeeId ? await requireProfile(context, input.employeeId) : await requireOwnProfile(context);
  if (!isSelf(context, profile.companyMemberId)) assertPermission(context, "hr.leave.create");

  const startDate = toBusinessDate(input.startDate);
  const endDate = toBusinessDate(input.endDate);
  assertWithinEmployment(profile, startDate, endDate);
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
        companyMemberId: profile.companyMemberId,
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
        employmentId: profile.id,
        memberId: profile.companyMemberId,
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

  /*
   * The reason may be medical (PRD #16 §95). A reader who cannot see it is
   * shown no reason field, so their edit sends none and it stays as it was; a
   * reason they send anyway — a forged request — is refused, not written over
   * a reason they were never shown (AUD-09 §5, FV-10, FV-20).
   */
  if (input.reason !== undefined && !mayReadReason(context, existing)) {
    throw new AccessError("FORBIDDEN", "Only the requester and HR readers of leave reasons can change the reason.", { field: "reason", code: "LEAVE_REASON_NOT_VISIBLE" });
  }

  const startDate = toBusinessDate(input.startDate);
  const endDate = toBusinessDate(input.endDate);
  assertWithinEmployment(existing.employeeProfile, startDate, endDate);
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
      where: { id: leaveId, companyId: context.companyId },
      data: {
        leaveType: input.leaveType,
        startDate,
        endDate,
        days,
        // Absent (undefined): unchanged; null: cleared (AUD-09 §4, FV-05).
        reason: input.reason,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_UPDATED",
      message: `updated the request to ${days.toFixed(2)} days`,
      metadata: { employmentId: existing.employeeProfileId, memberId: existing.employeeProfile.companyMemberId } as Prisma.InputJsonValue,
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
      metadata: { employmentId: existing.employeeProfileId, memberId: existing.employeeProfile.companyMemberId } as Prisma.InputJsonValue,
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
  submission: LeaveSubmission | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.approve");
  const submittedAt = requireSubmission(submission);

  const existing = await requireLeave(context, leaveId);
  assertNotSelfApproval(context, existing);
  assertDecidable(existing, submittedAt);

  await prisma.$transaction(async (tx) => {
    // First, before anything is written: the submission decided is the one the
    // approver saw, read under the row lock (AUD-10 §4, A2).
    await lockSubmission(tx, existing, submittedAt);

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
      companyMemberId: existing.employeeProfile.companyMemberId,
      startDate: existing.startDate,
      endDate: existing.endDate,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: leaveId,
      action: "HR_LEAVE_APPROVED",
      message: `approved ${existing.days.toFixed(2)} days of leave`,
      metadata: { employmentId: existing.employeeProfileId, memberId: existing.employeeProfile.companyMemberId } as Prisma.InputJsonValue,
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
    // Somebody without a login has no inbox; HR told them in person (E-04 §68).
    if (existing.employeeProfile.companyMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.LEAVE_DECIDED,
        moduleKey: "hr",
        entityType: "leave_request",
        entityId: leaveId,
        actorMemberId: context.membershipId,
        payload: { memberId: existing.employeeProfile.companyMemberId, decision: "APPROVED" },
      });
    }
  });
}

export async function rejectLeave(
  context: UserContext,
  leaveId: string,
  note: string,
  submission: LeaveSubmission | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.reject");
  const submittedAt = requireSubmission(submission);
  // The reject dialog asks why; so does the service behind it (AUD-10 §4, A13).
  requireDecisionNote(note, "Say why the leave is being rejected.");

  const existing = await requireLeave(context, leaveId);
  assertNotSelfApproval(context, existing);
  assertDecidable(existing, submittedAt);

  await prisma.$transaction(async (tx) => {
    await lockSubmission(tx, existing, submittedAt);

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
      metadata: { employmentId: existing.employeeProfileId, memberId: existing.employeeProfile.companyMemberId, note } as Prisma.InputJsonValue,
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

    if (existing.employeeProfile.companyMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.LEAVE_DECIDED,
        moduleKey: "hr",
        entityType: "leave_request",
        entityId: leaveId,
        actorMemberId: context.membershipId,
        payload: { memberId: existing.employeeProfile.companyMemberId, decision: "REJECTED", reason: note },
      });
    }
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
  const own = isSelf(context, existing.employeeProfile.companyMemberId);

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
      metadata: { employmentId: existing.employeeProfileId, memberId: existing.employeeProfile.companyMemberId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Which submission a decision is on (AUD-10 §4, A2, CW-05)                     */
/* -------------------------------------------------------------------------- */

/**
 * The submission a leave decision was made on.
 *
 * HR keeps no cycle table: the request is its own approval, and each
 * submission stamps `submittedAt`. A PENDING request cannot be edited, so the
 * only way its content changes is rejected → edited → resubmitted, which
 * stamps a new `submittedAt`. Naming the stamp therefore names the cycle, and a
 * page opened before a reject/resubmit cannot approve the new dates (the ABA
 * the status alone could not see). The Approvals Center's version for a leave
 * item is this stamp in epoch milliseconds, so both surfaces pass the same
 * precondition.
 */
export type LeaveSubmission = { submittedAt?: Date | string | number | null };

/** Reads the stamp from what a page, route or the Center sent; anything unreadable is absent. */
export function leaveSubmissionFrom(value: unknown): LeaveSubmission | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : { submittedAt: value };
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? { submittedAt: new Date(value) } : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : { submittedAt: parsed };
  }
  return undefined;
}

/** The Center's version for a leave item: its submission stamp. */
export function leaveSubmissionVersion(submittedAt: Date): number {
  return submittedAt.getTime();
}

function requireSubmission(submission: LeaveSubmission | undefined): Date {
  const parsed = leaveSubmissionFrom(submission?.submittedAt);
  if (!parsed?.submittedAt) {
    throw new AccessError("PRECONDITION_REQUIRED", "This decision did not say which submission it was made on. Reload the page and decide the request you can see.", {
      code: APPROVAL_CYCLE_REQUIRED,
    });
  }
  return parsed.submittedAt as Date;
}

function sourceChanged(): AccessError {
  return new AccessError("CONFLICT", "This leave request was resubmitted since you opened it. Reload the page to review the latest version.", {
    code: APPROVAL_SOURCE_CHANGED,
  });
}

/** The early answer, from the read outside the transaction; `lockSubmission` is the guarantee. */
function assertDecidable(existing: LeaveRow, submittedAt: Date): void {
  if (existing.status === "PENDING" && existing.submittedAt?.getTime() !== submittedAt.getTime()) throw sourceChanged();
  if (existing.status !== "PENDING") {
    // Resubmitted and waiting again is a new cycle; anything else was decided or withdrawn.
    throw new AccessError("CONFLICT", "This request is not waiting for a decision.", { code: "APPROVAL_ALREADY_DECIDED" });
  }
}

/**
 * Locks the request and checks, inside the deciding transaction, that it is
 * still PENDING on the submission the approver saw. A concurrent decision
 * waits here and then finds it decided; a stale page finds a new stamp.
 */
async function lockSubmission(tx: Prisma.TransactionClient, existing: LeaveRow, submittedAt: Date): Promise<void> {
  const [row] = await tx.$queryRaw<Array<{ status: LeaveRequestStatus; submittedAt: Date | null }>>`
    SELECT status, "submittedAt" FROM leave_requests
    WHERE id = ${existing.id} AND "companyId" = ${existing.companyId}
    FOR UPDATE`;
  if (!row || row.status !== "PENDING") {
    throw new AccessError("CONFLICT", "This request has already been decided.", { code: "APPROVAL_ALREADY_DECIDED" });
  }
  if (row.submittedAt?.getTime() !== submittedAt.getTime()) throw sourceChanged();
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

  if (!can(context, "hr.leave.view") && !isSelf(context, row.employeeProfile.companyMemberId)) {
    throw new AccessError("NOT_FOUND");
  }

  return row;
}

/** An employment in this reader's HR scope, with or without a login (E-04 §7). */
async function requireProfile(context: UserContext, employmentId: string) {
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { id: employmentId }] },
      select: { id: true, companyMemberId: true, employmentStatus: true, startDate: true, endDate: true },
    }),
  );
}

/** The reader's own employment here, for self-service. */
async function requireOwnProfile(context: UserContext) {
  return assertFound(
    await prisma.employeeProfile.findFirst({
      where: { companyId: context.companyId, companyMemberId: context.membershipId },
      select: { id: true, companyMemberId: true, employmentStatus: true, startDate: true, endDate: true },
    }),
  );
}

/** Whether this reader is shown the request's reason (PRD #16 §95): the same rule as the DTO. */
function mayReadReason(context: UserContext, row: LeaveRow): boolean {
  return isSelf(context, row.employeeProfile.companyMemberId) || can(context, "hr.leave.reason.view");
}

/**
 * Leave is time off an employment, so it lies inside it (AUD-09 §4, FV-07):
 * not before the day it starts, not after a planned or actual last day. Said
 * on the field that is out of range. An employment without dates bounds
 * nothing.
 */
function assertWithinEmployment(employment: { startDate: Date | null; endDate: Date | null }, startDate: Date, endDate: Date): void {
  if (employment.startDate && startDate.getTime() < toBusinessDate(employment.startDate).getTime()) {
    throw new AccessError("VALIDATION_ERROR", `The employment starts on ${businessDateString(employment.startDate)}. Leave cannot begin before that.`, { field: "startDate", code: "LEAVE_OUTSIDE_EMPLOYMENT" });
  }
  if (employment.endDate && endDate.getTime() > toBusinessDate(employment.endDate).getTime()) {
    throw new AccessError("VALIDATION_ERROR", `The employment ends on ${businessDateString(employment.endDate)}. Leave cannot run past that.`, { field: "endDate", code: "LEAVE_OUTSIDE_EMPLOYMENT" });
  }
}

/** Editing somebody else's request needs the module grant (PRD #16 §192). */
function assertMayEdit(context: UserContext, row: LeaveRow): void {
  if (isSelf(context, row.employeeProfile.companyMemberId)) {
    if (can(context, "hr.self.leave") || can(context, "hr.leave.update")) return;
    assertPermission(context, "hr.self.leave");
    return;
  }
  assertPermission(context, "hr.leave.update");
}

/** Nobody decides their own request (PRD #16 §90, §194). */
function assertNotSelfApproval(context: UserContext, row: LeaveRow): void {
  if (!isSelf(context, row.employeeProfile.companyMemberId)) return;
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
    where: { id: existing.id, companyId: existing.companyId, status: existing.status },
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
    companyMemberId: request.employeeProfile.companyMemberId,
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

/** Who decided each request, by name, read inside the reader's company (E-08 §82). */
async function deciderNames(companyId: string, rows: LeaveRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.approvedByMemberId ?? row.rejectedByMemberId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const members = await prisma.companyMember.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return new Map(members.map((member) => [member.id, `${member.user.firstName} ${member.user.lastName}`]));
}

function toDTO(context: UserContext, row: LeaveRow, deciders: Map<string, string>): LeaveRequestDTO {
  const own = isSelf(context, row.employeeProfile.companyMemberId);
  const person = row.employeeProfile.personProfile;
  const user = row.employeeProfile.companyMember?.user ?? null;

  // The reason may be a medical detail, so it travels only to the requester
  // and to a reader who holds the grant (PRD #16 §95).
  const showReason = own || can(context, "hr.leave.reason.view");

  const decidedBy = row.approvedByMemberId ?? row.rejectedByMemberId ?? null;
  const decidedAt = row.approvedAt ?? row.rejectedAt ?? null;

  const mayEditOwn = own && can(context, "hr.self.leave");

  return {
    id: row.id,
    employee: {
      employeeId: row.employeeProfileId,
      memberId: row.employeeProfile.companyMemberId,
      fullName: `${person.firstName} ${person.lastName}`,
      email: person.workEmail ?? user?.email ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    },
    leaveType: row.leaveType,
    startDate: businessDateString(row.startDate),
    endDate: businessDateString(row.endDate),
    days: row.days.toFixed(2),
    ...(showReason ? { reason: row.reason } : {}),
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedBy,
    decidedByMemberId: decidedBy,
    decidedByName: decidedBy ? (deciders.get(decidedBy) ?? null) : null,
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
  employmentId: string,
  input: { leaveType: Prisma.LeaveBalanceCreateInput["leaveType"]; year: number; entitledDays: string; adjustmentDays: string },
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.balance.manage");

  // An entitlement is set for somebody, not by them: HR adding days to their
  // own balance is the self-approval the leave workflow already refuses
  // (PRD #16 §81, PRD #47 §98). Repairing a balance stays open — it only
  // recounts approved leave.
  const profile = await requireProfile(context, employmentId);
  if (isSelf(context, profile.companyMemberId)) {
    throw new AccessError("FORBIDDEN", "Your own leave entitlement is set by somebody else in HR.");
  }

  await prisma.$transaction(async (tx) => {
    const balance = await ensureBalance(tx, {
      companyId: context.companyId,
      employeeProfileId: profile.id,
      companyMemberId: profile.companyMemberId,
      leaveType: input.leaveType,
      year: input.year,
    });

    await tx.leaveBalance.update({
      where: { id: balance.id, companyId: context.companyId },
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
        employmentId: profile.id,
        memberId: profile.companyMemberId,
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
  employmentId: string,
  year: number,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hr.leave.balance.manage");

  const profile = await requireProfile(context, employmentId);
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
      metadata: { employmentId: profile.id, memberId: profile.companyMemberId, year } as Prisma.InputJsonValue,
    });
  });
}
