import { Prisma, type FinanceApprovalRecordType } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { toAmountString } from "../finance.money";
import {
  buildBudgetScopeWhere,
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
} from "../finance.scope";
import type { FinanceApprovalDTO } from "../finance.types";

/**
 * Finance approvals (PRD #15 §137–§146).
 *
 * One approval row per submission, never reopened: a rejected record that is
 * fixed and resubmitted gets a *new* row, so the record's history reads as the
 * sequence of decisions it actually was (PRD #15 §64, §145).
 *
 * Two rules live here and nowhere else:
 *
 *   1. Approval authority is a permission, not a consequence of being able to
 *      edit the record (PRD #15 §18).
 *   2. The submitter cannot decide their own submission unless they hold
 *      `finance.approval.self` — because "who checked this?" must have an
 *      answer other than "the person who wrote it" (PRD #15 §19).
 */

const MODULE = "finance" as const;

/** The grant that decides each record type, beyond `finance.approval.decide`. */
const APPROVE_PERMISSION: Record<FinanceApprovalRecordType, Permission> = {
  INVOICE: "finance.invoice.approve",
  EXPENSE: "finance.expense.approve",
  BUDGET: "finance.budget.approve",
  COMMITMENT: "finance.commitment.approve",
};

const REJECT_PERMISSION: Record<FinanceApprovalRecordType, Permission> = {
  INVOICE: "finance.invoice.reject",
  EXPENSE: "finance.expense.reject",
  BUDGET: "finance.budget.reject",
  COMMITMENT: "finance.commitment.reject",
};

export function canApproveType(context: UserContext, type: FinanceApprovalRecordType): boolean {
  return can(context, "finance.approval.decide") || can(context, APPROVE_PERMISSION[type]);
}

export function canRejectType(context: UserContext, type: FinanceApprovalRecordType): boolean {
  return can(context, "finance.approval.decide") || can(context, REJECT_PERMISSION[type]);
}

export function assertCanApprove(context: UserContext, type: FinanceApprovalRecordType): void {
  if (!canApproveType(context, type)) {
    assertPermission(context, APPROVE_PERMISSION[type]);
  }
}

export function assertCanReject(context: UserContext, type: FinanceApprovalRecordType): void {
  if (!canRejectType(context, type)) {
    assertPermission(context, REJECT_PERMISSION[type]);
  }
}

/**
 * Separation of duties (PRD #15 §19).
 *
 * Checked against the *submission*, not the record's author: the person who put
 * it forward for approval is the one who must not wave it through.
 */
export function assertNotSelfApproval(context: UserContext, submittedByMemberId: string): void {
  if (submittedByMemberId !== context.membershipId) return;
  if (can(context, "finance.approval.self")) return;

  throw new AccessError(
    "FORBIDDEN",
    "You submitted this record, so somebody else has to decide it.",
  );
}

/* -------------------------------------------------------------------------- */
/* Writes, used inside each record service's transaction                       */
/* -------------------------------------------------------------------------- */

/**
 * Opens an approval cycle.
 *
 * Any cycle still pending on this record is cancelled first, so a record can
 * never carry two live approvals — which is what a double-clicked submit button
 * would otherwise produce (PRD #15 §392, §393).
 */
export async function openApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: FinanceApprovalRecordType,
  recordId: string,
): Promise<string> {
  await tx.financeApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });

  const approval = await tx.financeApproval.create({
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

/** The pending cycle for a record, or a conflict if there is none. */
export async function requirePendingApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: FinanceApprovalRecordType,
  recordId: string,
) {
  const approval = await tx.financeApproval.findFirst({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedByMemberId: true },
  });

  if (!approval) {
    throw new AccessError("CONFLICT", "This record is not waiting for a decision.");
  }

  return approval;
}

/**
 * Closes an approval cycle.
 *
 * The update is conditional on the row still being PENDING and reports how many
 * rows it touched, so two approvers pressing at the same moment cannot both
 * succeed (PRD #15 §280).
 */
export async function decideApproval(
  tx: Prisma.TransactionClient,
  context: UserContext,
  approvalId: string,
  decision: "APPROVED" | "REJECTED",
  note: string | null,
): Promise<void> {
  const result = await tx.financeApproval.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: {
      status: decision,
      decidedByMemberId: context.membershipId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This record has already been decided.");
  }
}

/** Cancelling or archiving a record closes whatever was pending on it. */
export async function cancelPendingApprovals(
  tx: Prisma.TransactionClient,
  context: UserContext,
  type: FinanceApprovalRecordType,
  recordId: string,
): Promise<void> {
  await tx.financeApproval.updateMany({
    where: { companyId: context.companyId, recordType: type, recordId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), decidedByMemberId: context.membershipId },
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

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
} satisfies Prisma.FinanceApprovalSelect;

/**
 * The approval queue (PRD #15 §141, §143).
 *
 * Scope is applied by resolving each record type through its own scope clause
 * and listing only the approvals whose record survived. A project-scoped
 * approver therefore sees approvals for their projects and nothing else — the
 * queue cannot become a back door onto company records (PRD #15 §143).
 */
export async function listApprovals(
  context: UserContext,
  options: { status?: "PENDING" | "DECIDED"; page?: number; limit?: number } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.approval.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const reachable = await reachableRecordIds(context);

  const where: Prisma.FinanceApprovalWhereInput = {
    companyId: context.companyId,
    ...(options.status === "PENDING" ? { status: "PENDING" } : {}),
    ...(options.status === "DECIDED" ? { status: { not: "PENDING" } } : {}),
    OR: [
      { recordType: "INVOICE", recordId: { in: reachable.INVOICE } },
      { recordType: "EXPENSE", recordId: { in: reachable.EXPENSE } },
      { recordType: "BUDGET", recordId: { in: reachable.BUDGET } },
      { recordType: "COMMITMENT", recordId: { in: reachable.COMMITMENT } },
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.financeApproval.findMany({
      where,
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      skip: skipFor(page, limit),
      take: limit,
      select: APPROVAL_SELECT,
    }),
    prisma.financeApproval.count({ where }),
  ]);

  const data = await hydrate(context, rows);
  return { data, pagination: paginationMeta(total, page, limit) };
}

/** Every approval cycle for one record, newest first (PRD #15 §145). */
export async function approvalHistory(
  context: UserContext,
  type: FinanceApprovalRecordType,
  recordId: string,
): Promise<FinanceApprovalDTO[]> {
  if (!can(context, "finance.approval.view")) return [];

  const rows = await prisma.financeApproval.findMany({
    where: { companyId: context.companyId, recordType: type, recordId },
    orderBy: { submittedAt: "desc" },
    select: APPROVAL_SELECT,
  });

  return hydrate(context, rows);
}

type ApprovalRow = Prisma.FinanceApprovalGetPayload<{ select: typeof APPROVAL_SELECT }>;

/**
 * Which finance records this reader can reach, by type.
 *
 * Four scoped id queries rather than four joins per approval row: the queue is
 * small, and this keeps one interpretation of "reachable" — the record's own
 * (PRD #15 §268).
 */
async function reachableRecordIds(context: UserContext) {
  const [invoices, expenses, budgets, commitments] = await Promise.all([
    can(context, "finance.invoice.view")
      ? prisma.invoice.findMany({ where: buildInvoiceScopeWhere(context), select: { id: true } })
      : Promise.resolve([]),
    can(context, "finance.expense.view")
      ? prisma.expense.findMany({ where: buildExpenseScopeWhere(context), select: { id: true } })
      : Promise.resolve([]),
    can(context, "finance.budget.view")
      ? prisma.projectBudget.findMany({
          where: buildBudgetScopeWhere(context),
          select: { id: true },
        })
      : Promise.resolve([]),
    can(context, "finance.commitment.view")
      ? prisma.commitment.findMany({
          where: buildCommitmentScopeWhere(context),
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    INVOICE: invoices.map((row) => row.id),
    EXPENSE: expenses.map((row) => row.id),
    BUDGET: budgets.map((row) => row.id),
    COMMITMENT: commitments.map((row) => row.id),
  };
}

/** Attaches the record summary and the member names each approval refers to. */
async function hydrate(
  context: UserContext,
  rows: ApprovalRow[],
): Promise<FinanceApprovalDTO[]> {
  if (rows.length === 0) return [];

  const byType = (type: FinanceApprovalRecordType) =>
    rows.filter((row) => row.recordType === type).map((row) => row.recordId);

  const memberIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.decidedByMemberId
          ? [row.submittedByMemberId, row.decidedByMemberId]
          : [row.submittedByMemberId],
      ),
    ),
  ];

  const [invoices, expenses, budgets, commitments, members] = await Promise.all([
    prisma.invoice.findMany({
      where: { id: { in: byType("INVOICE") } },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        currency: true,
        project: { select: { name: true } },
        client: { select: { name: true } },
      },
    }),
    prisma.expense.findMany({
      where: { id: { in: byType("EXPENSE") } },
      select: {
        id: true,
        expenseNumber: true,
        description: true,
        totalAmount: true,
        currency: true,
        payeeName: true,
        project: { select: { name: true } },
      },
    }),
    prisma.projectBudget.findMany({
      where: { id: { in: byType("BUDGET") } },
      select: {
        id: true,
        version: true,
        totalAmount: true,
        currency: true,
        project: { select: { name: true, code: true } },
      },
    }),
    prisma.commitment.findMany({
      where: { id: { in: byType("COMMITMENT") } },
      select: {
        id: true,
        reference: true,
        description: true,
        amount: true,
        currency: true,
        counterpartyName: true,
        project: { select: { name: true } },
      },
    }),
    prisma.companyMember.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  const memberName = new Map(
    members.map((member) => [
      member.id,
      `${member.user.firstName} ${member.user.lastName}`,
    ]),
  );

  const records = new Map<string, FinanceApprovalDTO["record"]>();
  for (const row of invoices) {
    records.set(`INVOICE:${row.id}`, {
      reference: row.invoiceNumber,
      amount: toAmountString(row.totalAmount),
      currency: row.currency,
      projectName: row.project?.name ?? null,
      counterpartyName: row.client.name,
    });
  }
  for (const row of expenses) {
    records.set(`EXPENSE:${row.id}`, {
      reference: row.expenseNumber ?? row.description,
      amount: toAmountString(row.totalAmount),
      currency: row.currency,
      projectName: row.project?.name ?? null,
      counterpartyName: row.payeeName,
    });
  }
  for (const row of budgets) {
    records.set(`BUDGET:${row.id}`, {
      reference: `${row.project.code} budget v${row.version}`,
      amount: toAmountString(row.totalAmount),
      currency: row.currency,
      projectName: row.project.name,
      counterpartyName: null,
    });
  }
  for (const row of commitments) {
    records.set(`COMMITMENT:${row.id}`, {
      reference: row.reference ?? row.description,
      amount: toAmountString(row.amount),
      currency: row.currency,
      projectName: row.project?.name ?? null,
      counterpartyName: row.counterpartyName,
    });
  }

  return rows.map((row) => ({
    id: row.id,
    recordType: row.recordType,
    recordId: row.recordId,
    status: row.status,
    record: records.get(`${row.recordType}:${row.recordId}`) ?? {
      reference: "Record unavailable",
      amount: toAmountString(0),
      currency: "",
      projectName: null,
      counterpartyName: null,
    },
    submittedBy: {
      memberId: row.submittedByMemberId,
      fullName: memberName.get(row.submittedByMemberId) ?? "Unknown",
    },
    submittedAt: row.submittedAt.toISOString(),
    decision: row.decidedByMemberId
      ? {
          memberId: row.decidedByMemberId,
          fullName: memberName.get(row.decidedByMemberId) ?? "Unknown",
          decidedAt: (row.decidedAt ?? row.submittedAt).toISOString(),
          note: row.decisionNote,
        }
      : null,
    canDecide:
      row.status === "PENDING" &&
      canApproveType(context, row.recordType) &&
      (row.submittedByMemberId !== context.membershipId ||
        can(context, "finance.approval.self")),
  }));
}
