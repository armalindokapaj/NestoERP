import type { LeaveRequestStatus, Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { approveLeave, rejectLeave } from "@/lib/modules/hr/leave/leave.service";
import { buildLeaveScopeWhere } from "@/lib/modules/hr/hr.scope";
import { leaveTypeLabels } from "@/lib/modules/hr/hr.status";
import { approvalDocuments } from "../approvals.documents";
import {
  approvalError,
  dateRange,
  keysetWhere,
  memberNames,
  notFound,
  personOrUnknown,
  translateSourceError,
  type ApprovalProvider,
  type ProviderDetail,
  type ProviderItem,
  type ProviderQuery,
} from "../approvals.provider";
import type { UnifiedApprovalHistoryEntry, UnifiedApprovalStatus } from "../approvals.types";
import { WINDOW } from "../approvals.cycle-provider";
import { excludesAmountFilter, formatDate, startOfToday } from "./shared";

/**
 * HR leave approvals in the Center (PRD #41 §68, §69, §138, §181, §263).
 *
 * The leave request is its own approval: HR keeps no separate cycle table, so
 * each submission is counted from HR's own activity trail, and that count is
 * the version a decision is checked against — a request rejected and sent
 * again is a new submission, never a stale approval of the old one.
 *
 * Privacy first: what an approver sees is who, which kind of leave, which
 * days and how many — never the reason unless `hr.leave.reason.view` allows
 * it, never a balance unless `hr.leave.balance.view` does, and supporting
 * files only through HR's document grant. Leave is decided before it starts,
 * so its first day is the due date.
 *
 * Queries (§250), each inside HR's leave scope:
 *   waiting    status = PENDING, not my own                        [companyId, status]
 *   requested  companyMemberId = me, submitted                     [companyMemberId]
 *   decided    approvedByMemberId / rejectedByMemberId = me        (leave_requests scan within scope)
 *   history    submitted, in scope, with approvals.history.view    [companyId, status]
 */

const KEY = "hr" as const;
const DAY = 86_400_000;

const SELECT = {
  id: true,
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
  cancelledAt: true,
  decisionNote: true,
  employeeProfileId: true,
  employeeProfile: { select: { personProfile: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.LeaveRequestSelect;

type LeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof SELECT }>;

const STATUS: Record<LeaveRequestStatus, UnifiedApprovalStatus | null> = {
  DRAFT: null,
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
};

function mayDecide(context: UserContext): boolean {
  return can(context, "hr.leave.approve") || can(context, "hr.leave.reject");
}

async function submissionCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.activity.groupBy({
    by: ["entityId"],
    where: { entityType: "LeaveRequest", entityId: { in: ids }, action: "HR_LEAVE_SUBMITTED" },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.entityId, row._count._all]));
}

async function buildItems(context: UserContext, entries: Array<{ row: LeaveRow; sortAt: Date }>): Promise<ProviderItem[]> {
  const rows = entries.map((entry) => entry.row);
  const [names, versions] = await Promise.all([
    memberNames(context.companyId, rows.flatMap((row) => [row.companyMemberId, row.approvedByMemberId, row.rejectedByMemberId])),
    submissionCounts(rows.map((row) => row.id)),
  ]);
  const today = startOfToday();
  return entries.flatMap(({ row, sortAt }) => {
    const status = STATUS[row.status];
    if (!status || !row.submittedAt) return [];
    // HR records leave for employees with no login too (E-04 §5): they are named from the person.
    const person = row.companyMemberId
      ? personOrUnknown(names, row.companyMemberId)
      : { memberId: "", name: `${row.employeeProfile.personProfile.firstName} ${row.employeeProfile.personProfile.lastName}` };
    const pending = status === "PENDING";
    const own = row.companyMemberId === context.membershipId;
    const startsSoon = row.startDate.getTime() - today.getTime() <= 2 * DAY;
    const decidedBy = row.approvedByMemberId ?? row.rejectedByMemberId;
    return [
      {
        id: `${KEY}:${row.id}`,
        providerKey: KEY,
        sourceType: "leave_request",
        sourceId: row.id,
        approvalId: row.id,
        sourceLabel: "Leave request",
        title: `${person.name} — ${leaveTypeLabels[row.leaveType]}`,
        subtitle: `${formatDate(row.startDate)} – ${formatDate(row.endDate)} · ${row.days.toFixed(1)} days`,
        reference: null,
        status,
        priority: pending && startsSoon ? "HIGH" : "NORMAL",
        amount: null,
        project: null,
        requester: person,
        requestedAt: row.submittedAt.toISOString(),
        dueAt: pending ? row.startDate.toISOString() : null,
        decidedAt: (row.approvedAt ?? row.rejectedAt ?? row.cancelledAt)?.toISOString() ?? null,
        decidedBy: decidedBy ? personOrUnknown(names, decidedBy) : null,
        currentStep: null,
        totalSteps: null,
        stepLabel: null,
        href: `/hr/leave/${row.id}`,
        canApprove: pending && !own && can(context, "hr.leave.approve"),
        canReject: pending && !own && can(context, "hr.leave.reject"),
        canReturn: false,
        requiresStrongConfirmation: false,
        blockedReason: pending ? (own ? "This is your own leave, so somebody else decides it." : mayDecide(context) ? null : "Waiting for an approver.") : null,
        onBehalfOf: null,
        version: Math.max(1, versions.get(row.id) ?? 1),
        sortAt: sortAt.toISOString(),
      },
    ];
  });
}

async function collect(context: UserContext, query: ProviderQuery, base: Prisma.LeaveRequestWhereInput[], dateField: "submittedAt" | "approvedAt" | "rejectedAt") {
  const keyset = query.tab === "waiting" ? null : keysetWhere(dateField, KEY, query);
  const rows = await prisma.leaveRequest.findMany({
    where: { AND: [buildLeaveScopeWhere(context), ...base, ...(keyset ? [keyset as Prisma.LeaveRequestWhereInput] : [])] },
    orderBy: [{ [dateField]: query.order }, { id: query.order }],
    take: query.tab === "waiting" ? WINDOW : query.limit,
    select: SELECT,
  });
  return rows.map((row) => ({ row, sortAt: (row[dateField] ?? row.submittedAt ?? new Date(0)) as Date }));
}

export const hrApprovalProvider: ApprovalProvider = {
  key: KEY,
  moduleKey: "hr",
  label: "HR",
  recordTypes: ["leave_request"],

  available: (context) => isModuleEnabled(context, "hr") && canAccessModule(context, "hr"),

  async queue(context, query) {
    // Leave has no project and no amount: those filters match none of it.
    if (query.projectId || excludesAmountFilter(query)) return [];
    const me = context.membershipId;
    const base: Prisma.LeaveRequestWhereInput[] = [{ submittedAt: { not: null } }];
    if (query.requesterId) base.push({ companyMemberId: query.requesterId });
    if (query.q) {
      base.push({ employeeProfile: { companyMember: { user: { OR: [{ firstName: { contains: query.q, mode: "insensitive" } }, { lastName: { contains: query.q, mode: "insensitive" } }] } } } });
    }
    const statuses = query.statuses.filter((status) => ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) as LeaveRequestStatus[];
    const range = dateRange(query);

    switch (query.tab) {
      case "waiting": {
        if (!mayDecide(context)) return [];
        base.push({ status: "PENDING", companyMemberId: { not: me } });
        if (range) base.push({ submittedAt: range });
        return buildItems(context, await collect(context, query, base, "submittedAt"));
      }
      case "requested": {
        base.push({ companyMemberId: me });
        if (statuses.length) base.push({ status: { in: statuses } });
        if (range) base.push({ submittedAt: range });
        return buildItems(context, await collect(context, query, base, "submittedAt"));
      }
      case "approved": {
        base.push({ approvedByMemberId: me, status: "APPROVED" });
        if (range) base.push({ approvedAt: range });
        return buildItems(context, await collect(context, query, base, "approvedAt"));
      }
      case "rejected": {
        base.push({ rejectedByMemberId: me, status: "REJECTED" });
        if (range) base.push({ rejectedAt: range });
        return buildItems(context, await collect(context, query, base, "rejectedAt"));
      }
      case "returned":
        // HR does not return leave for revision; a request is rejected or withdrawn.
        return [];
      case "history": {
        if (!can(context, "approvals.history.view") || !can(context, "hr.leave.view")) return [];
        if (statuses.length) base.push({ status: { in: statuses } });
        if (range) base.push({ submittedAt: range });
        return buildItems(context, await collect(context, query, base, "submittedAt"));
      }
    }
  },

  async detail(context, approvalId): Promise<ProviderDetail | null> {
    const row = await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: approvalId, companyId: context.companyId, submittedAt: { not: null } }] },
      select: SELECT,
    });
    if (!row) return null;
    const own = row.companyMemberId === context.membershipId;
    const decidedByMe = row.approvedByMemberId === context.membershipId || row.rejectedByMemberId === context.membershipId;
    if (!own && !decidedByMe && !can(context, "hr.leave.view") && !mayDecide(context)) return null;

    const [item] = await buildItems(context, [{ row, sortAt: row.submittedAt! }]);
    if (!item) return null;

    const showReason = own || can(context, "hr.leave.reason.view");
    const year = row.startDate.getUTCFullYear();
    const balance = can(context, "hr.leave.balance.view")
      ? await prisma.leaveBalance.findFirst({
          where: { companyId: context.companyId, employeeProfileId: row.employeeProfileId, leaveType: row.leaveType, year },
          select: { entitledDays: true, usedDays: true, adjustmentDays: true },
        })
      : null;
    const remaining = balance ? balance.entitledDays.plus(balance.adjustmentDays).minus(balance.usedDays) : null;

    const activity = await prisma.activity.findMany({
      where: { companyId: context.companyId, entityType: "LeaveRequest", entityId: row.id, action: { in: ["HR_LEAVE_SUBMITTED", "HR_LEAVE_APPROVED", "HR_LEAVE_REJECTED", "HR_LEAVE_CANCELLED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, createdAt: true, actorMemberId: true },
      take: 50,
    });
    const names = await memberNames(context.companyId, activity.map((entry) => entry.actorMemberId));
    let submissions = 0;
    const history: UnifiedApprovalHistoryEntry[] = activity.map((entry) => {
      const actor = entry.actorMemberId ? personOrUnknown(names, entry.actorMemberId) : null;
      const base = { id: entry.id, actorName: actor?.name ?? null, actorRole: null, actor, onBehalfOf: null, occurredAt: entry.createdAt.toISOString(), note: null, step: null };
      if (entry.action === "HR_LEAVE_SUBMITTED") {
        submissions += 1;
        return { ...base, action: submissions === 1 ? "Requested" : "Resubmitted", tone: "info" as const };
      }
      if (entry.action === "HR_LEAVE_APPROVED") return { ...base, action: "Approved", tone: "success" as const };
      if (entry.action === "HR_LEAVE_REJECTED") return { ...base, action: "Rejected", tone: "danger" as const, note: showReason || own ? row.decisionNote : null };
      return { ...base, action: "Withdrawn", tone: "neutral" as const };
    });
    if (row.status === "PENDING") {
      history.push({ id: `${row.id}:pending`, action: "Awaiting decision", actorName: null, actorRole: null, actor: null, onBehalfOf: null, occurredAt: row.submittedAt!.toISOString(), note: null, step: null, tone: "neutral" });
    }

    const warnings = [];
    if (row.status === "PENDING" && row.startDate < startOfToday()) {
      warnings.push({ code: "LEAVE_STARTED", message: `This leave began ${formatDate(row.startDate)} without a decision.`, severity: "WARNING" as const });
    }
    if (remaining && remaining.lt(row.days) && row.leaveType === "ANNUAL") {
      warnings.push({ code: "INSUFFICIENT_BALANCE", message: `Only ${remaining.toFixed(1)} days of this leave remain for ${year}.`, severity: "WARNING" as const });
    }
    if (own && row.status === "PENDING") warnings.push({ code: "SELF_APPROVAL_BLOCKED", message: "This is your own leave, so somebody else decides it.", severity: "INFO" as const });

    const documents = await approvalDocuments(context, "leave_request", row.id);
    return {
      item,
      reason: "Leave is approved before it starts, so the team and the attendance record agree on who is in.",
      summary: [
        { label: "Employee", value: item.requester.name, person: row.companyMemberId ? { memberId: row.companyMemberId } : { employeeId: row.employeeProfileId } },
        { label: "Leave type", value: leaveTypeLabels[row.leaveType] },
        { label: "From", value: formatDate(row.startDate) },
        { label: "To", value: formatDate(row.endDate) },
        { label: "Days", value: row.days.toFixed(1), emphasis: "strong" },
        ...(remaining ? [{ label: `Remaining ${year}`, value: `${remaining.toFixed(1)} days` }] : []),
      ],
      description: showReason ? row.reason : null,
      warnings,
      documents: documents.documents,
      documentsAvailable: documents.available,
      history,
      chainMode: "SINGLE",
      completionRule: null,
      steps: [],
      // Leave requests carry no discussion: what is said about somebody's absence stays in HR.
      commentsEnabled: false,
      discussion: null,
      sourceRecord: { label: "Open full leave request", href: `/hr/leave/${row.id}` },
    };
  },

  async findByRecord(context, recordType, recordId) {
    if (recordType !== "leave_request") return null;
    const row = await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: recordId, submittedAt: { not: null } }] },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  async decide(context, approvalId, decision, input) {
    const row = await prisma.leaveRequest.findFirst({
      where: { AND: [buildLeaveScopeWhere(context), { id: approvalId, companyId: context.companyId }] },
      select: SELECT,
    });
    if (!row || !row.submittedAt) throw notFound();
    if (decision === "RETURN") throw approvalError("APPROVAL_RETURN_NOT_SUPPORTED", "Leave is approved or rejected; it is not returned for revision.", "VALIDATION_ERROR");
    const wanted = decision === "APPROVE" ? "APPROVED" : "REJECTED";

    if (row.status !== "PENDING") {
      const decider = row.approvedByMemberId ?? row.rejectedByMemberId;
      if (decider === context.membershipId && row.status === wanted) return { outcome: wanted, alreadyApplied: true };
      throw approvalError("APPROVAL_ALREADY_DECIDED", "This approval was already decided.");
    }
    if (row.companyMemberId === context.membershipId) {
      throw approvalError("APPROVAL_SELF_APPROVAL_BLOCKED", "This is your own leave, so somebody else has to decide it.", "FORBIDDEN");
    }
    if (input.expectedVersion !== undefined) {
      const version = Math.max(1, (await submissionCounts([row.id])).get(row.id) ?? 1);
      if (version !== input.expectedVersion) throw approvalError("APPROVAL_SOURCE_CHANGED", "This leave request was resubmitted since you opened it. Review the latest version.");
    }
    try {
      if (decision === "APPROVE") await approveLeave(context, row.id, input.note);
      else await rejectLeave(context, row.id, input.note ?? "");
    } catch (error) {
      translateSourceError(error);
    }
    return { outcome: wanted, alreadyApplied: false };
  },
};
