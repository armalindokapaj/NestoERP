import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { teamMemberWhere, timesheetsOpen } from "./timesheet.permissions";
import type { TimesheetPerson } from "./timesheet.types";
import { reassignOpenSteps } from "@/lib/core/approvals/approval-steps";

/**
 * Who decides a member's weeks (PRD #42 §72-§76, §233, §235-§237).
 *
 * One designated approver per member, set by whoever manages timesheet
 * settings; without one, the member's department manager. Resolved on the
 * server when a week is submitted, never taken from the browser. An approver
 * must be an active member of the same company who can approve timesheets, and
 * never the member themselves.
 */

const PERSON = { id: true, status: true, user: { select: { firstName: true, lastName: true } } } as const;

function person(row: { id: string; user: { firstName: string; lastName: string } }): TimesheetPerson {
  return { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` };
}

async function canApproveTimesheets(companyId: string, memberId: string): Promise<boolean> {
  const context = (await buildMemberContexts(companyId, [memberId])).get(memberId);
  return Boolean(context && timesheetsOpen(context) && can(context, "timesheet.approve"));
}

export type ResolvedApprover = TimesheetPerson & { source: "ASSIGNED" | "DEPARTMENT" };

export async function resolveApprover(companyId: string, memberId: string): Promise<ResolvedApprover | null> {
  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId },
    select: {
      timesheetApprover: { select: { approver: { select: PERSON } } },
      department: { select: { managerMember: { select: PERSON } } },
    },
  });
  if (!member) return null;
  const assigned = member.timesheetApprover?.approver;
  if (assigned && assigned.id !== memberId && assigned.status === "ACTIVE" && (await canApproveTimesheets(companyId, assigned.id))) {
    return { ...person(assigned), source: "ASSIGNED" };
  }
  const manager = member.department?.managerMember;
  if (manager && manager.id !== memberId && manager.status === "ACTIVE" && (await canApproveTimesheets(companyId, manager.id))) {
    return { ...person(manager), source: "DEPARTMENT" };
  }
  return null;
}

export type ApproverAssignmentDTO = {
  member: TimesheetPerson & { department: string | null; jobTitle: string | null };
  assigned: TimesheetPerson | null;
  effective: (TimesheetPerson & { source: "ASSIGNED" | "DEPARTMENT" }) | null;
};

/** Everybody whose approver this reader may see or set (§74). */
export async function listApproverAssignments(context: UserContext): Promise<ApproverAssignmentDTO[]> {
  assertModule(context, "timesheets");
  const managing = can(context, "timesheet.settings.manage");
  const team = teamMemberWhere(context);
  if (!managing && !team) throw new AccessError("FORBIDDEN");
  const members = await prisma.companyMember.findMany({
    where: { AND: [{ companyId: context.companyId, status: "ACTIVE" }, managing ? {} : team!] },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 500,
    select: {
      ...PERSON,
      jobTitle: true,
      department: { select: { name: true, managerMember: { select: PERSON } } },
      timesheetApprover: { select: { approver: { select: PERSON } } },
    },
  });
  // The same rule as resolveApprover, with every candidate's access built once (§271).
  const candidates = new Set<string>();
  for (const member of members) {
    if (member.timesheetApprover) candidates.add(member.timesheetApprover.approver.id);
    if (member.department?.managerMember) candidates.add(member.department.managerMember.id);
  }
  const contexts = await buildMemberContexts(context.companyId, [...candidates]);
  const approves = (row: { id: string; status: string }, memberId: string) => {
    const memberContext = contexts.get(row.id);
    return row.id !== memberId && row.status === "ACTIVE" && Boolean(memberContext && timesheetsOpen(memberContext) && can(memberContext, "timesheet.approve"));
  };
  return members.map((member) => {
    const assigned = member.timesheetApprover?.approver ?? null;
    const manager = member.department?.managerMember ?? null;
    const effective = assigned && approves(assigned, member.id) ? { ...person(assigned), source: "ASSIGNED" as const } : manager && approves(manager, member.id) ? { ...person(manager), source: "DEPARTMENT" as const } : null;
    return {
      member: { ...person(member), department: member.department?.name ?? null, jobTitle: member.jobTitle },
      assigned: assigned ? person(assigned) : null,
      effective,
    };
  });
}

/** Members who could be chosen as an approver. */
export async function approverOptions(context: UserContext): Promise<TimesheetPerson[]> {
  assertModule(context, "timesheets");
  assertPermission(context, "timesheet.settings.manage");
  const members = await prisma.companyMember.findMany({
    where: { companyId: context.companyId, status: "ACTIVE", user: { status: "ACTIVE" } },
    orderBy: [{ user: { firstName: "asc" } }],
    take: 500,
    select: PERSON,
  });
  const contexts = await buildMemberContexts(context.companyId, members.map((row) => row.id));
  return members.filter((row) => {
    const memberContext = contexts.get(row.id);
    return memberContext && timesheetsOpen(memberContext) && can(memberContext, "timesheet.approve");
  }).map(person);
}

/**
 * Sets or clears a member's designated approver (§74, §236, §237). A week the
 * member has already submitted moves to the new approver with them, audited,
 * and the new approver is told — it is never left with somebody who can no
 * longer decide it.
 */
export async function setApprover(context: UserContext, input: { memberId: string; approverMemberId: string | null }): Promise<ApproverAssignmentDTO["effective"]> {
  assertModule(context, "timesheets");
  assertPermission(context, "timesheet.settings.manage");

  const member = await prisma.companyMember.findFirst({ where: { id: input.memberId, companyId: context.companyId }, select: { id: true, timesheetApprover: { select: { approverMemberId: true } } } });
  if (!member) throw new AccessError("NOT_FOUND");
  if (input.approverMemberId) {
    if (input.approverMemberId === input.memberId) throw new AccessError("VALIDATION_ERROR", "Nobody approves their own timesheet.", { code: "TIMESHEET_SELF_APPROVAL_BLOCKED" });
    const approver = await prisma.companyMember.findFirst({ where: { id: input.approverMemberId, companyId: context.companyId, status: "ACTIVE" }, select: { id: true } });
    if (!approver || !(await canApproveTimesheets(context.companyId, approver.id))) {
      throw new AccessError("VALIDATION_ERROR", "That person cannot approve timesheets.", { code: "TIMESHEET_APPROVER_NOT_ALLOWED" });
    }
  }

  const before = member.timesheetApprover?.approverMemberId ?? null;
  await prisma.$transaction(async (tx) => {
    if (input.approverMemberId) {
      await tx.timesheetApproverAssignment.upsert({
        where: { memberId: input.memberId },
        create: { companyId: context.companyId, memberId: input.memberId, approverMemberId: input.approverMemberId, updatedByMemberId: context.membershipId },
        update: { approverMemberId: input.approverMemberId, updatedByMemberId: context.membershipId },
      });
    } else {
      await tx.timesheetApproverAssignment.deleteMany({ where: { memberId: input.memberId } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.TIMESHEET_APPROVER_CHANGED,
        entity: { type: "CompanyMember", id: input.memberId },
        before: { memberId: input.memberId, approverMemberId: before },
        after: { memberId: input.memberId, approverMemberId: input.approverMemberId },
      },
      { tx },
    );
  });

  // A week already waiting follows the member to whoever decides for them now.
  const effective = await resolveApprover(context.companyId, input.memberId);
  if (effective) {
    const waiting = await prisma.timesheet.findMany({ where: { companyId: context.companyId, memberId: input.memberId, status: "SUBMITTED", approverMemberId: { not: effective.memberId } }, select: { id: true, approverMemberId: true } });
    for (const week of waiting) {
      await prisma.$transaction(async (tx) => {
        await tx.timesheet.update({ where: { id: week.id }, data: { approverMemberId: effective.memberId, version: { increment: 1 } } });
        const cycles = await tx.timesheetApproval.findMany({ where: { companyId: context.companyId, recordId: week.id, status: "PENDING" }, select: { id: true } });
        for (const cycle of cycles) {
          await tx.timesheetApproval.update({ where: { id: cycle.id }, data: { approverMemberId: effective.memberId } });
          await reassignOpenSteps(tx, "timesheets", cycle.id, effective.memberId);
        }
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.APPROVAL_REASSIGNED,
            entity: { type: "timesheet", id: week.id },
            before: { from: week.approverMemberId },
            after: { approvalId: cycles[0]?.id ?? null, providerKey: "timesheets", sourceType: "timesheet", from: week.approverMemberId, to: effective.memberId },
          },
          { tx },
        );
        await enqueueNotificationEvent(tx, {
          companyId: context.companyId,
          eventType: NotificationEvent.TIMESHEET_APPROVAL_ASSIGNED,
          moduleKey: "timesheets",
          entityType: "timesheet",
          entityId: week.id,
          actorMemberId: context.membershipId,
          payload: { approverMemberId: effective.memberId, previousApproverMemberId: week.approverMemberId },
        });
      });
    }
  }
  return effective;
}
