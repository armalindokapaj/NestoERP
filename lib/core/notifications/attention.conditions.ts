import { Prisma } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { prisma } from "@/lib/database/prisma";
import type { RecordType } from "@/lib/core/records/record.types";
import { OPEN_HAZARD_STATUSES, OPEN_INCIDENT_STATUSES } from "@/lib/modules/hse/hse.status";

/**
 * Attention conditions (PRD #38 §83-§85).
 *
 * An attention item is a condition that is true right now — overdue, waiting,
 * expiring, critical — addressed to the people who can act on it. Each
 * condition answers two questions about one company:
 *
 *   collect  which records are in the condition, and who should hear about
 *            each (explicit members, or everybody holding a permission)
 *   holds    whether one record is still in it, asked when an item is shown
 *            so a condition that ended a minute ago is not offered as a task
 *
 * Nobody is trusted from here: the reconciler re-reads every record in each
 * recipient's own context before an item is written or kept.
 */

export const ATTENTION_CONDITIONS = [
  "OVERDUE_TASK",
  "PENDING_APPROVAL",
  "CONTRACT_EXPIRING",
  "OVERDUE_CONTRACT_OBLIGATION",
  "UNRESOLVED_NCR",
  "OVERDUE_QA_ACTION",
  "CRITICAL_HSE_ITEM",
  "OVERDUE_HSE_ACTION",
  "OVERDUE_INVOICE",
  "PROCUREMENT_ACTION_REQUIRED",
  "MEETING_ACTION_OVERDUE",
  "APPROVAL_OVERDUE",
  "TIMESHEET_NOT_SUBMITTED",
  "TIMESHEET_RETURNED",
  "TIMESHEET_APPROVAL_OVERDUE",
  "DAILY_LOG_MISSING",
  "DAILY_LOG_RETURNED",
  "DAILY_LOG_AWAITING_REVIEW",
  "MILESTONE_OVERDUE",
  "MILESTONE_AT_RISK",
  "CRITICAL_MILESTONE_BLOCKED",
  "ANNOUNCEMENT_ACK_REQUIRED",
  "CONTRACTOR_COMPLIANCE_EXPIRING",
  "CONTRACTOR_COMPLIANCE_EXPIRED",
  "CONTRACTOR_COMPLIANCE_MISSING",
  "RFI_OVERDUE",
  "RFI_RESPONSE_REQUIRED",
  "SUBMITTAL_REVIEW_OVERDUE",
  "SUBMITTAL_REVISION_REQUIRED",
  "ENGINEERING_REVIEW_OVERDUE",
] as const;

export type AttentionConditionKey = (typeof ATTENTION_CONDITIONS)[number];
export type AttentionPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type AttentionCandidate = {
  entityType: RecordType;
  entityId: string;
  projectId: string | null;
  title: string;
  body: string | null;
  priority: AttentionPriority;
  /** A critical safety condition cannot be waved away (PRD #25 §79). */
  dismissible: boolean;
  /**
   * Part of the dedupe key. A new episode — a new due date, a new approval
   * cycle — is a new item, so dismissing one episode never hides the next.
   */
  episode: string;
  /** Members named on the record: assignee, owner, investigator. */
  recipients: Array<string | null | undefined>;
  /** Everybody holding all of these is a recipient as well. */
  holders?: Permission[];
  /** Never a recipient — the submitter of an approval, for instance. */
  exclude?: string[];
};

export type AttentionConditionDefinition = {
  key: AttentionConditionKey;
  moduleKey: ModuleKey;
  collect(companyId: string, now: Date): Promise<AttentionCandidate[]>;
  holds(companyId: string, entityType: string, entityId: string, now: Date): Promise<boolean>;
};

const LIMIT = 500;
const DAY_MS = 86_400_000;

/** Midnight UTC today: something due today is not overdue until tomorrow. */
export function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/* Tasks -------------------------------------------------------------------- */

const OPEN_TASK: Prisma.TaskWhereInput = { archivedAt: null, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } };

const overdueTask: AttentionConditionDefinition = {
  key: "OVERDUE_TASK",
  moduleKey: "tasks",
  async collect(companyId, now) {
    const rows = await prisma.task.findMany({
      where: { companyId, ...OPEN_TASK, dueDate: { lt: startOfDay(now) } },
      select: { id: true, title: true, projectId: true, dueDate: true, assigneeMemberId: true, createdByMemberId: true },
      orderBy: { dueDate: "asc" },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "task",
      entityId: row.id,
      projectId: row.projectId,
      title: `Overdue: ${row.title}`,
      body: `Due ${isoDate(row.dueDate!)}`,
      priority: daysBetween(row.dueDate!, now) > 7 ? "HIGH" : "NORMAL",
      dismissible: true,
      episode: isoDate(row.dueDate!),
      // Unassigned work is still somebody's: whoever raised it.
      recipients: [row.assigneeMemberId ?? row.createdByMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    return (await prisma.task.count({ where: { id, companyId, ...OPEN_TASK, dueDate: { lt: startOfDay(now) } } })) > 0;
  },
};

/* Approvals ---------------------------------------------------------------- */

type PendingApproval = { recordType: string; recordId: string; submittedByMemberId: string; id: string };

type ApprovalSource = {
  moduleKey: ModuleKey;
  load(companyId: string): Promise<PendingApproval[]>;
  count(companyId: string, recordTypes: string[], recordId: string): Promise<number>;
  records: Record<string, { entityType: RecordType; noun: string; holders: Permission[] }>;
};

const pendingWhere = (companyId: string) => ({ companyId, status: "PENDING" as const });
const approvalSelect = { id: true, recordType: true, recordId: true, submittedByMemberId: true } as const;

const APPROVAL_SOURCES: ApprovalSource[] = [
  {
    moduleKey: "finance",
    load: (companyId) => prisma.financeApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
    count: (companyId, types, recordId) =>
      prisma.financeApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      INVOICE: { entityType: "invoice", noun: "Invoice", holders: ["finance.invoice.approve"] },
      EXPENSE: { entityType: "expense", noun: "Expense", holders: ["finance.expense.approve"] },
      BUDGET: { entityType: "budget", noun: "Budget", holders: ["finance.budget.approve"] },
      COMMITMENT: { entityType: "commitment", noun: "Commitment", holders: ["finance.commitment.approve"] },
    },
  },
  {
    moduleKey: "sales",
    load: (companyId) => prisma.salesApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
    count: (companyId, types, recordId) =>
      prisma.salesApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: { PROPOSAL: { entityType: "proposal", noun: "Proposal", holders: ["sales.proposal.approve"] } },
  },
  {
    moduleKey: "contracts",
    load: (companyId) => prisma.contractApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
    count: (companyId, types, recordId) =>
      prisma.contractApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      CONTRACT: { entityType: "contract", noun: "Contract", holders: ["legal.approval.decide", "legal.contract.approve"] },
      AMENDMENT: { entityType: "amendment", noun: "Amendment", holders: ["legal.approval.decide", "legal.amendment.approve"] },
    },
  },
  {
    moduleKey: "qaqc",
    load: (companyId) => prisma.qualityApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
    count: (companyId, types, recordId) =>
      prisma.qualityApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      INSPECTION: { entityType: "quality_inspection", noun: "Inspection", holders: ["qaqc.inspection.approve"] },
      NCR: { entityType: "non_conformance_report", noun: "NCR", holders: ["qaqc.ncr.approve"] },
    },
  },
  {
    moduleKey: "hse",
    load: (companyId) => prisma.hseApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
    count: (companyId, types, recordId) =>
      prisma.hseApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      INSPECTION: { entityType: "hse_inspection", noun: "HSE inspection", holders: ["hse.inspection.approve"] },
      RISK_ASSESSMENT: { entityType: "risk_assessment", noun: "Risk assessment", holders: ["hse.risk.approve"] },
      WORK_PERMIT: { entityType: "work_permit", noun: "Work permit", holders: ["hse.permit.approve"] },
      INCIDENT_CLOSE: { entityType: "incident", noun: "Incident closure", holders: ["hse.incident.close"] },
    },
  },
];

const PROCUREMENT_SOURCE: ApprovalSource = {
  moduleKey: "procurement",
  load: (companyId) => prisma.procurementApproval.findMany({ where: pendingWhere(companyId), select: approvalSelect, take: LIMIT }),
  count: (companyId, types, recordId) =>
    prisma.procurementApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
  records: {
    PURCHASE_REQUEST: { entityType: "purchase_request", noun: "Purchase request", holders: ["procurement.request.approve"] },
    PURCHASE_ORDER: { entityType: "purchase_order", noun: "Purchase order", holders: ["procurement.order.approve"] },
  },
};

async function approvalCandidates(sources: ApprovalSource[], companyId: string, verb: string): Promise<AttentionCandidate[]> {
  const candidates: AttentionCandidate[] = [];
  for (const source of sources) {
    for (const approval of await source.load(companyId)) {
      const record = source.records[approval.recordType];
      if (!record) continue;
      candidates.push({
        entityType: record.entityType,
        entityId: approval.recordId,
        projectId: null,
        title: `${record.noun} ${verb}`,
        body: null,
        priority: "HIGH",
        dismissible: true,
        episode: approval.id,
        recipients: [],
        holders: record.holders,
        // Separation of duties: the submitter is not asked to decide.
        exclude: [approval.submittedByMemberId],
      });
    }
  }
  return candidates;
}

async function approvalHolds(sources: ApprovalSource[], companyId: string, entityType: string, entityId: string): Promise<boolean> {
  for (const source of sources) {
    const types = Object.entries(source.records)
      .filter(([, record]) => record.entityType === entityType)
      .map(([type]) => type);
    if (types.length > 0 && (await source.count(companyId, types, entityId)) > 0) return true;
  }
  return false;
}

/**
 * Approvals addressed to a person rather than a permission (PRD #41 §39): a
 * document review names its reviewer, and a leave request goes to whoever may
 * decide leave in the employee's HR scope — never to the employee.
 */
async function assignedApprovalCandidates(companyId: string): Promise<AttentionCandidate[]> {
  const [reviews, leave, timesheets] = await Promise.all([
    prisma.documentReview.findMany({
      where: { companyId, status: "PENDING" },
      select: { id: true, documentId: true, reviewerMemberId: true, requestedByMemberId: true, version: { select: { versionNumber: true, document: { select: { name: true, projectId: true } } } } },
      take: LIMIT,
    }),
    prisma.leaveRequest.findMany({
      where: { companyId, status: "PENDING" },
      select: { id: true, companyMemberId: true, submittedAt: true, startDate: true },
      take: LIMIT,
    }),
    // A week goes to its one designated approver (PRD #42 §73).
    prisma.timesheetApproval.findMany({
      where: { companyId, status: "PENDING" },
      select: { id: true, recordId: true, approverMemberId: true, submittedByMemberId: true },
      take: LIMIT,
    }),
  ]);
  const weeks = timesheets.length
    ? await prisma.timesheet.findMany({
        where: { companyId, id: { in: timesheets.map((row) => row.recordId) } },
        select: { id: true, periodStart: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } },
      })
    : [];
  const weekById = new Map(weeks.map((row) => [row.id, row]));
  return [
    ...reviews.map((row): AttentionCandidate => ({
      entityType: "document",
      entityId: row.documentId,
      projectId: row.version.document.projectId,
      title: `Review “${row.version.document.name}” v${row.version.versionNumber}`,
      body: null,
      priority: "HIGH",
      dismissible: true,
      // One per review, so each reviewer's item resolves with their own decision.
      episode: row.id,
      recipients: [row.reviewerMemberId],
      exclude: [row.requestedByMemberId],
    })),
    ...leave.map((row): AttentionCandidate => ({
      entityType: "leave_request",
      entityId: row.id,
      projectId: null,
      title: "Leave request waiting for your approval",
      body: `Starts ${isoDate(row.startDate)}`,
      priority: "HIGH",
      dismissible: true,
      episode: `${row.id}:${row.submittedAt?.toISOString() ?? "draft"}`,
      recipients: [],
      holders: ["hr.leave.approve"],
      exclude: [row.companyMemberId],
    })),
    ...timesheets.flatMap((row): AttentionCandidate[] => {
      const week = weekById.get(row.recordId);
      if (!week) return [];
      return [{
        entityType: "timesheet",
        entityId: row.recordId,
        projectId: null,
        title: `Timesheet from ${week.member.user.firstName} ${week.member.user.lastName} waiting for your approval`,
        body: `Week of ${isoDate(week.periodStart)}`,
        priority: "NORMAL",
        dismissible: true,
        episode: row.id,
        recipients: [row.approverMemberId],
        exclude: [row.submittedByMemberId],
      }];
    }),
  ];
}

const pendingApproval: AttentionConditionDefinition = {
  key: "PENDING_APPROVAL",
  moduleKey: "dashboard",
  collect: async (companyId) => [
    ...(await approvalCandidates(APPROVAL_SOURCES, companyId, "waiting for your approval")),
    ...(await assignedApprovalCandidates(companyId)),
  ],
  async holds(companyId, type, id) {
    if (type === "document") return (await prisma.documentReview.count({ where: { companyId, documentId: id, status: "PENDING" } })) > 0;
    if (type === "leave_request") return (await prisma.leaveRequest.count({ where: { companyId, id, status: "PENDING" } })) > 0;
    if (type === "timesheet") return (await prisma.timesheet.count({ where: { companyId, id, status: "SUBMITTED" } })) > 0;
    return approvalHolds(APPROVAL_SOURCES, companyId, type, id);
  },
};

/**
 * Procurement decisions, following the chain where an order has one (PRD #41
 * §21): the current step's approvers are told — a permission, or the members
 * of a role — and nobody who submitted it or already decided a step.
 */
const procurementActionRequired: AttentionConditionDefinition = {
  key: "PROCUREMENT_ACTION_REQUIRED",
  moduleKey: "procurement",
  async collect(companyId) {
    const candidates = await approvalCandidates([PROCUREMENT_SOURCE], companyId, "needs a procurement decision");
    const approvalIds = candidates.map((candidate) => candidate.episode);
    const steps = await prisma.approvalStep.findMany({
      where: { companyId, providerKey: "procurement", approvalId: { in: approvalIds } },
      orderBy: [{ approvalId: "asc" }, { stepNumber: "asc" }],
      select: { approvalId: true, stepNumber: true, label: true, status: true, approverPermission: true, approverRoleKey: true, approverMemberId: true, decidedByMemberId: true, onBehalfOfMemberId: true },
    });
    if (steps.length === 0) return candidates;
    const roleKeys = [...new Set(steps.map((step) => step.approverRoleKey).filter((key): key is string => Boolean(key)))];
    const roleMembers = roleKeys.length
      ? await prisma.companyMember.findMany({ where: { companyId, status: "ACTIVE", role: { key: { in: roleKeys } } }, select: { id: true, role: { select: { key: true } } } })
      : [];
    return candidates.map((candidate) => {
      const chain = steps.filter((step) => step.approvalId === candidate.episode);
      const current = chain.find((step) => step.status === "PENDING");
      if (!current) return candidate;
      const decided = chain.flatMap((step) => [step.decidedByMemberId, step.onBehalfOfMemberId]).filter((id): id is string => Boolean(id));
      return {
        ...candidate,
        title: `Purchase order needs the ${current.label} decision`,
        body: `Step ${current.stepNumber} of ${chain.length}`,
        episode: `${candidate.episode}:${current.stepNumber}`,
        recipients: current.approverMemberId
          ? [current.approverMemberId]
          : current.approverRoleKey
            ? roleMembers.filter((member) => member.role.key === current.approverRoleKey).map((member) => member.id)
            : [],
        holders: current.approverPermission ? [current.approverPermission as Permission] : undefined,
        exclude: [...(candidate.exclude ?? []), ...decided],
      };
    });
  },
  holds: (companyId, type, id) => approvalHolds([PROCUREMENT_SOURCE], companyId, type, id),
};

/**
 * Approvals past a real deadline (PRD #41 §36, §37, §39, §228): a review past
 * its due date, leave whose first day has come, a proposal past its validity,
 * a permit past its start. Only sources that have such a date appear; nothing
 * is given a deadline it does not have.
 */
const approvalOverdue: AttentionConditionDefinition = {
  key: "APPROVAL_OVERDUE",
  moduleKey: "approvals",
  async collect(companyId, now) {
    const today = startOfDay(now);
    const [reviews, leave, proposals, permits] = await Promise.all([
      prisma.documentReview.findMany({
        where: { companyId, status: "PENDING", dueAt: { lt: today } },
        select: { id: true, documentId: true, reviewerMemberId: true, dueAt: true, version: { select: { document: { select: { name: true, projectId: true } } } } },
        take: LIMIT,
      }),
      prisma.leaveRequest.findMany({ where: { companyId, status: "PENDING", startDate: { lt: today } }, select: { id: true, companyMemberId: true, startDate: true }, take: LIMIT }),
      prisma.proposal.findMany({ where: { companyId, status: "PENDING_APPROVAL", validUntil: { lt: today } }, select: { id: true, proposalNumber: true, validUntil: true, createdByMemberId: true }, take: LIMIT }),
      prisma.hseWorkPermit.findMany({ where: { companyId, status: "PENDING_APPROVAL", validFrom: { lt: today } }, select: { id: true, permitNumber: true, projectId: true, validFrom: true, requestedByMemberId: true }, take: LIMIT }),
    ]);
    return [
      ...reviews.map((row): AttentionCandidate => ({
        entityType: "document", entityId: row.documentId, projectId: row.version.document.projectId,
        title: `Overdue review: “${row.version.document.name}”`, body: `Due ${isoDate(row.dueAt!)}`,
        priority: "HIGH", dismissible: true, episode: `${row.id}:${isoDate(row.dueAt!)}`, recipients: [row.reviewerMemberId],
      })),
      ...leave.map((row): AttentionCandidate => ({
        entityType: "leave_request", entityId: row.id, projectId: null,
        title: "Leave began without a decision", body: `Started ${isoDate(row.startDate)}`,
        priority: "HIGH", dismissible: true, episode: isoDate(row.startDate), recipients: [], holders: ["hr.leave.approve"], exclude: [row.companyMemberId],
      })),
      ...proposals.map((row): AttentionCandidate => ({
        entityType: "proposal", entityId: row.id, projectId: null,
        title: `Proposal ${row.proposalNumber} lapsed while waiting for approval`, body: `Valid until ${isoDate(row.validUntil!)}`,
        priority: "HIGH", dismissible: true, episode: isoDate(row.validUntil!), recipients: [], holders: ["sales.proposal.approve"], exclude: [row.createdByMemberId],
      })),
      ...permits.map((row): AttentionCandidate => ({
        entityType: "work_permit", entityId: row.id, projectId: row.projectId,
        title: `Permit ${row.permitNumber} was due to start without approval`, body: `From ${isoDate(row.validFrom)}`,
        priority: "CRITICAL", dismissible: true, episode: isoDate(row.validFrom), recipients: [], holders: ["hse.permit.approve"], exclude: [row.requestedByMemberId],
      })),
    ];
  },
  async holds(companyId, type, id, now) {
    const today = startOfDay(now);
    if (type === "document") return (await prisma.documentReview.count({ where: { companyId, documentId: id, status: "PENDING", dueAt: { lt: today } } })) > 0;
    if (type === "leave_request") return (await prisma.leaveRequest.count({ where: { companyId, id, status: "PENDING", startDate: { lt: today } } })) > 0;
    if (type === "proposal") return (await prisma.proposal.count({ where: { companyId, id, status: "PENDING_APPROVAL", validUntil: { lt: today } } })) > 0;
    if (type === "work_permit") return (await prisma.hseWorkPermit.count({ where: { companyId, id, status: "PENDING_APPROVAL", validFrom: { lt: today } } })) > 0;
    return false;
  },
};

/* Timesheets (PRD #42 §103, §213, §214) ------------------------------------ */

/** A week still undecided this long after it was submitted is overdue for its approver. */
export const TIMESHEET_APPROVAL_OVERDUE_DAYS = 3;

/**
 * A week not submitted once its deadline has passed — only where the company
 * set a deadline, and only the latest week due. The reminder job creates the
 * empty week of anybody who logged nothing, so there is always a week to open.
 */
const timesheetNotSubmitted: AttentionConditionDefinition = {
  key: "TIMESHEET_NOT_SUBMITTED",
  moduleKey: "timesheets",
  async collect(companyId, now) {
    const { lastDueWeek } = await import("@/lib/modules/timesheets/timesheet.deadline");
    const { resolveTimesheetSettings } = await import("@/lib/modules/timesheets/timesheet.settings");
    const { businessInstant, weekLabel } = await import("@/lib/modules/timesheets/timesheet.time");
    const settings = await resolveTimesheetSettings(companyId);
    const week = lastDueWeek(now, settings);
    if (!week) return [];
    const rows = await prisma.timesheet.findMany({
      where: { companyId, periodStart: businessInstant(week), status: "DRAFT", member: { status: "ACTIVE" } },
      select: { id: true, memberId: true },
      take: LIMIT,
    });
    return rows.map((row): AttentionCandidate => ({
      entityType: "timesheet", entityId: row.id, projectId: null,
      title: `Submit your timesheet for ${weekLabel(week)}`, body: "The submission deadline has passed.",
      priority: "HIGH", dismissible: true, episode: week, recipients: [row.memberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "timesheet") return false;
    const { lastDueWeek } = await import("@/lib/modules/timesheets/timesheet.deadline");
    const { resolveTimesheetSettings } = await import("@/lib/modules/timesheets/timesheet.settings");
    const { businessInstant } = await import("@/lib/modules/timesheets/timesheet.time");
    const week = lastDueWeek(now, await resolveTimesheetSettings(companyId));
    if (!week) return false;
    return (await prisma.timesheet.count({ where: { companyId, id, status: "DRAFT", periodStart: { lte: businessInstant(week) } } })) > 0;
  },
};

/** A week sent back to its member, until they submit it again (§64, §65, §214). */
const timesheetReturned: AttentionConditionDefinition = {
  key: "TIMESHEET_RETURNED",
  moduleKey: "timesheets",
  async collect(companyId) {
    const rows = await prisma.timesheet.findMany({
      where: { companyId, status: { in: ["RETURNED", "REJECTED"] }, member: { status: "ACTIVE" } },
      select: { id: true, memberId: true, status: true, periodStart: true, returnedAt: true, rejectedAt: true, submissionVersion: true },
      take: LIMIT,
    });
    return rows.map((row): AttentionCandidate => ({
      entityType: "timesheet", entityId: row.id, projectId: null,
      title: row.status === "REJECTED" ? "Your timesheet was rejected" : "Your timesheet was returned for correction",
      body: `Week of ${isoDate(row.periodStart)}`,
      priority: "HIGH", dismissible: true,
      episode: `${row.status}:${(row.status === "REJECTED" ? row.rejectedAt : row.returnedAt)?.toISOString() ?? row.submissionVersion}`,
      recipients: [row.memberId],
    }));
  },
  async holds(companyId, type, id) {
    return type === "timesheet" && (await prisma.timesheet.count({ where: { companyId, id, status: { in: ["RETURNED", "REJECTED"] } } })) > 0;
  },
};

/** A submitted week its approver has not decided in time (§213). */
const timesheetApprovalOverdue: AttentionConditionDefinition = {
  key: "TIMESHEET_APPROVAL_OVERDUE",
  moduleKey: "timesheets",
  async collect(companyId, now) {
    const before = new Date(now.getTime() - TIMESHEET_APPROVAL_OVERDUE_DAYS * DAY_MS);
    const rows = await prisma.timesheetApproval.findMany({
      where: { companyId, status: "PENDING", submittedAt: { lt: before } },
      select: { id: true, recordId: true, approverMemberId: true, submittedByMemberId: true, submittedAt: true },
      take: LIMIT,
    });
    return rows.map((row): AttentionCandidate => ({
      entityType: "timesheet", entityId: row.recordId, projectId: null,
      title: "A timesheet has waited for your decision for over three days", body: `Submitted ${isoDate(row.submittedAt)}`,
      priority: "HIGH", dismissible: true, episode: row.id, recipients: [row.approverMemberId], exclude: [row.submittedByMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "timesheet") return false;
    const before = new Date(now.getTime() - TIMESHEET_APPROVAL_OVERDUE_DAYS * DAY_MS);
    return (await prisma.timesheetApproval.count({ where: { companyId, recordId: id, status: "PENDING", submittedAt: { lt: before } } })) > 0;
  },
};

/* Daily logs (PRD #43 §103-§109) -------------------------------------------- */

/**
 * No log for a required project's last working day. About the project, since
 * there is no log to point at; one item per project per day, for its manager.
 */
const dailyLogMissing: AttentionConditionDefinition = {
  key: "DAILY_LOG_MISSING",
  moduleKey: "dailyLogs",
  async collect(companyId, now) {
    const { missingYesterday } = await import("@/lib/modules/daily-logs/daily-log.reports");
    const { dateLabel } = await import("@/lib/modules/daily-logs/daily-log.time");
    return (await missingYesterday(companyId, now)).map((row): AttentionCandidate => ({
      entityType: "project", entityId: row.projectId, projectId: row.projectId,
      title: `No daily log for ${row.projectName}`, body: dateLabel(row.date),
      priority: "NORMAL", dismissible: true, episode: row.date, recipients: [row.projectManagerMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "project") return false;
    const { missingYesterday } = await import("@/lib/modules/daily-logs/daily-log.reports");
    return (await missingYesterday(companyId, now)).some((row) => row.projectId === id);
  },
};

/** A log sent back to its authors, until they submit it again. */
const dailyLogReturned: AttentionConditionDefinition = {
  key: "DAILY_LOG_RETURNED",
  moduleKey: "dailyLogs",
  async collect(companyId) {
    const rows = await prisma.dailyLog.findMany({
      where: { companyId, status: "CORRECTION_REQUIRED" },
      select: { id: true, projectId: true, workDate: true, returnedAt: true, createdByMemberId: true, submittedByMemberId: true, project: { select: { name: true } } },
      take: LIMIT,
    });
    return rows.map((row): AttentionCandidate => ({
      entityType: "daily_log", entityId: row.id, projectId: row.projectId,
      title: `Daily log for ${row.project.name} needs correcting`, body: `Work date ${isoDate(row.workDate)}`,
      priority: "HIGH", dismissible: true, episode: row.returnedAt?.toISOString() ?? "returned", recipients: [row.createdByMemberId, row.submittedByMemberId],
    }));
  },
  async holds(companyId, type, id) {
    return type === "daily_log" && (await prisma.dailyLog.count({ where: { companyId, id, status: "CORRECTION_REQUIRED" } })) > 0;
  },
};

/** A submitted log waiting for its reviewer — never the person who submitted it. */
const dailyLogAwaitingReview: AttentionConditionDefinition = {
  key: "DAILY_LOG_AWAITING_REVIEW",
  moduleKey: "dailyLogs",
  async collect(companyId) {
    const rows = await prisma.dailyLog.findMany({
      where: { companyId, status: "SUBMITTED" },
      select: { id: true, projectId: true, workDate: true, submittedAt: true, reviewerMemberId: true, submittedByMemberId: true, project: { select: { name: true, projectManagerMemberId: true } } },
      take: LIMIT,
    });
    return rows.map((row): AttentionCandidate => ({
      entityType: "daily_log", entityId: row.id, projectId: row.projectId,
      title: `Review the daily log for ${row.project.name}`, body: `Work date ${isoDate(row.workDate)}`,
      priority: "NORMAL", dismissible: true, episode: row.submittedAt?.toISOString() ?? "submitted",
      recipients: [row.reviewerMemberId ?? row.project.projectManagerMemberId], exclude: row.submittedByMemberId ? [row.submittedByMemberId] : [],
    }));
  },
  async holds(companyId, type, id) {
    return type === "daily_log" && (await prisma.dailyLog.count({ where: { companyId, id, status: "SUBMITTED" } })) > 0;
  },
};

/* Project planning (PRD #44 §72-§74, §157, §215) ---------------------------- */

/** An open milestone past its target date, for its owner and the project manager. */
const milestoneOverdue: AttentionConditionDefinition = {
  key: "MILESTONE_OVERDUE",
  moduleKey: "projects",
  async collect(companyId, now) {
    const { overdueMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    const { dateLabel } = await import("@/lib/modules/project-planning/planning.dates");
    return (await overdueMilestones(companyId, now)).map((row): AttentionCandidate => ({
      entityType: "project_milestone", entityId: row.id, projectId: row.projectId,
      title: `Milestone overdue: ${row.name}`, body: `${row.project.name} · due ${dateLabel(row.target)}`,
      priority: row.critical ? "HIGH" : "NORMAL", dismissible: true,
      // A new forecast is a new episode: dismissing one date never hides the next.
      episode: row.target ?? "overdue",
      recipients: [row.ownerMemberId, row.project.projectManagerMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "project_milestone") return false;
    const { overdueMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await overdueMilestones(companyId, now, id)).length > 0;
  },
};

/** A milestone somebody marked at risk, until its status moves on. */
const milestoneAtRisk: AttentionConditionDefinition = {
  key: "MILESTONE_AT_RISK",
  moduleKey: "projects",
  async collect(companyId) {
    const { atRiskMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await atRiskMilestones(companyId)).map((row): AttentionCandidate => ({
      entityType: "project_milestone", entityId: row.id, projectId: row.projectId,
      title: `Milestone at risk: ${row.name}`, body: row.project.name,
      priority: row.critical ? "HIGH" : "NORMAL", dismissible: true,
      episode: (row.statusChangedAt ?? row.createdAt).toISOString(),
      recipients: [row.ownerMemberId, row.project.projectManagerMemberId],
    }));
  },
  async holds(companyId, type, id) {
    if (type !== "project_milestone") return false;
    const { atRiskMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await atRiskMilestones(companyId, id)).length > 0;
  },
};

/** An open critical blocker on a milestone still to be achieved. */
const criticalMilestoneBlocked: AttentionConditionDefinition = {
  key: "CRITICAL_MILESTONE_BLOCKED",
  moduleKey: "projects",
  async collect(companyId) {
    const { criticallyBlockedMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await criticallyBlockedMilestones(companyId)).map(({ milestone, first, owners, count }): AttentionCandidate => ({
      entityType: "project_milestone", entityId: milestone.id, projectId: milestone.projectId,
      title: `Critical blocker on ${milestone.name}`, body: count > 1 ? `${first.title} and ${count - 1} more · ${milestone.project.name}` : `${first.title} · ${milestone.project.name}`,
      priority: "HIGH", dismissible: true, episode: first.id,
      recipients: [milestone.ownerMemberId, milestone.project.projectManagerMemberId, ...owners],
    }));
  },
  async holds(companyId, type, id) {
    if (type !== "project_milestone") return false;
    const { criticallyBlockedMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await criticallyBlockedMilestones(companyId, id)).length > 0;
  },
};

/* Announcements (PRD #45 §47, §282, §283) ----------------------------------- */

/**
 * An important or critical announcement waiting for acknowledgment, for each
 * target who has not given it. A critical one cannot be waved away; an
 * acknowledgment or the announcement ending resolves it.
 */
const announcementAckRequired: AttentionConditionDefinition = {
  key: "ANNOUNCEMENT_ACK_REQUIRED",
  moduleKey: "announcements",
  async collect(companyId, now) {
    const rows = await prisma.announcement.findMany({
      where: { companyId, status: "PUBLISHED", requiresAcknowledgment: true, priority: { in: ["IMPORTANT", "CRITICAL"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      take: LIMIT,
      select: { id: true, title: true, priority: true, projectId: true, publishedAt: true, targets: { select: { memberId: true } }, acknowledgments: { select: { memberId: true } } },
    });
    return rows.map((row): AttentionCandidate => {
      const acknowledged = new Set(row.acknowledgments.map((entry) => entry.memberId));
      return {
        entityType: "announcement", entityId: row.id, projectId: row.projectId,
        title: `Acknowledge: ${row.title}`, body: row.priority === "CRITICAL" ? "Critical announcement" : "Important announcement",
        priority: row.priority === "CRITICAL" ? "CRITICAL" : "HIGH", dismissible: row.priority !== "CRITICAL",
        episode: row.publishedAt?.toISOString() ?? "published",
        recipients: row.targets.map((target) => target.memberId).filter((memberId) => !acknowledged.has(memberId)),
      };
    });
  },
  async holds(companyId, type, id, now) {
    return type === "announcement" && (await prisma.announcement.count({ where: { companyId, id, status: "PUBLISHED", requiresAcknowledgment: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } })) > 0;
  },
};

/* Contractors and engineering (PRD #46 §45, §95, §107, §197-§199) ---------- */

/**
 * A compliance item expiring, expired or missing, for the people who keep
 * compliance and the managers of the contractor's live projects. Expired
 * cannot be waved away; renewing, waiving or archiving the item resolves it.
 */
function complianceCondition(key: "CONTRACTOR_COMPLIANCE_EXPIRING" | "CONTRACTOR_COMPLIANCE_EXPIRED" | "CONTRACTOR_COMPLIANCE_MISSING", status: "EXPIRING" | "EXPIRED" | "MISSING"): AttentionConditionDefinition {
  return {
    key,
    moduleKey: "contractors",
    async collect(companyId) {
      const { complianceInStatus, complianceRecipients } = await import("@/lib/modules/contractors/contractor.compliance");
      const { dateLabel } = await import("@/lib/modules/project-planning/planning.dates");
      const rows = await complianceInStatus(companyId, status);
      const recipientsByContractor = new Map<string, string[]>();
      for (const contractorId of new Set(rows.map((row) => row.contractorId))) recipientsByContractor.set(contractorId, await complianceRecipients(prisma, companyId, contractorId));
      return rows.map((row): AttentionCandidate => ({
        entityType: "contractor_compliance", entityId: row.id, projectId: null,
        title: status === "MISSING" ? `Missing: ${row.title}` : status === "EXPIRED" ? `Expired: ${row.title}` : `Expiring: ${row.title}`,
        body: row.expiresAt ? `${row.contractorName} · ${status === "EXPIRED" ? "expired" : "expires"} ${dateLabel(row.expiresAt)}` : row.contractorName,
        priority: status === "EXPIRED" ? "HIGH" : "NORMAL", dismissible: status !== "EXPIRED",
        episode: row.expiresAt ?? (row.statusChangedAt ?? row.createdAt).toISOString(),
        recipients: recipientsByContractor.get(row.contractorId) ?? [],
      }));
    },
    async holds(companyId, type, id) {
      if (type !== "contractor_compliance") return false;
      const { complianceInStatus } = await import("@/lib/modules/contractors/contractor.compliance");
      return (await complianceInStatus(companyId, status, id)).length > 0;
    },
  };
}

const complianceExpiring = complianceCondition("CONTRACTOR_COMPLIANCE_EXPIRING", "EXPIRING");
const complianceExpired = complianceCondition("CONTRACTOR_COMPLIANCE_EXPIRED", "EXPIRED");
const complianceMissing = complianceCondition("CONTRACTOR_COMPLIANCE_MISSING", "MISSING");

/** An RFI past its due date without an answer, for its assignee and whoever raised it. */
const rfiOverdue: AttentionConditionDefinition = {
  key: "RFI_OVERDUE",
  moduleKey: "engineering",
  async collect(companyId, now) {
    const { overdueRfis } = await import("@/lib/modules/engineering/engineering.attention");
    const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
    return (await overdueRfis(companyId, now)).map((row): AttentionCandidate => ({
      entityType: "rfi", entityId: row.id, projectId: row.projectId,
      title: `RFI overdue: ${row.rfiNumber}`, body: `${row.subject} · ${row.project.name} · due ${dateLabel(dateOf(row.dueAt))}`,
      priority: row.priority === "CRITICAL" || row.priority === "HIGH" ? "HIGH" : "NORMAL", dismissible: true,
      episode: dateOf(row.dueAt) ?? "overdue",
      recipients: [row.assignedToMemberId, row.createdByMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "rfi") return false;
    const { overdueRfis } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueRfis(companyId, now, id)).length > 0;
  },
};

/** An open RFI waiting on its assignee's answer. */
const rfiResponseRequired: AttentionConditionDefinition = {
  key: "RFI_RESPONSE_REQUIRED",
  moduleKey: "engineering",
  async collect(companyId) {
    const { rfisAwaitingResponse } = await import("@/lib/modules/engineering/engineering.attention");
    const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
    return (await rfisAwaitingResponse(companyId)).map((row): AttentionCandidate => ({
      entityType: "rfi", entityId: row.id, projectId: row.projectId,
      title: `${row.status === "CLARIFICATION_REQUIRED" ? "Clarify" : "Answer"} RFI ${row.rfiNumber}`, body: [row.subject, row.dueAt ? `due ${dateLabel(dateOf(row.dueAt))}` : null].filter(Boolean).join(" · "),
      priority: row.priority === "CRITICAL" ? "HIGH" : "NORMAL", dismissible: true,
      // A new assignee or a clarification is a new ask.
      episode: `${row.assignedToMemberId}:${row.status}`,
      recipients: [row.assignedToMemberId],
    }));
  },
  async holds(companyId, type, id) {
    if (type !== "rfi") return false;
    const { rfisAwaitingResponse } = await import("@/lib/modules/engineering/engineering.attention");
    return (await rfisAwaitingResponse(companyId, id)).length > 0;
  },
};

/** A submittal review past its date, for the reviewer — or the project manager when nobody is assigned. */
const submittalReviewOverdue: AttentionConditionDefinition = {
  key: "SUBMITTAL_REVIEW_OVERDUE",
  moduleKey: "engineering",
  async collect(companyId, now) {
    const { overdueSubmittalReviews } = await import("@/lib/modules/engineering/engineering.attention");
    const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
    return (await overdueSubmittalReviews(companyId, now)).map((row): AttentionCandidate => ({
      entityType: "technical_submittal", entityId: row.id, projectId: row.projectId,
      title: `Review overdue: submittal ${row.submittalNumber}`, body: `${row.title} · due ${dateLabel(dateOf(row.dueAt))}`,
      priority: "HIGH", dismissible: true,
      episode: `${row.currentRevision?.id ?? "none"}:${dateOf(row.dueAt)}`,
      recipients: [row.assignedReviewerMemberId ?? row.project.projectManagerMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "technical_submittal") return false;
    const { overdueSubmittalReviews } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueSubmittalReviews(companyId, now, id)).length > 0;
  },
};

/** A submittal sent back for a new revision, for whoever registered and submitted it. */
const submittalRevisionRequired: AttentionConditionDefinition = {
  key: "SUBMITTAL_REVISION_REQUIRED",
  moduleKey: "engineering",
  async collect(companyId) {
    const { submittalsNeedingRevision } = await import("@/lib/modules/engineering/engineering.attention");
    return (await submittalsNeedingRevision(companyId)).map((row): AttentionCandidate => ({
      entityType: "technical_submittal", entityId: row.id, projectId: row.projectId,
      title: `Revision required: submittal ${row.submittalNumber}`, body: `${row.title} · ${row.project.name}`,
      priority: "NORMAL", dismissible: true,
      episode: row.currentRevision?.id ?? "revision",
      recipients: [row.createdByMemberId, row.currentRevision?.submittedByMemberId],
    }));
  },
  async holds(companyId, type, id) {
    if (type !== "technical_submittal") return false;
    const { submittalsNeedingRevision } = await import("@/lib/modules/engineering/engineering.attention");
    return (await submittalsNeedingRevision(companyId, id)).length > 0;
  },
};

/** A drawing or engineering document still under review past its review date. */
const engineeringReviewOverdue: AttentionConditionDefinition = {
  key: "ENGINEERING_REVIEW_OVERDUE",
  moduleKey: "engineering",
  async collect(companyId, now) {
    const { overdueDocumentReviews } = await import("@/lib/modules/engineering/engineering.attention");
    const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
    return (await overdueDocumentReviews(companyId, now)).map((row): AttentionCandidate => ({
      entityType: "engineering_document", entityId: row.id, projectId: row.projectId,
      title: `Review overdue: ${row.documentNumber}${row.currentRevision ? ` Rev ${row.currentRevision.revisionCode}` : ""}`, body: `${row.title} · due ${dateLabel(dateOf(row.reviewDueAt))}`,
      priority: "HIGH", dismissible: true,
      episode: `${row.currentRevision?.id ?? "none"}:${dateOf(row.reviewDueAt)}`,
      recipients: [row.reviewerMemberId ?? row.project.projectManagerMemberId],
    }));
  },
  async holds(companyId, type, id, now) {
    if (type !== "engineering_document") return false;
    const { overdueDocumentReviews } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueDocumentReviews(companyId, now, id)).length > 0;
  },
};

/* Legal -------------------------------------------------------------------- */

const EXPIRY_WINDOW_DAYS = 30;
const LIVE_CONTRACT: Prisma.ContractWhereInput = { archivedAt: null, status: { in: ["SIGNED", "ACTIVE"] } };

const contractExpiring: AttentionConditionDefinition = {
  key: "CONTRACT_EXPIRING",
  moduleKey: "contracts",
  async collect(companyId, now) {
    const until = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
    const rows = await prisma.contract.findMany({
      where: { companyId, ...LIVE_CONTRACT, expiryDate: { gte: startOfDay(now), lte: until } },
      select: { id: true, contractNumber: true, title: true, projectId: true, expiryDate: true, ownerMemberId: true },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "contract",
      entityId: row.id,
      projectId: row.projectId,
      title: `Contract ${row.contractNumber} expires ${isoDate(row.expiryDate!)}`,
      body: row.title,
      priority: daysBetween(now, row.expiryDate!) <= 7 ? "HIGH" : "NORMAL",
      dismissible: true,
      episode: isoDate(row.expiryDate!),
      recipients: [row.ownerMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    const until = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
    return (await prisma.contract.count({ where: { id, companyId, ...LIVE_CONTRACT, expiryDate: { gte: startOfDay(now), lte: until } } })) > 0;
  },
};

const overdueObligation: AttentionConditionDefinition = {
  key: "OVERDUE_CONTRACT_OBLIGATION",
  moduleKey: "contracts",
  async collect(companyId, now) {
    const rows = await prisma.contractObligation.findMany({
      where: { companyId, status: "OPEN", dueDate: { lt: startOfDay(now) }, contract: { archivedAt: null } },
      select: {
        id: true,
        title: true,
        dueDate: true,
        responsibleMemberId: true,
        contract: { select: { contractNumber: true, ownerMemberId: true, projectId: true } },
      },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "obligation",
      entityId: row.id,
      projectId: row.contract.projectId,
      title: `Overdue obligation: ${row.title}`,
      body: `Contract ${row.contract.contractNumber} · due ${isoDate(row.dueDate!)}`,
      priority: "HIGH",
      dismissible: true,
      episode: isoDate(row.dueDate!),
      recipients: [row.responsibleMemberId ?? row.contract.ownerMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    return (await prisma.contractObligation.count({ where: { id, companyId, status: "OPEN", dueDate: { lt: startOfDay(now) } } })) > 0;
  },
};

/* QA/QC -------------------------------------------------------------------- */

const OPEN_NCR = ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "PENDING_APPROVAL", "APPROVED_FOR_CLOSE", "REOPENED"] as const;

const unresolvedNcr: AttentionConditionDefinition = {
  key: "UNRESOLVED_NCR",
  moduleKey: "qaqc",
  async collect(companyId) {
    const rows = await prisma.nonConformanceReport.findMany({
      where: { companyId, status: { in: [...OPEN_NCR] } },
      select: { id: true, ncrNumber: true, title: true, projectId: true, severity: true, assignedToMemberId: true, ownerMemberId: true, createdByMemberId: true },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "non_conformance_report",
      entityId: row.id,
      projectId: row.projectId,
      title: `NCR ${row.ncrNumber} is unresolved`,
      body: row.title,
      priority: row.severity === "CRITICAL" ? "CRITICAL" : row.severity === "HIGH" ? "HIGH" : "NORMAL",
      dismissible: row.severity !== "CRITICAL",
      episode: "open",
      recipients: [row.assignedToMemberId ?? row.ownerMemberId ?? row.createdByMemberId],
    }));
  },
  async holds(companyId, _type, id) {
    return (await prisma.nonConformanceReport.count({ where: { id, companyId, status: { in: [...OPEN_NCR] } } })) > 0;
  },
};

const OPEN_ACTION = ["OPEN", "IN_PROGRESS", "REJECTED", "REOPENED"] as const;

const overdueQaAction: AttentionConditionDefinition = {
  key: "OVERDUE_QA_ACTION",
  moduleKey: "qaqc",
  async collect(companyId, now) {
    const rows = await prisma.correctiveAction.findMany({
      where: { companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: startOfDay(now) } },
      select: { id: true, actionNumber: true, title: true, projectId: true, dueDate: true, assignedToMemberId: true },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "corrective_action",
      entityId: row.id,
      projectId: row.projectId,
      title: `Corrective action ${row.actionNumber} is overdue`,
      body: row.title,
      priority: "HIGH",
      dismissible: true,
      episode: isoDate(row.dueDate!),
      recipients: [row.assignedToMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    return (await prisma.correctiveAction.count({ where: { id, companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: startOfDay(now) } } })) > 0;
  },
};

/* HSE ---------------------------------------------------------------------- */

const criticalHseItem: AttentionConditionDefinition = {
  key: "CRITICAL_HSE_ITEM",
  moduleKey: "hse",
  async collect(companyId) {
    const [hazards, incidents, stops] = await Promise.all([
      prisma.hseHazard.findMany({
        where: { companyId, riskLevel: "CRITICAL", status: { in: OPEN_HAZARD_STATUSES } },
        select: { id: true, hazardNumber: true, title: true, projectId: true, assignedToMemberId: true, reportedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
        take: LIMIT,
      }),
      prisma.hseIncident.findMany({
        where: { companyId, severity: "CRITICAL", status: { in: OPEN_INCIDENT_STATUSES } },
        select: { id: true, incidentNumber: true, title: true, projectId: true, investigatorMemberId: true, reportedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
        take: LIMIT,
      }),
      prisma.stopWorkRecord.findMany({
        where: { companyId, status: "ACTIVE" },
        select: { id: true, stopWorkNumber: true, title: true, projectId: true, issuedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
        take: LIMIT,
      }),
    ]);
    return [
      ...hazards.map((row): AttentionCandidate => ({
        entityType: "hazard",
        entityId: row.id,
        projectId: row.projectId,
        title: `Critical hazard ${row.hazardNumber} is open`,
        body: row.title,
        priority: "CRITICAL",
        dismissible: false,
        episode: "open",
        recipients: [row.assignedToMemberId ?? row.reportedByMemberId, row.project?.projectManagerMemberId],
      })),
      ...incidents.map((row): AttentionCandidate => ({
        entityType: "incident",
        entityId: row.id,
        projectId: row.projectId,
        title: `Critical incident ${row.incidentNumber} is open`,
        body: row.title,
        priority: "CRITICAL",
        dismissible: false,
        episode: "open",
        recipients: [row.investigatorMemberId ?? row.reportedByMemberId, row.project?.projectManagerMemberId],
        holders: ["hse.incident.investigate"],
      })),
      ...stops.map((row): AttentionCandidate => ({
        entityType: "stop_work",
        entityId: row.id,
        projectId: row.projectId,
        title: `Stop-work ${row.stopWorkNumber} is in force`,
        body: row.title,
        priority: "CRITICAL",
        dismissible: false,
        episode: "active",
        recipients: [row.issuedByMemberId, row.project.projectManagerMemberId],
        // Whoever may send people back to work has to know work has stopped.
        holders: ["hse.stop_work.release"],
      })),
    ];
  },
  async holds(companyId, type, id) {
    if (type === "hazard") {
      return (await prisma.hseHazard.count({ where: { id, companyId, riskLevel: "CRITICAL", status: { in: OPEN_HAZARD_STATUSES } } })) > 0;
    }
    if (type === "incident") {
      return (await prisma.hseIncident.count({ where: { id, companyId, severity: "CRITICAL", status: { in: OPEN_INCIDENT_STATUSES } } })) > 0;
    }
    if (type === "stop_work") {
      return (await prisma.stopWorkRecord.count({ where: { id, companyId, status: "ACTIVE" } })) > 0;
    }
    return false;
  },
};

const overdueHseAction: AttentionConditionDefinition = {
  key: "OVERDUE_HSE_ACTION",
  moduleKey: "hse",
  async collect(companyId, now) {
    const rows = await prisma.hseAction.findMany({
      where: { companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: startOfDay(now) } },
      select: { id: true, actionNumber: true, title: true, projectId: true, dueDate: true, priority: true, assignedToMemberId: true },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "hse_action",
      entityId: row.id,
      projectId: row.projectId,
      title: `HSE action ${row.actionNumber} is overdue`,
      body: row.title,
      priority: row.priority === "CRITICAL" ? "CRITICAL" : "HIGH",
      dismissible: row.priority !== "CRITICAL",
      episode: isoDate(row.dueDate!),
      recipients: [row.assignedToMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    return (await prisma.hseAction.count({ where: { id, companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: startOfDay(now) } } })) > 0;
  },
};

/* Finance ------------------------------------------------------------------ */

async function outstandingByInvoice(invoiceIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (invoiceIds.length === 0) return new Map();
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoiceIds }, status: "RECORDED" },
    _sum: { amount: true },
  });
  return new Map(paid.map((row) => [row.invoiceId!, row._sum.amount ?? new Prisma.Decimal(0)]));
}

const overdueInvoice: AttentionConditionDefinition = {
  key: "OVERDUE_INVOICE",
  moduleKey: "finance",
  async collect(companyId, now) {
    const rows = await prisma.invoice.findMany({
      where: { companyId, status: "SENT", archivedAt: null, dueDate: { lt: startOfDay(now) } },
      select: { id: true, invoiceNumber: true, projectId: true, dueDate: true, totalAmount: true, currency: true, createdByMemberId: true },
      take: LIMIT,
    });
    const paid = await outstandingByInvoice(rows.map((row) => row.id));
    return rows
      .filter((row) => row.totalAmount.minus(paid.get(row.id) ?? 0).greaterThan(0))
      .map((row) => ({
        entityType: "invoice",
        entityId: row.id,
        projectId: row.projectId,
        title: `Invoice ${row.invoiceNumber} is overdue`,
        body: `Due ${isoDate(row.dueDate)} · ${row.totalAmount.minus(paid.get(row.id) ?? 0).toFixed(2)} ${row.currency} outstanding`,
        priority: daysBetween(row.dueDate, now) > 30 ? "HIGH" : "NORMAL",
        dismissible: true,
        episode: isoDate(row.dueDate),
        recipients: [row.createdByMemberId],
        // The people who record the payment that ends it.
        holders: ["finance.payment.create"],
      }));
  },
  async holds(companyId, _type, id, now) {
    const row = await prisma.invoice.findFirst({
      where: { id, companyId, status: "SENT", archivedAt: null, dueDate: { lt: startOfDay(now) } },
      select: { totalAmount: true },
    });
    if (!row) return false;
    const paid = (await outstandingByInvoice([id])).get(id) ?? 0;
    return row.totalAmount.minus(paid).greaterThan(0);
  },
};

/* Meetings ----------------------------------------------------------------- */

/**
 * An action from a meeting past its due date (PRD #40 §79, §202), to its owner.
 * An action handed off to a task is left to the task's own overdue item, so
 * nobody is told twice about the same work.
 */
const meetingActionOverdue: AttentionConditionDefinition = {
  key: "MEETING_ACTION_OVERDUE",
  moduleKey: "meetings",
  async collect(companyId, now) {
    const rows = await prisma.meetingActionItem.findMany({
      where: {
        companyId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        linkedTaskId: null,
        ownerMemberId: { not: null },
        dueAt: { lt: startOfDay(now) },
        meeting: { archivedAt: null, status: { not: "CANCELLED" } },
      },
      select: { id: true, title: true, dueAt: true, ownerMemberId: true, meeting: { select: { id: true, title: true, projectId: true } } },
      take: LIMIT,
    });
    return rows.map((row) => ({
      entityType: "meeting",
      entityId: row.meeting.id,
      projectId: row.meeting.projectId,
      title: `Meeting action overdue: ${row.title}`,
      body: `From ${row.meeting.title} · due ${isoDate(row.dueAt!)}`,
      priority: "NORMAL",
      dismissible: true,
      episode: `${row.id}:${isoDate(row.dueAt!)}`,
      recipients: [row.ownerMemberId],
    }));
  },
  async holds(companyId, _type, id, now) {
    const count = await prisma.meetingActionItem.count({
      where: { companyId, meetingId: id, status: { in: ["OPEN", "IN_PROGRESS"] }, linkedTaskId: null, dueAt: { lt: startOfDay(now) } },
    });
    return count > 0;
  },
};

/* Registry ----------------------------------------------------------------- */

const DEFINITIONS: AttentionConditionDefinition[] = [
  overdueTask,
  pendingApproval,
  contractExpiring,
  overdueObligation,
  unresolvedNcr,
  overdueQaAction,
  criticalHseItem,
  overdueHseAction,
  overdueInvoice,
  procurementActionRequired,
  meetingActionOverdue,
  approvalOverdue,
  timesheetNotSubmitted,
  timesheetReturned,
  timesheetApprovalOverdue,
  dailyLogMissing,
  dailyLogReturned,
  dailyLogAwaitingReview,
  milestoneOverdue,
  milestoneAtRisk,
  criticalMilestoneBlocked,
  announcementAckRequired,
  complianceExpiring,
  complianceExpired,
  complianceMissing,
  rfiOverdue,
  rfiResponseRequired,
  submittalReviewOverdue,
  submittalRevisionRequired,
  engineeringReviewOverdue,
];

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

export function attentionConditionDefinitions(): AttentionConditionDefinition[] {
  return [...DEFINITIONS];
}

export function findAttentionCondition(key: string): AttentionConditionDefinition | undefined {
  return BY_KEY.get(key as AttentionConditionKey);
}

export function attentionDedupeKey(key: AttentionConditionKey, candidate: Pick<AttentionCandidate, "entityType" | "entityId" | "episode">): string {
  return `${key}:${candidate.entityType}:${candidate.entityId}:${candidate.episode}`;
}
