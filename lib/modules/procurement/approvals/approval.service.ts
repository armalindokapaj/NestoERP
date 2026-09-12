import { Prisma, type ProcurementApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { toAmountString, toMemberRef, toSupplierRef } from "../procurement.dto";
import { buildOrderScopeWhere, buildRequestScopeWhere } from "../procurement.scope";
import type { MemberRef, ProcurementApprovalDTO } from "../procurement.types";

/**
 * Procurement approvals (PRD #19 §148–§157).
 *
 * One cycle per submission, on a request or an order. Three rules live here:
 *
 *   1. **Nobody decides what they submitted** (PRD #19 §21). The service
 *      refuses it and the queue withholds the buttons, so an approver is never
 *      offered an action that is certain to fail.
 *   2. **One pending cycle per record** (PRD #19 §213). A second submission
 *      while one is open is a conflict, not a second row.
 *   3. **The queue is scoped** (PRD #19 §153). It lists only decisions on
 *      records the reader could open directly — the queue is not a back door
 *      into another project's buying.
 */

const MODULE = "procurement" as const;

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
} satisfies Prisma.ProcurementApprovalSelect;

type ApprovalRow = Prisma.ProcurementApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Permission helpers                                                          */
/* -------------------------------------------------------------------------- */

export function canApproveType(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): boolean {
  return can(
    context,
    type === "PURCHASE_REQUEST" ? "procurement.request.approve" : "procurement.order.approve",
  );
}

export function canRejectType(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): boolean {
  return can(
    context,
    type === "PURCHASE_REQUEST" ? "procurement.request.reject" : "procurement.order.reject",
  );
}

export function assertCanApprove(
  context: UserContext,
  type: ProcurementApprovalRecordType,
): void {
  if (!canApproveType(context, type)) throw new AccessError("FORBIDDEN");
}

export function assertCanReject(context: UserContext, type: ProcurementApprovalRecordType): void {
  if (!canRejectType(context, type)) throw new AccessError("FORBIDDEN");
}

/**
 * Nobody decides on what they submitted (PRD #19 §21).
 *
 * `procurement.approval.self` exists so a one-person company can still operate,
 * and is held by nobody by default. Separation of duties is the rule; the grant
 * is the documented exception.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "procurement.approval.self")) return;
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

/** Opens a cycle, refusing a second one while the first is still open (§213). */
export async function openApproval(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<string> {
  const existing = await tx.procurementApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true },
  });

  if (existing) {
    throw new AccessError(
      "CONFLICT",
      "This is already waiting for a decision.",
      { code: "APPROVAL_PENDING" },
    );
  }

  const approval = await tx.procurementApproval.create({
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

  return approval.id;
}

export async function requirePendingApproval(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<{ id: string; submittedByMemberId: string }> {
  const approval = await tx.procurementApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    select: { id: true, submittedByMemberId: true },
  });

  if (!approval) {
    throw new AccessError(
      "CONFLICT",
      "There is no decision waiting on this record.",
      { code: "NO_PENDING_APPROVAL" },
    );
  }

  return approval;
}

export async function decideApproval(
  tx: Tx,
  context: UserContext,
  approvalId: string,
  status: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  // Conditional on PENDING, so two decisions racing each other settle once.
  const result = await tx.procurementApproval.updateMany({
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
}

/** Cancelling the record cancels whatever was waiting on it (PRD #19 §59). */
export async function cancelPendingApprovals(
  tx: Tx,
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<void> {
  await tx.procurementApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

type RecordRef = {
  reference: string;
  title: string;
  project: { id: string; code: string; name: string } | null;
  supplier: { id: string; name: string; status: "ACTIVE" | "INACTIVE" | "ARCHIVED" } | null;
  currency: string | null;
  amount: Prisma.Decimal | null;
};

/**
 * The records the queue may mention, resolved once (PRD #19 §153).
 *
 * Both maps come from the caller's own scope queries, so an approval is exactly
 * as reachable as the record it decides — never more. Resolved in two queries
 * rather than one per row (PRD #19 §304).
 */
async function reachableRecords(context: UserContext): Promise<{
  requests: Map<string, RecordRef>;
  orders: Map<string, RecordRef>;
}> {
  const [requests, orders] = await Promise.all([
    can(context, "procurement.request.view")
      ? prisma.purchaseRequest.findMany({
          where: buildRequestScopeWhere(context),
          select: {
            id: true,
            requestNumber: true,
            title: true,
            currency: true,
            estimatedTotal: true,
            project: { select: { id: true, code: true, name: true } },
          },
        })
      : Promise.resolve([]),
    can(context, "procurement.order.view")
      ? prisma.purchaseOrder.findMany({
          where: buildOrderScopeWhere(context),
          select: {
            id: true,
            poNumber: true,
            currency: true,
            totalAmount: true,
            project: { select: { id: true, code: true, name: true } },
            supplier: { select: { id: true, name: true, status: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    requests: new Map(
      requests.map((row) => [
        row.id,
        {
          reference: row.requestNumber,
          title: row.title,
          project: row.project,
          supplier: null,
          currency: row.currency,
          amount: row.estimatedTotal,
        },
      ]),
    ),
    orders: new Map(
      orders.map((row) => [
        row.id,
        {
          reference: row.poNumber,
          title: `Order to ${row.supplier.name}`,
          project: row.project,
          supplier: row.supplier,
          currency: row.currency,
          amount: row.totalAmount,
        },
      ]),
    ),
  };
}

async function hydrate(
  context: UserContext,
  rows: ApprovalRow[],
  reachable: Awaited<ReturnType<typeof reachableRecords>>,
): Promise<ProcurementApprovalDTO[]> {
  // The people named on these cycles, resolved once rather than per row
  // (PRD #19 §304).
  const memberIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.decidedByMemberId ? [row.submittedByMemberId, row.decidedByMemberId] : [row.submittedByMemberId],
      ),
    ),
  ];

  const members = await prisma.companyMember.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  const byMember = new Map<string, MemberRef>(
    members.map((member) => [member.id, toMemberRef(member)!]),
  );

  return rows.flatMap((row) => {
    const ref =
      row.recordType === "PURCHASE_REQUEST"
        ? reachable.requests.get(row.recordId)
        : reachable.orders.get(row.recordId);

    // Out of scope: the row is dropped rather than rendered as a stub, so the
    // queue cannot be used to learn that a record exists.
    if (!ref) return [];

    const pending = row.status === "PENDING";
    const selfBlocked =
      row.submittedByMemberId === context.membershipId &&
      !can(context, "procurement.approval.self");

    return [
      {
        id: row.id,
        recordType: row.recordType,
        recordId: row.recordId,
        recordReference: ref.reference,
        recordTitle: ref.title,
        project: ref.project,
        supplier: toSupplierRef(ref.supplier),
        value:
          ref.currency && ref.amount !== null
            ? { currency: ref.currency, amount: toAmountString(ref.amount) }
            : null,
        status: row.status,
        submittedBy: byMember.get(row.submittedByMemberId) ?? null,
        submittedAt: row.submittedAt.toISOString(),
        decidedBy: row.decidedByMemberId ? (byMember.get(row.decidedByMemberId) ?? null) : null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        capabilities: {
          canApprove: pending && !selfBlocked && canApproveType(context, row.recordType),
          canReject: pending && !selfBlocked && canRejectType(context, row.recordType),
        },
      },
    ];
  });
}

export async function listApprovals(
  context: UserContext,
  options: { status?: "PENDING" | "DECIDED"; page?: number; limit?: number } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.approval.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const reachable = await reachableRecords(context);
  const recordIds = [...reachable.requests.keys(), ...reachable.orders.keys()];

  const where: Prisma.ProcurementApprovalWhereInput = {
    companyId: context.companyId,
    ...(options.status === "PENDING" ? { status: "PENDING" } : {}),
    ...(options.status === "DECIDED" ? { status: { not: "PENDING" } } : {}),
    recordId: { in: recordIds },
  };

  const [rows, total] = await Promise.all([
    prisma.procurementApproval.findMany({
      where,
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      skip: skipFor(page, limit),
      take: limit,
      select: APPROVAL_SELECT,
    }),
    prisma.procurementApproval.count({ where }),
  ]);

  return {
    data: await hydrate(context, rows, reachable),
    pagination: paginationMeta(total, page, limit),
  };
}

/** How many decisions are waiting, for the overview (PRD #19 §22). */
export async function pendingApprovalCount(context: UserContext): Promise<number> {
  if (!can(context, "procurement.approval.view")) return 0;

  const reachable = await reachableRecords(context);
  const recordIds = [...reachable.requests.keys(), ...reachable.orders.keys()];
  if (recordIds.length === 0) return 0;

  return prisma.procurementApproval.count({
    where: { companyId: context.companyId, status: "PENDING", recordId: { in: recordIds } },
  });
}

/** One record's approval history, newest first (PRD #19 §156, §157). */
export async function approvalHistory(
  context: UserContext,
  type: ProcurementApprovalRecordType,
  recordId: string,
): Promise<ProcurementApprovalDTO[]> {
  if (!can(context, "procurement.view")) return [];

  const rows = await prisma.procurementApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  if (rows.length === 0) return [];
  return hydrate(context, rows, await reachableRecords(context));
}
