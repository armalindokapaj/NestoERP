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

const pendingApproval: AttentionConditionDefinition = {
  key: "PENDING_APPROVAL",
  moduleKey: "dashboard",
  collect: (companyId) => approvalCandidates(APPROVAL_SOURCES, companyId, "waiting for your approval"),
  holds: (companyId, type, id) => approvalHolds(APPROVAL_SOURCES, companyId, type, id),
};

const procurementActionRequired: AttentionConditionDefinition = {
  key: "PROCUREMENT_ACTION_REQUIRED",
  moduleKey: "procurement",
  collect: (companyId) => approvalCandidates([PROCUREMENT_SOURCE], companyId, "needs a procurement decision"),
  holds: (companyId, type, id) => approvalHolds([PROCUREMENT_SOURCE], companyId, type, id),
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
