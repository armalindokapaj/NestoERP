import { Prisma, type NCRStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import {
  dateString,
  isOverdue,
  loadMemberRef,
  loadMembers,
  procurementLink,
  toProjectRef,
} from "../qaqc.dto";
import { nextQualityNumber } from "../qaqc.numbering";
import {
  buildNcrScopeWhere,
  buildQaqcMemberWhere,
  buildQaqcProjectWhere,
} from "../qaqc.scope";
import type { NcrInput, NcrListQuery } from "../qaqc.schema";
import {
  isNcrCancellable,
  isNcrCloseable,
  isNcrDecidable,
  isNcrEditable,
  isNcrOpenable,
  isNcrReopenable,
  isNcrSubmittable,
  ncrClosureGapLabels,
  ncrClosureGaps,
} from "../qaqc.status";
import type { NcrDetailDTO, NcrSummaryDTO } from "../qaqc.types";

/**
 * Non-conformance reports (PRD #21 §122–§139).
 *
 * The formal statement that something did not meet requirement. What separates
 * an NCR from a defect lives in this file:
 *
 *   **An NCR cannot close without a root cause and a verified corrective
 *   action** (PRD #21 §136). A defect closes when the work is fixed. An NCR
 *   closes only when somebody has written down why it happened and what was
 *   done so it does not happen again, and somebody else has verified that
 *   action. Closing one without those records that a problem stopped being
 *   discussed rather than that it was solved.
 *
 * The closure gaps are computed and returned on the DTO, so the page can say
 * what is still missing rather than refusing the button with no explanation.
 */

const MODULE = "qaqc" as const;
const ENTITY = "NonConformanceReport";

const LIST_SELECT = {
  id: true,
  ncrNumber: true,
  title: true,
  category: true,
  severity: true,
  status: true,
  assignedToMemberId: true,
  dueDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  correctiveActions: { select: { status: true } },
} satisfies Prisma.NonConformanceReportSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  immediateAction: true,
  rootCause: true,
  correctiveActionSummary: true,
  closureNote: true,
  ownerMemberId: true,
  inspectionId: true,
  sourceDefectId: true,
  goodsReceiptId: true,
  goodsReceiptItemId: true,
  projectId: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  rejectedAt: true,
  rejectedByMemberId: true,
  closedAt: true,
  closedByMemberId: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
  inspection: { select: { id: true, inspectionNumber: true } },
  sourceDefect: { select: { id: true, defectNumber: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, purchaseOrderId: true } },
} satisfies Prisma.NonConformanceReportSelect;

type ListRow = Prisma.NonConformanceReportGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.NonConformanceReportGetPayload<{ select: typeof DETAIL_SELECT }>;

const OPEN_STATUSES: NCRStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "PENDING_APPROVAL",
  "APPROVED_FOR_CLOSE",
  "REOPENED",
];

const OPEN_ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "PENDING_VERIFICATION", "REOPENED"];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listNcrs(context: UserContext, query: NcrListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.view");

  const filters: Prisma.NonConformanceReportWhereInput[] = [buildNcrScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_STATUSES } });
  if (query.view === "mine") {
    filters.push({
      OR: [
        { assignedToMemberId: context.membershipId },
        { ownerMemberId: context.membershipId },
      ],
    });
  }
  if (query.view === "awaiting-approval") filters.push({ status: "PENDING_APPROVAL" });
  if (query.view === "overdue") {
    filters.push({ status: { in: OPEN_STATUSES }, dueDate: { lt: startOfToday() } });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.category?.length) filters.push({ category: { in: query.category } });
  if (query.severity?.length) filters.push({ severity: { in: query.severity } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedToMemberId) filters.push({ assignedToMemberId: query.assignedToMemberId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { ncrNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.NonConformanceReportWhereInput = { AND: filters };

  const orderBy: Prisma.NonConformanceReportOrderByWithRelationInput[] =
    query.sort === "due-asc"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "severity-desc"
        ? [{ severity: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "number-asc"
          ? [{ ncrNumber: "asc" }]
          : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.nonConformanceReport.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.nonConformanceReport.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getNcr(context: UserContext, ncrId: string): Promise<NcrDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.view");

  const row = assertFound(
    await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: ncrId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, pending, actions] = await Promise.all([
    loadMembers([
      row.assignedToMemberId,
      row.ownerMemberId,
      row.approvedByMemberId,
      row.rejectedByMemberId,
      row.closedByMemberId,
    ]),
    loadMemberRef(row.createdByMemberId),
    approvals.pendingFor(context, "NCR", ncrId),
    can(context, "qaqc.corrective_action.view")
      ? import("../corrective-actions/action.service").then((m) =>
          m.listForParent(context, { ncrId }),
        )
      : Promise.resolve([]),
  ]);

  const gaps = ncrClosureGaps({
    rootCause: row.rootCause,
    closureNote: row.closureNote,
    actions: row.correctiveActions,
    severity: row.severity,
  });

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    immediateAction: row.immediateAction,
    rootCause: row.rootCause,
    correctiveActionSummary: row.correctiveActionSummary,
    closureNote: row.closureNote,
    owner: row.ownerMemberId ? (members.get(row.ownerMemberId) ?? null) : null,
    inspection: row.inspection,
    sourceDefect: row.sourceDefect,
    source: procurementLink(context, row.goodsReceipt),
    correctiveActions: actions,
    closureGaps: gaps,
    submittedAt: dateString(row.submittedAt),
    approvedBy: row.approvedByMemberId ? (members.get(row.approvedByMemberId) ?? null) : null,
    approvedAt: dateString(row.approvedAt),
    rejectedBy: row.rejectedByMemberId ? (members.get(row.rejectedByMemberId) ?? null) : null,
    rejectedAt: dateString(row.rejectedAt),
    closedBy: row.closedByMemberId ? (members.get(row.closedByMemberId) ?? null) : null,
    closedAt: dateString(row.closedAt),
    cancelledAt: dateString(row.cancelledAt),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, {
      pendingSubmitter: pending?.submittedByMemberId ?? null,
      gaps,
    }),
  };
}

export async function listForInspection(
  context: UserContext,
  inspectionId: string,
): Promise<NcrSummaryDTO[]> {
  if (!can(context, "qaqc.ncr.view")) return [];

  const rows = await prisma.nonConformanceReport.findMany({
    where: { AND: [buildNcrScopeWhere(context), { inspectionId }] },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function listForDefect(
  context: UserContext,
  defectId: string,
): Promise<NcrSummaryDTO[]> {
  if (!can(context, "qaqc.ncr.view")) return [];

  const rows = await prisma.nonConformanceReport.findMany({
    where: { AND: [buildNcrScopeWhere(context), { sourceDefectId: defectId }] },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<NcrSummaryDTO[]> {
  if (!can(context, "qaqc.ncr.view")) return [];

  const rows = await prisma.nonConformanceReport.findMany({
    where: { AND: [buildNcrScopeWhere(context), { projectId }] },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function ncrFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.view");

  const scope = buildNcrScopeWhere(context);

  const [projects, assignees] = await Promise.all([
    prisma.project.findMany({
      where: {
        AND: [buildQaqcProjectWhere(context), { nonConformanceReports: { some: scope } }],
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedNcrs: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, assignees };
}

export async function ncrFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members, receipts] = await Promise.all([
    prisma.project.findMany({
      where: buildQaqcProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildQaqcMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
    can(context, "qaqc.material.view")
      ? prisma.goodsReceipt.findMany({
          where: { companyId: context.companyId, status: "RECORDED" },
          select: {
            id: true,
            receiptNumber: true,
            supplier: { select: { name: true } },
          },
          orderBy: { receiptDate: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return { projects, members, receipts };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createNcr(
  context: UserContext,
  input: NcrInput,
): Promise<NcrDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.create");

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);
  if (input.ownerMemberId) await requireMember(context, input.ownerMemberId);

  const id = await prisma.$transaction(async (tx) => {
    const ncrNumber = await nextQualityNumber(tx, "nonConformanceReport", context.companyId);

    const ncr = await tx.nonConformanceReport.create({
      data: {
        companyId: context.companyId,
        ncrNumber,
        title: input.title,
        description: input.description,
        projectId,
        inspectionId: input.inspectionId ?? null,
        goodsReceiptId: input.goodsReceiptId ?? null,
        goodsReceiptItemId: input.goodsReceiptItemId ?? null,
        sourceDefectId: input.sourceDefectId ?? null,
        category: input.category,
        severity: input.severity,
        status: "DRAFT",
        assignedToMemberId: input.assignedToMemberId ?? null,
        ownerMemberId: input.ownerMemberId ?? null,
        immediateAction: input.immediateAction ?? null,
        rootCause: input.rootCause ?? null,
        correctiveActionSummary: input.correctiveActionSummary ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, ncrNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncr.id,
      action: "QAQC_NCR_CREATED",
      message: `raised ${ncr.ncrNumber}`,
    });

    return ncr.id;
  });

  return getNcr(context, id);
}

export async function updateNcr(
  context: UserContext,
  ncrId: string,
  input: NcrInput,
): Promise<NcrDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.update");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed NCR cannot be edited.", { code: "NCR_CLOSED" });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  if (input.assignedToMemberId) await requireMember(context, input.assignedToMemberId);
  if (input.ownerMemberId) await requireMember(context, input.ownerMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: {
        title: input.title,
        description: input.description,
        projectId,
        inspectionId: input.inspectionId ?? null,
        goodsReceiptId: input.goodsReceiptId ?? null,
        goodsReceiptItemId: input.goodsReceiptItemId ?? null,
        sourceDefectId: input.sourceDefectId ?? null,
        category: input.category,
        severity: input.severity,
        assignedToMemberId: input.assignedToMemberId ?? null,
        ownerMemberId: input.ownerMemberId ?? null,
        immediateAction: input.immediateAction ?? null,
        rootCause: input.rootCause ?? null,
        correctiveActionSummary: input.correctiveActionSummary ?? null,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_UPDATED",
      message: `updated ${existing.ncrNumber}`,
    });
  });

  return getNcr(context, ncrId);
}

/** A draft becomes a live non-conformance (PRD #21 §129). */
export async function openNcr(context: UserContext, ncrId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.update");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrOpenable(existing.status)) {
    throw new AccessError("CONFLICT", "This NCR is already open.", { code: "NOT_DRAFT" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: { status: "OPEN", updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_OPENED",
      message: `opened ${existing.ncrNumber}`,
    });
  });
}

export async function assignNcr(
  context: UserContext,
  ncrId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.assign");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A closed NCR cannot be reassigned.", {
      code: "NCR_CLOSED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: {
        assignedToMemberId: member.id,
        status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_ASSIGNED",
      message: `assigned ${existing.ncrNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Putting an NCR up for closure approval (PRD #21 §134).
 *
 * The closure requirements are checked here rather than at the decision, so the
 * person who owns the NCR finds out what is missing — not the approver.
 */
export async function submitNcr(context: UserContext, ncrId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.submit");

  const existing = assertFound(
    await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: ncrId }] },
      select: {
        id: true,
        ncrNumber: true,
        status: true,
        severity: true,
        rootCause: true,
        closureNote: true,
        correctiveActions: { select: { status: true } },
      },
    }),
  );

  if (!isNcrSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "This NCR is not in a state to be submitted.", {
      code: "NOT_SUBMITTABLE",
    });
  }

  const gaps = ncrClosureGaps({
    rootCause: existing.rootCause,
    closureNote: existing.closureNote,
    actions: existing.correctiveActions,
    severity: existing.severity,
  });

  if (gaps.length > 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      gaps.map((gap) => ncrClosureGapLabels[gap]).join(" "),
      { code: "CLOSURE_INCOMPLETE" },
    );
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.nonConformanceReport.updateMany({
      where: { id: ncrId, status: existing.status },
      data: {
        status: "PENDING_APPROVAL",
        submittedAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "Somebody else has already submitted this.", {
        code: "ALREADY_SUBMITTED",
      });
    }

    await approvals.openApproval(tx, context, "NCR", ncrId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_SUBMITTED",
      message: `submitted ${existing.ncrNumber} for closure approval`,
    });
  });
}

export async function approveNcr(
  context: UserContext,
  ncrId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "NCR");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This NCR is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "NCR", ncrId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    const updated = await tx.nonConformanceReport.updateMany({
      where: { id: ncrId, status: "PENDING_APPROVAL" },
      data: {
        status: "APPROVED_FOR_CLOSE",
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        rejectedAt: null,
        rejectedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "That decision has already been made.", {
        code: "ALREADY_DECIDED",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_APPROVED",
      message: `approved ${existing.ncrNumber} for closure`,
    });
  });
}

export async function rejectNcr(
  context: UserContext,
  ncrId: string,
  note: string,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "NCR");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrDecidable(existing.status)) {
    throw new AccessError("CONFLICT", "This NCR is not waiting for a decision.", {
      code: "NOT_PENDING",
    });
  }

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "NCR", ncrId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", note);

    // Back to whoever owns it, with the rejection on the record (PRD #21 §135).
    const updated = await tx.nonConformanceReport.updateMany({
      where: { id: ncrId, status: "PENDING_APPROVAL" },
      data: {
        status: "IN_PROGRESS",
        rejectedAt: new Date(),
        rejectedByMemberId: context.membershipId,
        submittedAt: null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (updated.count === 0) {
      throw new AccessError("CONFLICT", "That decision has already been made.", {
        code: "ALREADY_DECIDED",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_REJECTED",
      message: `rejected the closure of ${existing.ncrNumber}`,
      metadata: { note } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Closing an NCR (PRD #21 §136, §137).
 *
 * The gaps are checked once more here. They were checked at submission, but a
 * corrective action can be reopened between the two, and an NCR closed over an
 * unverified action is exactly the failure this module exists to prevent.
 */
export async function closeNcr(
  context: UserContext,
  ncrId: string,
  closureNote: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.close");

  const existing = assertFound(
    await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: ncrId }] },
      select: {
        id: true,
        ncrNumber: true,
        status: true,
        severity: true,
        rootCause: true,
        closureNote: true,
        correctiveActions: { select: { status: true } },
      },
    }),
  );

  if (!isNcrCloseable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An NCR is closed once its closure has been approved.",
      { code: "NOT_APPROVED" },
    );
  }

  const gaps = ncrClosureGaps({
    rootCause: existing.rootCause,
    closureNote: closureNote ?? existing.closureNote,
    actions: existing.correctiveActions,
    severity: existing.severity,
  });

  if (gaps.length > 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      gaps.map((gap) => ncrClosureGapLabels[gap]).join(" "),
      { code: "CLOSURE_INCOMPLETE" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByMemberId: context.membershipId,
        closureNote: closureNote ?? existing.closureNote,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_CLOSED",
      message: `closed ${existing.ncrNumber}`,
    });
  });
}

export async function reopenNcr(
  context: UserContext,
  ncrId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.reopen");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a closed NCR can be reopened.", {
      code: "NOT_CLOSED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: {
        status: "REOPENED",
        closedAt: null,
        closedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_REOPENED",
      message: `reopened ${existing.ncrNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelNcr(
  context: UserContext,
  ncrId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.cancel");

  const existing = await requireNcr(context, ncrId);

  if (!isNcrCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This NCR has already been settled.", {
      code: "NCR_SETTLED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.nonConformanceReport.update({
      where: { id: ncrId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "NCR", ncrId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncrId,
      action: "QAQC_NCR_CANCELLED",
      message: `cancelled ${existing.ncrNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Turning a defect into a formal non-conformance (PRD #21 §170, §171, §172).
 *
 * The defect stays exactly where it is and the NCR links back to it, because
 * the site still has to fix the thing whatever the paperwork says.
 */
export async function escalateDefect(
  context: UserContext,
  defectId: string,
  input: { category: NcrInput["category"]; title?: string },
): Promise<NcrDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.ncr.create");

  const { buildDefectScopeWhere } = await import("../qaqc.scope");

  const defect = assertFound(
    await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: defectId }] },
      select: {
        id: true,
        defectNumber: true,
        title: true,
        description: true,
        projectId: true,
        severity: true,
        inspectionId: true,
        assignedToMemberId: true,
        status: true,
      },
    }),
  );

  if (defect.status === "CANCELLED") {
    throw new AccessError("CONFLICT", "A cancelled defect cannot be escalated.", {
      code: "DEFECT_CANCELLED",
    });
  }

  const existing = await prisma.nonConformanceReport.findFirst({
    where: { companyId: context.companyId, sourceDefectId: defectId, status: { not: "CANCELLED" } },
    select: { id: true },
  });

  if (existing) {
    throw new AccessError(
      "CONFLICT",
      "This defect has already been escalated to an NCR.",
      { code: "ALREADY_ESCALATED" },
    );
  }

  const id = await prisma.$transaction(async (tx) => {
    const ncrNumber = await nextQualityNumber(tx, "nonConformanceReport", context.companyId);

    const ncr = await tx.nonConformanceReport.create({
      data: {
        companyId: context.companyId,
        ncrNumber,
        title: input.title ?? defect.title,
        description: defect.description,
        projectId: defect.projectId,
        inspectionId: defect.inspectionId,
        sourceDefectId: defect.id,
        category: input.category,
        severity: defect.severity,
        status: "OPEN",
        assignedToMemberId: defect.assignedToMemberId,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, ncrNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: ncr.id,
      action: "QAQC_NCR_ESCALATED",
      message: `raised ${ncr.ncrNumber} from defect ${defect.defectNumber}`,
      metadata: { defectId: defect.id } as Prisma.InputJsonValue,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "QualityDefect",
      entityId: defect.id,
      action: "QAQC_DEFECT_ESCALATED",
      message: `escalated defect ${defect.defectNumber} to ${ncr.ncrNumber}`,
      metadata: { ncrId: ncr.id } as Prisma.InputJsonValue,
    });

    return ncr.id;
  });

  return getNcr(context, id);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function requireNcr(context: UserContext, ncrId: string) {
  return assertFound(
    await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: ncrId }] },
      select: { id: true, ncrNumber: true, status: true, updatedAt: true },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildQaqcProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildQaqcMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this NCR while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): NcrSummaryDTO {
  const open = OPEN_STATUSES.includes(row.status);

  return {
    id: row.id,
    ncrNumber: row.ncrNumber,
    title: row.title,
    category: row.category,
    severity: row.severity,
    status: row.status,
    project: toProjectRef(row.project),
    assignedTo: row.assignedToMemberId ? (members.get(row.assignedToMemberId) ?? null) : null,
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    openActions: row.correctiveActions.filter((action) =>
      OPEN_ACTION_STATUSES.includes(action.status),
    ).length,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  state: { pendingSubmitter: string | null; gaps: string[] },
) {
  const selfSubmitted = state.pendingSubmitter === context.membershipId;
  const mayDecide =
    isNcrDecidable(row.status) && (!selfSubmitted || can(context, "qaqc.approval.self"));

  return {
    canEdit: isNcrEditable(row.status) && can(context, "qaqc.ncr.update"),
    canOpen: isNcrOpenable(row.status) && can(context, "qaqc.ncr.update"),
    canAssign: isNcrEditable(row.status) && can(context, "qaqc.ncr.assign"),
    // Offered only when the closure requirements are actually met, so the
    // button never fails for a reason the page could have shown (§136).
    canSubmit:
      isNcrSubmittable(row.status) && state.gaps.length === 0 && can(context, "qaqc.ncr.submit"),
    canApprove: mayDecide && can(context, "qaqc.ncr.approve"),
    canReject: mayDecide && can(context, "qaqc.ncr.reject"),
    canClose:
      isNcrCloseable(row.status) && state.gaps.length === 0 && can(context, "qaqc.ncr.close"),
    canReopen: isNcrReopenable(row.status) && can(context, "qaqc.ncr.reopen"),
    canCancel: isNcrCancellable(row.status) && can(context, "qaqc.ncr.cancel"),
    canAddAction:
      isNcrEditable(row.status) && can(context, "qaqc.corrective_action.create"),
    canViewDocuments: can(context, "qaqc.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "qaqc.activity.view"),
  };
}
