import { Prisma, type QualityApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { assertDecisionGuard, requireDecisionGuard, singlePending, type ApprovalGuard, type PendingCycle } from "@/lib/core/approvals/approval-guard";
import { notifyApprovalDecided, notifyApprovalRequested, recordApprovalCancelled } from "@/lib/core/notifications/approval-notifications";
import type { RecordType } from "@/lib/core/records/record.types";
import type { Permission } from "@/config/permissions";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { loadMembers } from "../qaqc.dto";
import { buildInspectionScopeWhere, buildNcrScopeWhere } from "../qaqc.scope";
import type { ApprovalListQuery } from "../qaqc.schema";
import type { QualityApprovalDTO } from "../qaqc.types";

/**
 * Quality approvals (PRD #21 §160–§169).
 *
 * One cycle per submission, on an inspection or an NCR. Three rules live here:
 *
 *   1. **Nobody decides what they submitted** (PRD #21 §165). An inspector who
 *      signs off their own work has not been inspected — that is the single
 *      thing a quality system exists to prevent. The service refuses it and the
 *      queue withholds the buttons, so an approver is never offered an action
 *      that is certain to fail.
 *   2. **One pending cycle per record** (PRD #21 §218). A second submission
 *      while one is open is a conflict, not a second row.
 *   3. **The queue is scoped** (PRD #21 §164). It lists only decisions on
 *      records the reader could open directly — the queue is not a back door
 *      into another project's quality history.
 */

const MODULE = "qaqc" as const;

const APPROVAL_SELECT = {
  id: true,
  recordType: true,
  recordId: true,
  status: true,
  submittedByMemberId: true,
  submittedAt: true,
  decidedByMemberId: true,
  decidedAt: true,
  decisionNote: true,
} satisfies Prisma.QualityApprovalSelect;

type ApprovalRow = Prisma.QualityApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Permission helpers                                                          */
/* -------------------------------------------------------------------------- */

export function canApproveType(
  context: UserContext,
  type: QualityApprovalRecordType,
): boolean {
  return can(context, type === "INSPECTION" ? "qaqc.inspection.approve" : "qaqc.ncr.approve");
}

export function canRejectType(context: UserContext, type: QualityApprovalRecordType): boolean {
  return can(context, type === "INSPECTION" ? "qaqc.inspection.reject" : "qaqc.ncr.reject");
}

export function assertCanApprove(
  context: UserContext,
  type: QualityApprovalRecordType,
): void {
  if (!canApproveType(context, type)) throw new AccessError("FORBIDDEN");
}

export function assertCanReject(context: UserContext, type: QualityApprovalRecordType): void {
  if (!canRejectType(context, type)) throw new AccessError("FORBIDDEN");
}

/**
 * Nobody decides on what they submitted (PRD #21 §165).
 *
 * `qaqc.approval.self` exists so a one-person company can still operate, and is
 * held by nobody by default. Separation of duties is the rule; the grant is the
 * documented exception.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "qaqc.approval.self")) return;
  throw new AccessError(
    "FORBIDDEN",
    "You submitted this, so somebody else has to decide on it.",
    { code: "SELF_APPROVAL" },
  );
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

type Tx = Prisma.TransactionClient;

/** How each approval record type is named to the record registry (PRD #38 §74). */
const APPROVAL_RECORD: Record<QualityApprovalRecordType, { recordType: RecordType; noun: string; approve: Permission }> = {
  INSPECTION: { recordType: "quality_inspection", noun: "Inspection", approve: "qaqc.inspection.approve" },
  NCR: { recordType: "non_conformance_report", noun: "NCR", approve: "qaqc.ncr.approve" },
};

/** Opens a cycle, refusing a second one while the first is still open (§218). */
export async function openApproval(
  tx: Tx,
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
): Promise<string> {
  const existing = await tx.qualityApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true },
  });

  if (existing) {
    throw new AccessError("CONFLICT", "This is already waiting for a decision.", {
      code: "APPROVAL_PENDING",
    });
  }

  const approval = await tx.qualityApproval.create({
    data: {
      companyId: context.companyId,
      recordType: type,
      recordId,
      status: "PENDING",
      submittedByMemberId: context.membershipId,
      submittedAt: new Date(),
    },
    select: { id: true },
  });

  await notifyApprovalRequested(tx, context, {
    approvalId: approval.id,
    moduleKey: "qaqc",
    recordId,
    recordType: APPROVAL_RECORD[type].recordType,
    noun: APPROVAL_RECORD[type].noun,
    approvePermissions: [APPROVAL_RECORD[type].approve],
  });

  return approval.id;
}

export async function requirePendingApproval(
  tx: Tx,
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
  guard: ApprovalGuard | undefined,
): Promise<{ id: string; submittedByMemberId: string }> {
  requireDecisionGuard(guard);
  // Newest first, and never one of two at random (AUD-10 §4, A6).
  const approval = singlePending(
    await tx.qualityApproval.findMany({
      where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
      orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
      take: 2,
      select: { id: true, submittedByMemberId: true },
    }),
  );

  if (!approval) {
    throw new AccessError("CONFLICT", "There is no decision waiting on this record.", {
      code: "NO_PENDING_APPROVAL",
    });
  }

  // A resubmission since the review opened is a different cycle (PRD #41 §187).
  assertDecisionGuard(guard, approval);

  return approval;
}

/**
 * The cycle a source page puts its decision controls against (AUD-10 §4,
 * CW-02, CW-05): the page names it back when somebody decides, and the
 * decision is refused if it is no longer the pending one. Ids only — whether
 * this reader may decide is the record's capabilities' business.
 */
export async function pendingCycle(
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
): Promise<PendingCycle | null> {
  const row = await prisma.qualityApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!row) return null;
  return { approvalId: row.id };
}

export async function decideApproval(
  tx: Tx,
  context: UserContext,
  approvalId: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  // Conditional on PENDING, so two decisions racing each other settle once
  // (PRD #21 §167).
  const result = await tx.qualityApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: {
      status,
      decidedByMemberId: context.membershipId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "That decision has already been made.", {
      code: "APPROVAL_DECIDED",
    });
  }

  const approval = await tx.qualityApproval.findUnique({
    where: { id: approvalId },
    select: { recordType: true, recordId: true, submittedByMemberId: true },
  });
  if (approval) {
    await notifyApprovalDecided(tx, context, {
      approvalId,
      moduleKey: "qaqc",
      recordId: approval.recordId,
      recordType: APPROVAL_RECORD[approval.recordType].recordType,
      noun: APPROVAL_RECORD[approval.recordType].noun,
      decision: status,
      note,
      submittedByMemberId: approval.submittedByMemberId,
    });
  }
}

/** Cancelling the record cancels whatever was waiting on it (PRD #21 §87). */
export async function cancelPendingApprovals(
  tx: Tx,
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
): Promise<void> {
  const { count } = await tx.qualityApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: {
      status: "CANCELLED",
      decidedAt: new Date(),
      decidedByMemberId: context.membershipId,
    },
  });
  await recordApprovalCancelled(tx, context, { moduleKey: MODULE, recordType: APPROVAL_RECORD[type].recordType, noun: APPROVAL_RECORD[type].noun, recordId, count });
}

/** The cycle currently waiting on a record, if there is one. */
export async function pendingFor(
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
): Promise<{ id: string; submittedByMemberId: string } | null> {
  return prisma.qualityApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true, submittedByMemberId: true },
  });
}

/** Every cycle a record has been through, newest first (PRD #21 §169). */
export async function historyFor(
  context: UserContext,
  type: QualityApprovalRecordType,
  recordId: string,
): Promise<QualityApprovalDTO[]> {
  if (!can(context, "qaqc.approval.view")) return [];

  const rows = await prisma.qualityApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.submittedByMemberId, row.decidedByMemberId]),
  );

  return rows.map((row) =>
    toDTO(context, row, members, { number: "", title: "", href: "" }),
  );
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

type RecordRef = { number: string; title: string; href: string };

function toDTO(
  context: UserContext,
  row: ApprovalRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
  record: RecordRef,
): QualityApprovalDTO {
  const submittedBy = members.get(row.submittedByMemberId) ?? null;

  return {
    id: row.id,
    recordType: row.recordType,
    recordId: row.recordId,
    recordNumber: record.number,
    recordTitle: record.title,
    status: row.status,
    submittedBy,
    submittedAt: row.submittedAt.toISOString(),
    decidedBy: row.decidedByMemberId ? (members.get(row.decidedByMemberId) ?? null) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    href: record.href,
    /*
     * Withheld for whoever submitted it, so the queue never offers a button
     * that is certain to fail (PRD #21 §165). This mirrors the service check
     * rather than replacing it.
     */
    canDecide:
      row.status === "PENDING" &&
      canApproveType(context, row.recordType) &&
      (row.submittedByMemberId !== context.membershipId ||
        can(context, "qaqc.approval.self")),
  };
}

/**
 * The approval queue (PRD #21 §164).
 *
 * Scoped twice: to the records the reader can open, and to the types they hold
 * a decision permission for. Somebody who may approve NCRs but not inspections
 * sees only NCRs waiting.
 */
export async function listApprovals(context: UserContext, query: ApprovalListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.approval.view");

  const statuses: Prisma.QualityApprovalWhereInput =
    query.view === "pending"
      ? { status: "PENDING" }
      : query.view === "decided"
        ? { status: { in: ["APPROVED", "REJECTED"] } }
        : {};

  // Only the record types this reader may actually see.
  const types: QualityApprovalRecordType[] = [];
  if (can(context, "qaqc.inspection.view")) types.push("INSPECTION");
  if (can(context, "qaqc.ncr.view")) types.push("NCR");

  const wanted = query.recordType
    ? types.filter((type) => type === query.recordType)
    : types;

  if (wanted.length === 0) {
    return { data: [], pagination: paginationMeta(0, query.page, query.limit) };
  }

  const where: Prisma.QualityApprovalWhereInput = {
    AND: [{ companyId: context.companyId }, statuses, { recordType: { in: wanted } }],
  };

  const [rows, total] = await Promise.all([
    prisma.qualityApproval.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: APPROVAL_SELECT,
    }),
    prisma.qualityApproval.count({ where }),
  ]);

  /*
   * The record behind each row, fetched through its own scope clause — so a
   * cycle on a record the reader cannot open is dropped rather than listed
   * with a name they were not entitled to (PRD #21 §164).
   */
  const inspectionIds = rows.filter((r) => r.recordType === "INSPECTION").map((r) => r.recordId);
  const ncrIds = rows.filter((r) => r.recordType === "NCR").map((r) => r.recordId);

  const [inspections, ncrs, members] = await Promise.all([
    inspectionIds.length > 0
      ? prisma.qualityInspection.findMany({
          where: { AND: [buildInspectionScopeWhere(context), { id: { in: inspectionIds } }] },
          select: { id: true, inspectionNumber: true, summary: true, inspectionType: true },
        })
      : Promise.resolve([]),
    ncrIds.length > 0
      ? prisma.nonConformanceReport.findMany({
          where: { AND: [buildNcrScopeWhere(context), { id: { in: ncrIds } }] },
          select: { id: true, ncrNumber: true, title: true },
        })
      : Promise.resolve([]),
    loadMembers(context.companyId, rows.flatMap((row) => [row.submittedByMemberId, row.decidedByMemberId])),
  ]);

  const refs = new Map<string, RecordRef>();
  for (const row of inspections) {
    refs.set(row.id, {
      number: row.inspectionNumber,
      title: row.summary ?? `${row.inspectionType} inspection`,
      href: `/qaqc/inspections/${row.id}`,
    });
  }
  for (const row of ncrs) {
    refs.set(row.id, {
      number: row.ncrNumber,
      title: row.title,
      href: `/qaqc/ncrs/${row.id}`,
    });
  }

  const data = rows
    .filter((row) => refs.has(row.recordId))
    .map((row) => toDTO(context, row, members, refs.get(row.recordId)!));

  return { data, pagination: paginationMeta(total, query.page, query.limit) };
}

/** How many decisions this reader could actually take, for the nav badge. */
export async function pendingCount(context: UserContext): Promise<number> {
  if (!can(context, "qaqc.approval.view")) return 0;

  const result = await listApprovals(context, {
    view: "pending",
    page: 1,
    limit: 100,
    recordType: undefined,
  });

  return result.data.filter((row) => row.canDecide).length;
}
