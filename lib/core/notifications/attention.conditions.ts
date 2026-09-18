import { Prisma } from "@prisma/client";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { RecordType } from "@/lib/core/records/record.types";
import { OPEN_HAZARD_STATUSES, OPEN_INCIDENT_STATUSES } from "@/lib/modules/hse/hse.status";
import { companyDays } from "./company-day";

/**
 * Attention conditions (PRD #38 §83-§85).
 *
 * An attention item is a condition that is true right now — overdue, waiting,
 * expiring, critical — addressed to the people who can act on it. Each
 * condition answers two questions about one company:
 *
 *   page     which records are in the condition, a bounded page at a time,
 *            and who should hear about each (explicit members, or everybody
 *            holding a permission)
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
  // Employee documents and qualifications (E-02 §149, §153, §154).
  "EMPLOYEE_DOCUMENT_EXPIRING",
  "EMPLOYEE_DOCUMENT_EXPIRED",
  "EMPLOYEE_DOCUMENT_UNVERIFIED",
  "QUALIFICATION_EXPIRING",
  "QUALIFICATION_EXPIRED",
  "QUALIFICATION_UNVERIFIED",
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

/** One page of a condition, and where the next one starts — null once the condition has been read to its end. */
export type AttentionPage = { candidates: AttentionCandidate[]; next: string | null };

export type AttentionConditionDefinition = {
  key: AttentionConditionKey;
  moduleKey: ModuleKey;
  /**
   * For a condition whose record is not its subject — a missing daily log is
   * filed against its project, because there is no log to point at — opening
   * the record is not enough. Every recipient must also reach the condition's
   * own module and hold all of these, when the item is written and again
   * whenever it is shown (PRD #47 §26, §77).
   */
  readerPermissions?: Permission[];
  /**
   * One page of the records in the condition, `cursor` null for the first
   * (PRD #51 §133-§135). What the reconciler reads: a company with ten
   * thousand overdue tasks is walked through, never cut off at a round number.
   */
  page(companyId: string, now: Date, cursor: string | null, size: number): Promise<AttentionPage>;
  /** Every candidate at once, page after page — for a caller asking about a company's handful, not for the reconciler. */
  collect(companyId: string, now: Date): Promise<AttentionCandidate[]>;
  holds(companyId: string, entityType: string, entityId: string, now: Date): Promise<boolean>;
};

/** Whether this reader passes a condition's own module and permission floor, beyond the record. */
export function readerAllowed(
  context: Pick<UserContext, "permissions" | "moduleAccess">,
  condition: Pick<AttentionConditionDefinition, "moduleKey" | "readerPermissions">,
): boolean {
  if (!condition.readerPermissions) return true;
  const access = context.moduleAccess[condition.moduleKey];
  if (!access?.enabled || access.accessLevel === "NONE") return false;
  return condition.readerPermissions.every((permission) => can(context, permission));
}

/** Whether the company has a switchable module turned on — a condition about it is not raised otherwise. */
async function companyModuleEnabled(companyId: string, moduleKey: ModuleKey): Promise<boolean> {
  return (await prisma.company.count({ where: { id: companyId, modules: { some: { enabled: true, module: { key: moduleKey } } } } })) > 0;
}

/** How many rows a condition reads at a time (PRD #51 §133, §134). */
export const ATTENTION_PAGE_SIZE = 200;
const DAY_MS = 86_400_000;

/* Paging ------------------------------------------------------------------- */

/**
 * Where a query's page starts, and how many rows it may read. A module whose
 * query answers a condition takes one to be walked page by page.
 */
export type AttentionRowPage = { after?: string; take: number };

/** A page of a query that filters or groups what it read: what it kept, and the id to start after next — null at the end. */
export type AttentionRows<Row> = { rows: Row[]; next: string | null };

/** One query of a condition, read a page at a time: the candidates the page makes, and where the next page starts. */
type AttentionSource = (companyId: string, now: Date, page: AttentionRowPage) => Promise<{ candidates: AttentionCandidate[]; next: string | null }>;

/**
 * A query and what its rows mean, as one pageable source.
 *
 * The cursor is the row's id, never a date or a status: a record that stays in
 * the condition while a pass walks it is read exactly once, however its due
 * date or priority moves in the meantime. The position comes from the rows
 * read, not the candidates made from them — a page of paid invoices yields no
 * candidate and still moves the cursor on.
 */
function source<Row extends { id: string }>(
  read: (companyId: string, now: Date, page: AttentionRowPage) => Promise<Row[]>,
  candidates: (rows: Row[], companyId: string, now: Date) => AttentionCandidate[] | Promise<AttentionCandidate[]>,
): AttentionSource {
  return rowsSource(async (companyId, now, page) => {
    const rows = await read(companyId, now, page);
    return { rows, next: rows.length === page.take ? rows[rows.length - 1].id : null };
  }, candidates);
}

/** A source over a query that keeps fewer rows than it reads, and so says itself where its next page starts. */
function rowsSource<Row>(
  read: (companyId: string, now: Date, page: AttentionRowPage) => Promise<AttentionRows<Row>>,
  candidates: (rows: Row[], companyId: string, now: Date) => AttentionCandidate[] | Promise<AttentionCandidate[]>,
): AttentionSource {
  return async (companyId, now, page) => {
    const { rows, next } = await read(companyId, now, page);
    return { candidates: rows.length > 0 ? await candidates(rows, companyId, now) : [], next };
  };
}

/** The `where` that starts a query after the page's last row. */
const after = (page: AttentionRowPage) => (page.after ? { id: { gt: page.after } } : {});
/** The order and size that make a query a page. */
const byId = (page: AttentionRowPage) => ({ orderBy: { id: "asc" as const }, take: page.take });

/**
 * Reads the next page of a condition made of several queries, one query after
 * another. The cursor is `<query index>:<last id>`.
 */
async function readSources(sources: AttentionSource[], companyId: string, now: Date, cursor: string | null, size: number): Promise<AttentionPage> {
  const split = cursor?.indexOf(":") ?? -1;
  let index = cursor && split >= 0 ? Number(cursor.slice(0, split)) : 0;
  let afterId = cursor && split >= 0 ? cursor.slice(split + 1) || undefined : undefined;
  for (; index < sources.length; index += 1, afterId = undefined) {
    const read = await sources[index](companyId, now, { after: afterId, take: size });
    if (read.next !== null) return { candidates: read.candidates, next: `${index}:${read.next}` };
    if (read.candidates.length > 0) return { candidates: read.candidates, next: index + 1 < sources.length ? `${index + 1}:` : null };
  }
  return { candidates: [], next: null };
}

type ConditionBase = Pick<AttentionConditionDefinition, "key" | "moduleKey" | "readerPermissions" | "holds">;

/** A condition read through its queries: every record in it, a page at a time. */
function paged({ sources, ...base }: ConditionBase & { sources: AttentionSource[] }): AttentionConditionDefinition {
  const page = (companyId: string, now: Date, cursor: string | null, size: number) => readSources(sources, companyId, now, cursor, size);
  return {
    ...base,
    page,
    async collect(companyId, now) {
      const all: AttentionCandidate[] = [];
      let cursor: string | null = null;
      do {
        const next: AttentionPage = await page(companyId, now, cursor, ATTENTION_PAGE_SIZE);
        all.push(...next.candidates);
        cursor = next.next;
      } while (cursor !== null);
      return all;
    },
  };
}

/**
 * The start of the company's today, as stored dates compare: something due
 * today is not overdue until the company's tomorrow, whatever the server's
 * clock says (PRD #51 §48, §159) — the same day `notifications.due` and
 * `approvals.overdue` remind on.
 */
async function startOfDay(companyId: string, now: Date): Promise<Date> {
  return (await companyDays(companyId))(now).start;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/* Tasks -------------------------------------------------------------------- */

const OPEN_TASK: Prisma.TaskWhereInput = { archivedAt: null, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } };

const overdueTask = paged({
  key: "OVERDUE_TASK",
  moduleKey: "tasks",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.task.findMany({
          where: { companyId, ...OPEN_TASK, dueDate: { lt: await startOfDay(companyId, now) }, ...after(page) },
          select: { id: true, title: true, projectId: true, dueDate: true, assigneeMemberId: true, createdByMemberId: true },
          ...byId(page),
        }),
      (rows, _companyId, now) =>
        rows.map((row): AttentionCandidate => ({
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
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    return (await prisma.task.count({ where: { id, companyId, ...OPEN_TASK, dueDate: { lt: await startOfDay(companyId, now) } } })) > 0;
  },
});

/* Approvals ---------------------------------------------------------------- */

type PendingApproval = { recordType: string; recordId: string; submittedByMemberId: string; id: string };

type ApprovalSource = {
  moduleKey: ModuleKey;
  load(companyId: string, page: AttentionRowPage): Promise<PendingApproval[]>;
  count(companyId: string, recordTypes: string[], recordId: string): Promise<number>;
  records: Record<string, { entityType: RecordType; noun: string; holders: Permission[] }>;
};

const pendingWhere = (companyId: string) => ({ companyId, status: "PENDING" as const });
const approvalSelect = { id: true, recordType: true, recordId: true, submittedByMemberId: true } as const;

const APPROVAL_SOURCES: ApprovalSource[] = [
  {
    moduleKey: "finance",
    load: (companyId, page) => prisma.financeApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
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
    load: (companyId, page) => prisma.salesApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
    count: (companyId, types, recordId) =>
      prisma.salesApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: { PROPOSAL: { entityType: "proposal", noun: "Proposal", holders: ["sales.proposal.approve"] } },
  },
  {
    // Units waiting to be published (E-05D §21).
    moduleKey: "projects",
    load: (companyId, page) => prisma.unitPublicationApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
    count: (companyId, types, recordId) =>
      prisma.unitPublicationApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: { UNIT: { entityType: "project_unit", noun: "Unit", holders: ["project.unit.publish"] } },
  },
  {
    moduleKey: "contracts",
    load: (companyId, page) => prisma.contractApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
    count: (companyId, types, recordId) =>
      prisma.contractApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      CONTRACT: { entityType: "contract", noun: "Contract", holders: ["legal.approval.decide", "legal.contract.approve"] },
      AMENDMENT: { entityType: "amendment", noun: "Amendment", holders: ["legal.approval.decide", "legal.amendment.approve"] },
    },
  },
  {
    moduleKey: "qaqc",
    load: (companyId, page) => prisma.qualityApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
    count: (companyId, types, recordId) =>
      prisma.qualityApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
    records: {
      INSPECTION: { entityType: "quality_inspection", noun: "Inspection", holders: ["qaqc.inspection.approve"] },
      NCR: { entityType: "non_conformance_report", noun: "NCR", holders: ["qaqc.ncr.approve"] },
    },
  },
  {
    moduleKey: "hse",
    load: (companyId, page) => prisma.hseApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
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
  load: (companyId, page) => prisma.procurementApproval.findMany({ where: { ...pendingWhere(companyId), ...after(page) }, select: approvalSelect, ...byId(page) }),
  count: (companyId, types, recordId) =>
    prisma.procurementApproval.count({ where: { ...pendingWhere(companyId), recordId, recordType: { in: types as never } } }),
  records: {
    PURCHASE_REQUEST: { entityType: "purchase_request", noun: "Purchase request", holders: ["procurement.request.approve"] },
    PURCHASE_ORDER: { entityType: "purchase_order", noun: "Purchase order", holders: ["procurement.order.approve"] },
  },
};

function approvalCandidates(source: ApprovalSource, approvals: PendingApproval[], verb: string): AttentionCandidate[] {
  return approvals.flatMap((approval): AttentionCandidate[] => {
    const record = source.records[approval.recordType];
    if (!record) return [];
    return [{
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
    }];
  });
}

const approvalSource = (approvals: ApprovalSource, verb: string) =>
  source(
    (companyId, _now, page) => approvals.load(companyId, page),
    (rows) => approvalCandidates(approvals, rows, verb),
  );

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
const ASSIGNED_APPROVAL_SOURCES: AttentionSource[] = [
  source(
    (companyId, _now, page) =>
      prisma.documentReview.findMany({
        where: { companyId, status: "PENDING", ...after(page) },
        select: { id: true, documentId: true, reviewerMemberId: true, requestedByMemberId: true, version: { select: { versionNumber: true, document: { select: { name: true, projectId: true } } } } },
        ...byId(page),
      }),
    (rows) =>
      rows.map((row): AttentionCandidate => ({
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
  ),
  source(
    (companyId, _now, page) =>
      prisma.leaveRequest.findMany({
        where: { companyId, status: "PENDING", ...after(page) },
        select: { id: true, companyMemberId: true, submittedAt: true, startDate: true },
        ...byId(page),
      }),
    (rows) =>
      rows.map((row): AttentionCandidate => ({
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
        exclude: row.companyMemberId ? [row.companyMemberId] : [],
      })),
  ),
  // A week goes to its one designated approver (PRD #42 §73).
  source(
    (companyId, _now, page) =>
      prisma.timesheetApproval.findMany({
        where: { companyId, status: "PENDING", ...after(page) },
        select: { id: true, recordId: true, approverMemberId: true, submittedByMemberId: true },
        ...byId(page),
      }),
    async (rows, companyId) => {
      const weeks = await prisma.timesheet.findMany({
        where: { companyId, id: { in: rows.map((row) => row.recordId) } },
        select: { id: true, periodStart: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } },
      });
      const weekById = new Map(weeks.map((row) => [row.id, row]));
      return rows.flatMap((row): AttentionCandidate[] => {
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
      });
    },
  ),
];

const pendingApproval = paged({
  key: "PENDING_APPROVAL",
  moduleKey: "dashboard",
  sources: [...APPROVAL_SOURCES.map((approvals) => approvalSource(approvals, "waiting for your approval")), ...ASSIGNED_APPROVAL_SOURCES],
  async holds(companyId, type, id) {
    if (type === "document") return (await prisma.documentReview.count({ where: { companyId, documentId: id, status: "PENDING" } })) > 0;
    if (type === "leave_request") return (await prisma.leaveRequest.count({ where: { companyId, id, status: "PENDING" } })) > 0;
    if (type === "timesheet") return (await prisma.timesheet.count({ where: { companyId, id, status: "SUBMITTED" } })) > 0;
    return approvalHolds(APPROVAL_SOURCES, companyId, type, id);
  },
});

/**
 * Procurement decisions, following the chain where an order has one (PRD #41
 * §21): the current step's approvers are told — a permission, or the members
 * of a role — and nobody who submitted it or already decided a step.
 */
const procurementActionRequired = paged({
  key: "PROCUREMENT_ACTION_REQUIRED",
  moduleKey: "procurement",
  sources: [
    source(
      (companyId, _now, page) => PROCUREMENT_SOURCE.load(companyId, page),
      async (rows, companyId) => {
        const candidates = approvalCandidates(PROCUREMENT_SOURCE, rows, "needs a procurement decision");
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
    ),
  ],
  holds: (companyId, type, id) => approvalHolds([PROCUREMENT_SOURCE], companyId, type, id),
});

/**
 * Approvals past a real deadline (PRD #41 §36, §37, §39, §228): a review past
 * its due date, leave whose first day has come, a proposal past its validity,
 * a permit past its start. Only sources that have such a date appear; nothing
 * is given a deadline it does not have.
 */
const approvalOverdue = paged({
  key: "APPROVAL_OVERDUE",
  moduleKey: "approvals",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.documentReview.findMany({
          where: { companyId, status: "PENDING", dueAt: { lt: await startOfDay(companyId, now) }, ...after(page) },
          select: { id: true, documentId: true, reviewerMemberId: true, dueAt: true, version: { select: { document: { select: { name: true, projectId: true } } } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "document", entityId: row.documentId, projectId: row.version.document.projectId,
          title: `Overdue review: “${row.version.document.name}”`, body: `Due ${isoDate(row.dueAt!)}`,
          priority: "HIGH", dismissible: true, episode: `${row.id}:${isoDate(row.dueAt!)}`, recipients: [row.reviewerMemberId],
        })),
    ),
    source(
      async (companyId, now, page) =>
        prisma.leaveRequest.findMany({ where: { companyId, status: "PENDING", startDate: { lt: await startOfDay(companyId, now) }, ...after(page) }, select: { id: true, companyMemberId: true, startDate: true }, ...byId(page) }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "leave_request", entityId: row.id, projectId: null,
          title: "Leave began without a decision", body: `Started ${isoDate(row.startDate)}`,
          priority: "HIGH", dismissible: true, episode: isoDate(row.startDate), recipients: [], holders: ["hr.leave.approve"], exclude: row.companyMemberId ? [row.companyMemberId] : [],
        })),
    ),
    source(
      async (companyId, now, page) =>
        prisma.proposal.findMany({ where: { companyId, status: "PENDING_APPROVAL", validUntil: { lt: await startOfDay(companyId, now) }, ...after(page) }, select: { id: true, proposalNumber: true, validUntil: true, createdByMemberId: true }, ...byId(page) }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "proposal", entityId: row.id, projectId: null,
          title: `Proposal ${row.proposalNumber} lapsed while waiting for approval`, body: `Valid until ${isoDate(row.validUntil!)}`,
          priority: "HIGH", dismissible: true, episode: isoDate(row.validUntil!), recipients: [], holders: ["sales.proposal.approve"], exclude: [row.createdByMemberId],
        })),
    ),
    source(
      async (companyId, now, page) =>
        prisma.hseWorkPermit.findMany({ where: { companyId, status: "PENDING_APPROVAL", validFrom: { lt: await startOfDay(companyId, now) }, ...after(page) }, select: { id: true, permitNumber: true, projectId: true, validFrom: true, requestedByMemberId: true }, ...byId(page) }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "work_permit", entityId: row.id, projectId: row.projectId,
          title: `Permit ${row.permitNumber} was due to start without approval`, body: `From ${isoDate(row.validFrom)}`,
          priority: "CRITICAL", dismissible: true, episode: isoDate(row.validFrom), recipients: [], holders: ["hse.permit.approve"], exclude: [row.requestedByMemberId],
        })),
    ),
  ],
  async holds(companyId, type, id, now) {
    const today = await startOfDay(companyId, now);
    if (type === "document") return (await prisma.documentReview.count({ where: { companyId, documentId: id, status: "PENDING", dueAt: { lt: today } } })) > 0;
    if (type === "leave_request") return (await prisma.leaveRequest.count({ where: { companyId, id, status: "PENDING", startDate: { lt: today } } })) > 0;
    if (type === "proposal") return (await prisma.proposal.count({ where: { companyId, id, status: "PENDING_APPROVAL", validUntil: { lt: today } } })) > 0;
    if (type === "work_permit") return (await prisma.hseWorkPermit.count({ where: { companyId, id, status: "PENDING_APPROVAL", validFrom: { lt: today } } })) > 0;
    return false;
  },
});

/* Timesheets (PRD #42 §103, §213, §214) ------------------------------------ */

/** A week still undecided this long after it was submitted is overdue for its approver. */
export const TIMESHEET_APPROVAL_OVERDUE_DAYS = 3;

/**
 * A week not submitted once its deadline has passed — only where the company
 * set a deadline, and only the latest week due. The reminder job creates the
 * empty week of anybody who logged nothing, so there is always a week to open.
 */
const timesheetNotSubmitted = paged({
  key: "TIMESHEET_NOT_SUBMITTED",
  moduleKey: "timesheets",
  sources: [
    source(
      async (companyId, now, page) => {
        const { lastDueWeek } = await import("@/lib/modules/timesheets/timesheet.deadline");
        const { resolveTimesheetSettings } = await import("@/lib/modules/timesheets/timesheet.settings");
        const { businessInstant } = await import("@/lib/modules/timesheets/timesheet.time");
        const week = lastDueWeek(now, await resolveTimesheetSettings(companyId));
        if (!week) return [];
        const rows = await prisma.timesheet.findMany({
          where: { companyId, periodStart: businessInstant(week), status: "DRAFT", member: { status: "ACTIVE" }, ...after(page) },
          select: { id: true, memberId: true },
          ...byId(page),
        });
        return rows.map((row) => ({ ...row, week }));
      },
      async (rows) => {
        const { weekLabel } = await import("@/lib/modules/timesheets/timesheet.time");
        return rows.map((row): AttentionCandidate => ({
          entityType: "timesheet", entityId: row.id, projectId: null,
          title: `Submit your timesheet for ${weekLabel(row.week)}`, body: "The submission deadline has passed.",
          priority: "HIGH", dismissible: true, episode: row.week, recipients: [row.memberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "timesheet") return false;
    const { lastDueWeek } = await import("@/lib/modules/timesheets/timesheet.deadline");
    const { resolveTimesheetSettings } = await import("@/lib/modules/timesheets/timesheet.settings");
    const { businessInstant } = await import("@/lib/modules/timesheets/timesheet.time");
    const week = lastDueWeek(now, await resolveTimesheetSettings(companyId));
    if (!week) return false;
    return (await prisma.timesheet.count({ where: { companyId, id, status: "DRAFT", periodStart: { lte: businessInstant(week) } } })) > 0;
  },
});

/** A week sent back to its member, until they submit it again (§64, §65, §214). */
const timesheetReturned = paged({
  key: "TIMESHEET_RETURNED",
  moduleKey: "timesheets",
  sources: [
    source(
      (companyId, _now, page) =>
        prisma.timesheet.findMany({
          where: { companyId, status: { in: ["RETURNED", "REJECTED"] }, member: { status: "ACTIVE" }, ...after(page) },
          select: { id: true, memberId: true, status: true, periodStart: true, returnedAt: true, rejectedAt: true, submissionVersion: true },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "timesheet", entityId: row.id, projectId: null,
          title: row.status === "REJECTED" ? "Your timesheet was rejected" : "Your timesheet was returned for correction",
          body: `Week of ${isoDate(row.periodStart)}`,
          priority: "HIGH", dismissible: true,
          episode: `${row.status}:${(row.status === "REJECTED" ? row.rejectedAt : row.returnedAt)?.toISOString() ?? row.submissionVersion}`,
          recipients: [row.memberId],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    return type === "timesheet" && (await prisma.timesheet.count({ where: { companyId, id, status: { in: ["RETURNED", "REJECTED"] } } })) > 0;
  },
});

/** A submitted week its approver has not decided in time (§213). */
const timesheetApprovalOverdue = paged({
  key: "TIMESHEET_APPROVAL_OVERDUE",
  moduleKey: "timesheets",
  sources: [
    source(
      (companyId, now, page) =>
        prisma.timesheetApproval.findMany({
          where: { companyId, status: "PENDING", submittedAt: { lt: new Date(now.getTime() - TIMESHEET_APPROVAL_OVERDUE_DAYS * DAY_MS) }, ...after(page) },
          select: { id: true, recordId: true, approverMemberId: true, submittedByMemberId: true, submittedAt: true },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "timesheet", entityId: row.recordId, projectId: null,
          title: "A timesheet has waited for your decision for over three days", body: `Submitted ${isoDate(row.submittedAt)}`,
          priority: "HIGH", dismissible: true, episode: row.id, recipients: [row.approverMemberId], exclude: [row.submittedByMemberId],
        })),
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "timesheet") return false;
    const before = new Date(now.getTime() - TIMESHEET_APPROVAL_OVERDUE_DAYS * DAY_MS);
    return (await prisma.timesheetApproval.count({ where: { companyId, recordId: id, status: "PENDING", submittedAt: { lt: before } } })) > 0;
  },
});

/* Daily logs (PRD #43 §103-§109) -------------------------------------------- */

/**
 * No log for a required project's last working day. About the project, since
 * there is no log to point at; one item per project per day, for its manager.
 */
const dailyLogMissing = paged({
  key: "DAILY_LOG_MISSING",
  moduleKey: "dailyLogs",
  // The item points at a project, which a manager can open without Daily Logs:
  // the module and the grant to read logs are asked for separately.
  readerPermissions: ["daily_log.view"],
  sources: [
    // One page: Daily Logs walks every required project itself, and a company
    // has one missing log per project at most.
    rowsSource(
      async (companyId, now) => {
        // A company that has switched Daily Logs off is not missing any.
        if (!(await companyModuleEnabled(companyId, "dailyLogs"))) return { rows: [], next: null };
        const { missingYesterday } = await import("@/lib/modules/daily-logs/daily-log.reports");
        return { rows: await missingYesterday(companyId, now), next: null };
      },
      async (rows) => {
        const { dateLabel } = await import("@/lib/modules/daily-logs/daily-log.time");
        return rows.map((row): AttentionCandidate => ({
          entityType: "project", entityId: row.projectId, projectId: row.projectId,
          title: `No daily log for ${row.projectName}`, body: dateLabel(row.date),
          priority: "NORMAL", dismissible: true, episode: row.date, recipients: [row.projectManagerMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "project" || !(await companyModuleEnabled(companyId, "dailyLogs"))) return false;
    const { missingYesterday } = await import("@/lib/modules/daily-logs/daily-log.reports");
    return (await missingYesterday(companyId, now)).some((row) => row.projectId === id);
  },
});

/** A log sent back to its authors, until they submit it again. */
const dailyLogReturned = paged({
  key: "DAILY_LOG_RETURNED",
  moduleKey: "dailyLogs",
  sources: [
    source(
      (companyId, _now, page) =>
        prisma.dailyLog.findMany({
          where: { companyId, status: "CORRECTION_REQUIRED", ...after(page) },
          select: { id: true, projectId: true, workDate: true, returnedAt: true, createdByMemberId: true, submittedByMemberId: true, project: { select: { name: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "daily_log", entityId: row.id, projectId: row.projectId,
          title: `Daily log for ${row.project.name} needs correcting`, body: `Work date ${isoDate(row.workDate)}`,
          priority: "HIGH", dismissible: true, episode: row.returnedAt?.toISOString() ?? "returned", recipients: [row.createdByMemberId, row.submittedByMemberId],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    return type === "daily_log" && (await prisma.dailyLog.count({ where: { companyId, id, status: "CORRECTION_REQUIRED" } })) > 0;
  },
});

/** A submitted log waiting for its reviewer — never the person who submitted it. */
const dailyLogAwaitingReview = paged({
  key: "DAILY_LOG_AWAITING_REVIEW",
  moduleKey: "dailyLogs",
  sources: [
    source(
      (companyId, _now, page) =>
        prisma.dailyLog.findMany({
          where: { companyId, status: "SUBMITTED", ...after(page) },
          select: { id: true, projectId: true, workDate: true, submittedAt: true, reviewerMemberId: true, submittedByMemberId: true, project: { select: { name: true, projectManagerMemberId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "daily_log", entityId: row.id, projectId: row.projectId,
          title: `Review the daily log for ${row.project.name}`, body: `Work date ${isoDate(row.workDate)}`,
          priority: "NORMAL", dismissible: true, episode: row.submittedAt?.toISOString() ?? "submitted",
          recipients: [row.reviewerMemberId ?? row.project.projectManagerMemberId], exclude: row.submittedByMemberId ? [row.submittedByMemberId] : [],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    return type === "daily_log" && (await prisma.dailyLog.count({ where: { companyId, id, status: "SUBMITTED" } })) > 0;
  },
});

/* Project planning (PRD #44 §72-§74, §157, §215) ---------------------------- */

/** An open milestone past its target date, for its owner and the project manager. */
const milestoneOverdue = paged({
  key: "MILESTONE_OVERDUE",
  moduleKey: "projects",
  sources: [
    rowsSource(
      async (companyId, now, page) => {
        const { overdueMilestonePage } = await import("@/lib/modules/project-planning/planning.attention");
        return overdueMilestonePage(companyId, now, page);
      },
      async (rows) => {
        const { dateLabel } = await import("@/lib/modules/project-planning/planning.dates");
        return rows.map((row): AttentionCandidate => ({
          entityType: "project_milestone", entityId: row.id, projectId: row.projectId,
          title: `Milestone overdue: ${row.name}`, body: `${row.project.name} · due ${dateLabel(row.target)}`,
          priority: row.critical ? "HIGH" : "NORMAL", dismissible: true,
          // A new forecast is a new episode: dismissing one date never hides the next.
          episode: row.target ?? "overdue",
          recipients: [row.ownerMemberId, row.project.projectManagerMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "project_milestone") return false;
    const { overdueMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await overdueMilestones(companyId, now, id)).length > 0;
  },
});

/** A milestone somebody marked at risk, until its status moves on. */
const milestoneAtRisk = paged({
  key: "MILESTONE_AT_RISK",
  moduleKey: "projects",
  sources: [
    source(
      async (companyId, _now, page) => {
        const { atRiskMilestones } = await import("@/lib/modules/project-planning/planning.attention");
        return atRiskMilestones(companyId, undefined, page);
      },
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "project_milestone", entityId: row.id, projectId: row.projectId,
          title: `Milestone at risk: ${row.name}`, body: row.project.name,
          priority: row.critical ? "HIGH" : "NORMAL", dismissible: true,
          episode: (row.statusChangedAt ?? row.createdAt).toISOString(),
          recipients: [row.ownerMemberId, row.project.projectManagerMemberId],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    if (type !== "project_milestone") return false;
    const { atRiskMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await atRiskMilestones(companyId, id)).length > 0;
  },
});

/** An open critical blocker on a milestone still to be achieved. */
const criticalMilestoneBlocked = paged({
  key: "CRITICAL_MILESTONE_BLOCKED",
  moduleKey: "projects",
  sources: [
    rowsSource(
      async (companyId, _now, page) => {
        const { criticallyBlockedMilestonePage } = await import("@/lib/modules/project-planning/planning.attention");
        return criticallyBlockedMilestonePage(companyId, page);
      },
      (rows) =>
        rows.map(({ milestone, first, owners, count }): AttentionCandidate => ({
          entityType: "project_milestone", entityId: milestone.id, projectId: milestone.projectId,
          title: `Critical blocker on ${milestone.name}`, body: count > 1 ? `${first.title} and ${count - 1} more · ${milestone.project.name}` : `${first.title} · ${milestone.project.name}`,
          priority: "HIGH", dismissible: true, episode: first.id,
          recipients: [milestone.ownerMemberId, milestone.project.projectManagerMemberId, ...owners],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    if (type !== "project_milestone") return false;
    const { criticallyBlockedMilestones } = await import("@/lib/modules/project-planning/planning.attention");
    return (await criticallyBlockedMilestones(companyId, id)).length > 0;
  },
});

/* Announcements (PRD #45 §47, §282, §283) ----------------------------------- */

/**
 * An important or critical announcement waiting for acknowledgment, for each
 * target who has not given it. A critical one cannot be waved away; an
 * acknowledgment or the announcement ending resolves it.
 */
const announcementAckRequired = paged({
  key: "ANNOUNCEMENT_ACK_REQUIRED",
  moduleKey: "announcements",
  sources: [
    source(
      (companyId, now, page) =>
        prisma.announcement.findMany({
          where: { companyId, status: "PUBLISHED", requiresAcknowledgment: true, priority: { in: ["IMPORTANT", "CRITICAL"] }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], ...after(page) },
          select: { id: true, title: true, priority: true, projectId: true, publishedAt: true, targets: { select: { memberId: true } }, acknowledgments: { select: { memberId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => {
          const acknowledged = new Set(row.acknowledgments.map((entry) => entry.memberId));
          return {
            entityType: "announcement", entityId: row.id, projectId: row.projectId,
            title: `Acknowledge: ${row.title}`, body: row.priority === "CRITICAL" ? "Critical announcement" : "Important announcement",
            priority: row.priority === "CRITICAL" ? "CRITICAL" : "HIGH", dismissible: row.priority !== "CRITICAL",
            episode: row.publishedAt?.toISOString() ?? "published",
            recipients: row.targets.map((target) => target.memberId).filter((memberId) => !acknowledged.has(memberId)),
          };
        }),
    ),
  ],
  async holds(companyId, type, id, now) {
    return type === "announcement" && (await prisma.announcement.count({ where: { companyId, id, status: "PUBLISHED", requiresAcknowledgment: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } })) > 0;
  },
});

/* Contractors and engineering (PRD #46 §45, §95, §107, §197-§199) ---------- */

/**
 * A compliance item expiring, expired or missing, for the people who keep
 * compliance and the managers of the contractor's live projects. Expired
 * cannot be waved away; renewing, waiving or archiving the item resolves it.
 */
function complianceCondition(key: "CONTRACTOR_COMPLIANCE_EXPIRING" | "CONTRACTOR_COMPLIANCE_EXPIRED" | "CONTRACTOR_COMPLIANCE_MISSING", status: "EXPIRING" | "EXPIRED" | "MISSING"): AttentionConditionDefinition {
  return paged({
    key,
    moduleKey: "contractors",
    sources: [
      source(
        async (companyId, _now, page) => {
          const { complianceInStatus } = await import("@/lib/modules/contractors/contractor.compliance");
          return complianceInStatus(companyId, status, undefined, page);
        },
        async (rows, companyId) => {
          const { complianceRecipients } = await import("@/lib/modules/contractors/contractor.compliance");
          const { dateLabel } = await import("@/lib/modules/project-planning/planning.dates");
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
      ),
    ],
    async holds(companyId, type, id) {
      if (type !== "contractor_compliance") return false;
      const { complianceInStatus } = await import("@/lib/modules/contractors/contractor.compliance");
      return (await complianceInStatus(companyId, status, id)).length > 0;
    },
  });
}

/**
 * An employee document or qualification expiring within 30 days, past its
 * date, or waiting to be checked (E-02 §149, §153, §154). HR's verifiers hear
 * of all three; the person, of their own deadlines where they may see the
 * record — never asked to check their own (§74). Renewing it ends the
 * condition, and the item with it (§91, §194).
 */
function credentialCondition(key: AttentionConditionKey, kind: "employee_document" | "person_qualification", condition: "EXPIRING" | "EXPIRED" | "UNVERIFIED"): AttentionConditionDefinition {
  const verifier = kind === "employee_document" ? "hr.document.verify" : "hr.qualification.verify";
  const rows = async (companyId: string, now: Date, id?: string, page?: AttentionRowPage) => {
    const { documentsInCondition, qualificationsInCondition } = await import("@/lib/modules/hr/credentials/credential.expiry");
    return (kind === "employee_document" ? documentsInCondition : qualificationsInCondition)(companyId, condition, now, id, page);
  };
  return paged({
    key,
    moduleKey: kind === "employee_document" ? "hr" : "people",
    sources: [
      source(
        (companyId, now, page) => rows(companyId, now, undefined, page),
        async (found) => {
          const { credentialDateLabel } = await import("@/lib/modules/hr/credentials/credential.expiry");
          return found.map((row): AttentionCandidate => ({
            entityType: kind, entityId: row.id, projectId: null,
            title: `${condition === "UNVERIFIED" ? "To verify" : condition === "EXPIRED" ? "Expired" : "Expiring"}: ${row.label} · ${row.personName}`,
            body: row.expiresAt ? `${condition === "EXPIRED" ? "Expired" : "Expires"} ${credentialDateLabel(row.expiresAt)}` : null,
            priority: condition === "EXPIRED" ? "HIGH" : "NORMAL", dismissible: condition !== "EXPIRED",
            episode: row.episode,
            recipients: [row.selfMemberId],
            holders: [verifier],
            exclude: condition === "UNVERIFIED" ? row.ownMemberIds : [],
          }));
        },
      ),
    ],
    async holds(companyId, type, id, now) {
      if (type !== kind) return false;
      return (await rows(companyId, now, id)).length > 0;
    },
  });
}

const documentExpiring = credentialCondition("EMPLOYEE_DOCUMENT_EXPIRING", "employee_document", "EXPIRING");
const documentExpired = credentialCondition("EMPLOYEE_DOCUMENT_EXPIRED", "employee_document", "EXPIRED");
const documentUnverified = credentialCondition("EMPLOYEE_DOCUMENT_UNVERIFIED", "employee_document", "UNVERIFIED");
const qualificationExpiring = credentialCondition("QUALIFICATION_EXPIRING", "person_qualification", "EXPIRING");
const qualificationExpired = credentialCondition("QUALIFICATION_EXPIRED", "person_qualification", "EXPIRED");
const qualificationUnverified = credentialCondition("QUALIFICATION_UNVERIFIED", "person_qualification", "UNVERIFIED");

const complianceExpiring = complianceCondition("CONTRACTOR_COMPLIANCE_EXPIRING", "EXPIRING");
const complianceExpired = complianceCondition("CONTRACTOR_COMPLIANCE_EXPIRED", "EXPIRED");
const complianceMissing = complianceCondition("CONTRACTOR_COMPLIANCE_MISSING", "MISSING");

/** An RFI past its due date without an answer, for its assignee and whoever raised it. */
const rfiOverdue = paged({
  key: "RFI_OVERDUE",
  moduleKey: "engineering",
  sources: [
    source(
      async (companyId, now, page) => {
        const { overdueRfis } = await import("@/lib/modules/engineering/engineering.attention");
        return overdueRfis(companyId, now, undefined, page);
      },
      async (rows) => {
        const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
        return rows.map((row): AttentionCandidate => ({
          entityType: "rfi", entityId: row.id, projectId: row.projectId,
          title: `RFI overdue: ${row.rfiNumber}`, body: `${row.subject} · ${row.project.name} · due ${dateLabel(dateOf(row.dueAt))}`,
          priority: row.priority === "CRITICAL" || row.priority === "HIGH" ? "HIGH" : "NORMAL", dismissible: true,
          episode: dateOf(row.dueAt) ?? "overdue",
          recipients: [row.assignedToMemberId, row.createdByMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "rfi") return false;
    const { overdueRfis } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueRfis(companyId, now, id)).length > 0;
  },
});

/** An open RFI waiting on its assignee's answer. */
const rfiResponseRequired = paged({
  key: "RFI_RESPONSE_REQUIRED",
  moduleKey: "engineering",
  sources: [
    source(
      async (companyId, _now, page) => {
        const { rfisAwaitingResponse } = await import("@/lib/modules/engineering/engineering.attention");
        return rfisAwaitingResponse(companyId, undefined, page);
      },
      async (rows) => {
        const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
        return rows.map((row): AttentionCandidate => ({
          entityType: "rfi", entityId: row.id, projectId: row.projectId,
          title: `${row.status === "CLARIFICATION_REQUIRED" ? "Clarify" : "Answer"} RFI ${row.rfiNumber}`, body: [row.subject, row.dueAt ? `due ${dateLabel(dateOf(row.dueAt))}` : null].filter(Boolean).join(" · "),
          priority: row.priority === "CRITICAL" ? "HIGH" : "NORMAL", dismissible: true,
          // A new assignee or a clarification is a new ask.
          episode: `${row.assignedToMemberId}:${row.status}`,
          recipients: [row.assignedToMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id) {
    if (type !== "rfi") return false;
    const { rfisAwaitingResponse } = await import("@/lib/modules/engineering/engineering.attention");
    return (await rfisAwaitingResponse(companyId, id)).length > 0;
  },
});

/** A submittal review past its date, for the reviewer — or the project manager when nobody is assigned. */
const submittalReviewOverdue = paged({
  key: "SUBMITTAL_REVIEW_OVERDUE",
  moduleKey: "engineering",
  sources: [
    source(
      async (companyId, now, page) => {
        const { overdueSubmittalReviews } = await import("@/lib/modules/engineering/engineering.attention");
        return overdueSubmittalReviews(companyId, now, undefined, page);
      },
      async (rows) => {
        const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
        return rows.map((row): AttentionCandidate => ({
          entityType: "technical_submittal", entityId: row.id, projectId: row.projectId,
          title: `Review overdue: submittal ${row.submittalNumber}`, body: `${row.title} · due ${dateLabel(dateOf(row.dueAt))}`,
          priority: "HIGH", dismissible: true,
          episode: `${row.currentRevision?.id ?? "none"}:${dateOf(row.dueAt)}`,
          recipients: [row.assignedReviewerMemberId ?? row.project.projectManagerMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "technical_submittal") return false;
    const { overdueSubmittalReviews } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueSubmittalReviews(companyId, now, id)).length > 0;
  },
});

/** A submittal sent back for a new revision, for whoever registered and submitted it. */
const submittalRevisionRequired = paged({
  key: "SUBMITTAL_REVISION_REQUIRED",
  moduleKey: "engineering",
  sources: [
    source(
      async (companyId, _now, page) => {
        const { submittalsNeedingRevision } = await import("@/lib/modules/engineering/engineering.attention");
        return submittalsNeedingRevision(companyId, undefined, page);
      },
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "technical_submittal", entityId: row.id, projectId: row.projectId,
          title: `Revision required: submittal ${row.submittalNumber}`, body: `${row.title} · ${row.project.name}`,
          priority: "NORMAL", dismissible: true,
          episode: row.currentRevision?.id ?? "revision",
          recipients: [row.createdByMemberId, row.currentRevision?.submittedByMemberId],
        })),
    ),
  ],
  async holds(companyId, type, id) {
    if (type !== "technical_submittal") return false;
    const { submittalsNeedingRevision } = await import("@/lib/modules/engineering/engineering.attention");
    return (await submittalsNeedingRevision(companyId, id)).length > 0;
  },
});

/** A drawing or engineering document still under review past its review date. */
const engineeringReviewOverdue = paged({
  key: "ENGINEERING_REVIEW_OVERDUE",
  moduleKey: "engineering",
  sources: [
    source(
      async (companyId, now, page) => {
        const { overdueDocumentReviews } = await import("@/lib/modules/engineering/engineering.attention");
        return overdueDocumentReviews(companyId, now, undefined, page);
      },
      async (rows) => {
        const { dateLabel, dateOf } = await import("@/lib/modules/engineering/engineering.shared");
        return rows.map((row): AttentionCandidate => ({
          entityType: "engineering_document", entityId: row.id, projectId: row.projectId,
          title: `Review overdue: ${row.documentNumber}${row.currentRevision ? ` Rev ${row.currentRevision.revisionCode}` : ""}`, body: `${row.title} · due ${dateLabel(dateOf(row.reviewDueAt))}`,
          priority: "HIGH", dismissible: true,
          episode: `${row.currentRevision?.id ?? "none"}:${dateOf(row.reviewDueAt)}`,
          recipients: [row.reviewerMemberId ?? row.project.projectManagerMemberId],
        }));
      },
    ),
  ],
  async holds(companyId, type, id, now) {
    if (type !== "engineering_document") return false;
    const { overdueDocumentReviews } = await import("@/lib/modules/engineering/engineering.attention");
    return (await overdueDocumentReviews(companyId, now, id)).length > 0;
  },
});

/* Legal -------------------------------------------------------------------- */

const EXPIRY_WINDOW_DAYS = 30;
const LIVE_CONTRACT: Prisma.ContractWhereInput = { archivedAt: null, status: { in: ["SIGNED", "ACTIVE"] } };

const contractExpiring = paged({
  key: "CONTRACT_EXPIRING",
  moduleKey: "contracts",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.contract.findMany({
          where: { companyId, ...LIVE_CONTRACT, expiryDate: { gte: await startOfDay(companyId, now), lte: new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS) }, ...after(page) },
          select: { id: true, contractNumber: true, title: true, projectId: true, expiryDate: true, ownerMemberId: true },
          ...byId(page),
        }),
      (rows, _companyId, now) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "contract",
          entityId: row.id,
          projectId: row.projectId,
          title: `Contract ${row.contractNumber} expires ${isoDate(row.expiryDate!)}`,
          body: row.title,
          priority: daysBetween(now, row.expiryDate!) <= 7 ? "HIGH" : "NORMAL",
          dismissible: true,
          episode: isoDate(row.expiryDate!),
          recipients: [row.ownerMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    const until = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
    return (await prisma.contract.count({ where: { id, companyId, ...LIVE_CONTRACT, expiryDate: { gte: await startOfDay(companyId, now), lte: until } } })) > 0;
  },
});

const overdueObligation = paged({
  key: "OVERDUE_CONTRACT_OBLIGATION",
  moduleKey: "contracts",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.contractObligation.findMany({
          where: { companyId, status: "OPEN", dueDate: { lt: await startOfDay(companyId, now) }, contract: { archivedAt: null }, ...after(page) },
          select: {
            id: true,
            title: true,
            dueDate: true,
            responsibleMemberId: true,
            contract: { select: { contractNumber: true, ownerMemberId: true, projectId: true } },
          },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "obligation",
          entityId: row.id,
          projectId: row.contract.projectId,
          title: `Overdue obligation: ${row.title}`,
          body: `Contract ${row.contract.contractNumber} · due ${isoDate(row.dueDate!)}`,
          priority: "HIGH",
          dismissible: true,
          episode: isoDate(row.dueDate!),
          recipients: [row.responsibleMemberId ?? row.contract.ownerMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    return (await prisma.contractObligation.count({ where: { id, companyId, status: "OPEN", dueDate: { lt: await startOfDay(companyId, now) } } })) > 0;
  },
});

/* QA/QC -------------------------------------------------------------------- */

const OPEN_NCR = ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "PENDING_APPROVAL", "APPROVED_FOR_CLOSE", "REOPENED"] as const;

const unresolvedNcr = paged({
  key: "UNRESOLVED_NCR",
  moduleKey: "qaqc",
  sources: [
    source(
      (companyId, _now, page) =>
        prisma.nonConformanceReport.findMany({
          where: { companyId, status: { in: [...OPEN_NCR] }, ...after(page) },
          select: { id: true, ncrNumber: true, title: true, projectId: true, severity: true, assignedToMemberId: true, ownerMemberId: true, createdByMemberId: true },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "non_conformance_report",
          entityId: row.id,
          projectId: row.projectId,
          title: `NCR ${row.ncrNumber} is unresolved`,
          body: row.title,
          priority: row.severity === "CRITICAL" ? "CRITICAL" : row.severity === "HIGH" ? "HIGH" : "NORMAL",
          dismissible: row.severity !== "CRITICAL",
          episode: "open",
          recipients: [row.assignedToMemberId ?? row.ownerMemberId ?? row.createdByMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id) {
    return (await prisma.nonConformanceReport.count({ where: { id, companyId, status: { in: [...OPEN_NCR] } } })) > 0;
  },
});

const OPEN_ACTION = ["OPEN", "IN_PROGRESS", "REJECTED", "REOPENED"] as const;

const overdueQaAction = paged({
  key: "OVERDUE_QA_ACTION",
  moduleKey: "qaqc",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.correctiveAction.findMany({
          where: { companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: await startOfDay(companyId, now) }, ...after(page) },
          select: { id: true, actionNumber: true, title: true, projectId: true, dueDate: true, assignedToMemberId: true },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "corrective_action",
          entityId: row.id,
          projectId: row.projectId,
          title: `Corrective action ${row.actionNumber} is overdue`,
          body: row.title,
          priority: "HIGH",
          dismissible: true,
          episode: isoDate(row.dueDate!),
          recipients: [row.assignedToMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    return (await prisma.correctiveAction.count({ where: { id, companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: await startOfDay(companyId, now) } } })) > 0;
  },
});

/* HSE ---------------------------------------------------------------------- */

const criticalHseItem = paged({
  key: "CRITICAL_HSE_ITEM",
  moduleKey: "hse",
  sources: [
    source(
      (companyId, _now, page) =>
        prisma.hseHazard.findMany({
          where: { companyId, riskLevel: "CRITICAL", status: { in: OPEN_HAZARD_STATUSES }, ...after(page) },
          select: { id: true, hazardNumber: true, title: true, projectId: true, assignedToMemberId: true, reportedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
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
    ),
    source(
      (companyId, _now, page) =>
        prisma.hseIncident.findMany({
          where: { companyId, severity: "CRITICAL", status: { in: OPEN_INCIDENT_STATUSES }, ...after(page) },
          select: { id: true, incidentNumber: true, title: true, projectId: true, investigatorMemberId: true, reportedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
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
    ),
    source(
      (companyId, _now, page) =>
        prisma.stopWorkRecord.findMany({
          where: { companyId, status: "ACTIVE", ...after(page) },
          select: { id: true, stopWorkNumber: true, title: true, projectId: true, issuedByMemberId: true, project: { select: { projectManagerMemberId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
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
    ),
  ],
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
});

const overdueHseAction = paged({
  key: "OVERDUE_HSE_ACTION",
  moduleKey: "hse",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.hseAction.findMany({
          where: { companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: await startOfDay(companyId, now) }, ...after(page) },
          select: { id: true, actionNumber: true, title: true, projectId: true, dueDate: true, priority: true, assignedToMemberId: true },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "hse_action",
          entityId: row.id,
          projectId: row.projectId,
          title: `HSE action ${row.actionNumber} is overdue`,
          body: row.title,
          priority: row.priority === "CRITICAL" ? "CRITICAL" : "HIGH",
          dismissible: row.priority !== "CRITICAL",
          episode: isoDate(row.dueDate!),
          recipients: [row.assignedToMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    return (await prisma.hseAction.count({ where: { id, companyId, status: { in: [...OPEN_ACTION] }, dueDate: { lt: await startOfDay(companyId, now) } } })) > 0;
  },
});

/* Finance ------------------------------------------------------------------ */

async function outstandingByInvoice(invoiceIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  if (invoiceIds.length === 0) return new Map();
  // Settled by allocations of payments that still stand (E-05F §31).
  const paid = await prisma.paymentAllocation.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoiceIds }, reversedAt: null, payment: { is: { status: "RECORDED" } } },
    _sum: { amount: true },
  });
  return new Map(paid.map((row) => [row.invoiceId!, row._sum?.amount ?? new Prisma.Decimal(0)]));
}

const overdueInvoice = paged({
  key: "OVERDUE_INVOICE",
  moduleKey: "finance",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.invoice.findMany({
          where: { companyId, status: "SENT", archivedAt: null, dueDate: { lt: await startOfDay(companyId, now) }, ...after(page) },
          select: { id: true, invoiceNumber: true, projectId: true, dueDate: true, totalAmount: true, currency: true, createdByMemberId: true },
          ...byId(page),
        }),
      async (rows, _companyId, now) => {
        const paid = await outstandingByInvoice(rows.map((row) => row.id));
        return rows
          .filter((row) => row.totalAmount.minus(paid.get(row.id) ?? 0).greaterThan(0))
          .map((row): AttentionCandidate => ({
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
    ),
  ],
  async holds(companyId, _type, id, now) {
    const row = await prisma.invoice.findFirst({
      where: { id, companyId, status: "SENT", archivedAt: null, dueDate: { lt: await startOfDay(companyId, now) } },
      select: { totalAmount: true },
    });
    if (!row) return false;
    const paid = (await outstandingByInvoice([id])).get(id) ?? 0;
    return row.totalAmount.minus(paid).greaterThan(0);
  },
});

/* Meetings ----------------------------------------------------------------- */

/**
 * An action from a meeting past its due date (PRD #40 §79, §202), to its owner.
 * An action handed off to a task is left to the task's own overdue item, so
 * nobody is told twice about the same work.
 */
const meetingActionOverdue = paged({
  key: "MEETING_ACTION_OVERDUE",
  moduleKey: "meetings",
  sources: [
    source(
      async (companyId, now, page) =>
        prisma.meetingActionItem.findMany({
          where: {
            companyId,
            status: { in: ["OPEN", "IN_PROGRESS"] },
            linkedTaskId: null,
            ownerMemberId: { not: null },
            dueAt: { lt: await startOfDay(companyId, now) },
            meeting: { archivedAt: null, status: { not: "CANCELLED" } },
            ...after(page),
          },
          select: { id: true, title: true, dueAt: true, ownerMemberId: true, meeting: { select: { id: true, title: true, projectId: true } } },
          ...byId(page),
        }),
      (rows) =>
        rows.map((row): AttentionCandidate => ({
          entityType: "meeting",
          entityId: row.meeting.id,
          projectId: row.meeting.projectId,
          title: `Meeting action overdue: ${row.title}`,
          body: `From ${row.meeting.title} · due ${isoDate(row.dueAt!)}`,
          priority: "NORMAL",
          dismissible: true,
          episode: `${row.id}:${isoDate(row.dueAt!)}`,
          recipients: [row.ownerMemberId],
        })),
    ),
  ],
  async holds(companyId, _type, id, now) {
    const count = await prisma.meetingActionItem.count({
      where: { companyId, meetingId: id, status: { in: ["OPEN", "IN_PROGRESS"] }, linkedTaskId: null, dueAt: { lt: await startOfDay(companyId, now) } },
    });
    return count > 0;
  },
});

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
  documentExpiring,
  documentExpired,
  documentUnverified,
  qualificationExpiring,
  qualificationExpired,
  qualificationUnverified,
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
