import { Prisma, type ExpenseStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import { businessDateString } from "../finance.fields";
import { toAmountString } from "../finance.money";
import { hasCompanyFinanceScope } from "../finance.scope";
import { paidByExpense, settlementFor } from "../finance.settlement";
import type { ExpenseDetailDTO, ExpenseSummaryDTO, RecordCapabilities } from "../finance.types";
import { calculateExpenseTotal } from "../invoices/invoice.calculation";
import { expenseSettlement } from "../invoices/invoice.status";
import * as repository from "./expense.repository";
import type { CreateExpenseInput, ExpenseListQuery, UpdateExpenseInput } from "./expense.schema";
import {
  CANCELLABLE_EXPENSE_STATUSES,
  canTransitionExpense,
  isExpenseArchivable,
  isExpenseEditable,
  isExpenseSubmittable,
} from "./expense.status";

/**
 * Expenses (PRD #15 §87–§102).
 *
 * An expense becomes *actual cost* when it is approved, not when it is paid
 * (PRD #15 §118). That is why an approved expense cannot be archived: budget vs
 * actual is calculated from approved expenses, and hiding one would silently
 * move every variance figure that depends on it.
 *
 * A project-linked expense must match its project's approved budget currency.
 * V0.1 has no FX engine, so an expense in a second currency would make the
 * project's actual cost unaddable (PRD #15 §34, §95).
 */

const MODULE = "finance" as const;
const ENTITY = "Expense";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listExpenses(context: UserContext, query: ExpenseListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.view");

  const { rows, total } = await repository.listExpenses(context, query);
  const paid = await paidByExpense(rows.map((row) => row.id));

  let data = rows.map((row) => toSummaryDTO(row, paid.get(row.id)));

  if (query.settlement?.length) {
    const wanted = new Set(query.settlement);
    data = data.filter((expense) => wanted.has(expense.settlementStatus));
  }

  return { data, pagination: paginationMeta(total, query.page, query.limit) };
}

export async function getExpense(
  context: UserContext,
  expenseId: string,
): Promise<ExpenseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.view");

  const expense = assertFound(await repository.findExpenseInScope(context, expenseId));

  const [paid, payments, history, creator] = await Promise.all([
    paidByExpense([expense.id]),
    can(context, "finance.payment.view")
      ? prisma.payment.findMany({
          where: { expenseId: expense.id },
          orderBy: { paymentDate: "desc" },
          select: {
            id: true,
            direction: true,
            paymentDate: true,
            currency: true,
            amount: true,
            method: true,
            reference: true,
            notes: true,
            status: true,
            voidReason: true,
          },
        })
      : Promise.resolve([]),
    approvals.approvalHistory(context, "EXPENSE", expense.id),
    memberRef(expense.createdByMemberId),
  ]);

  const settlement = settlementFor(expense.totalAmount, paid.get(expense.id));

  return {
    ...toSummaryDTO(expense, paid.get(expense.id)),
    netAmount: toAmountString(expense.netAmount),
    taxAmount: toAmountString(expense.taxAmount),
    notes: expense.notes,
    archivedAt: expense.archivedAt?.toISOString() ?? null,
    payments: payments.map((payment) => ({
      id: payment.id,
      direction: payment.direction,
      paymentDate: businessDateString(payment.paymentDate),
      currency: payment.currency,
      amount: toAmountString(payment.amount),
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      status: payment.status,
      voidReason: payment.voidReason,
      relatedRecord: {
        type: "EXPENSE" as const,
        id: expense.id,
        reference: expense.expenseNumber ?? expense.description,
      },
      capabilities: {
        canVoid: payment.status === "RECORDED" && can(context, "finance.payment.void"),
      },
    })),
    approvals: history,
    createdBy: creator,
    createdAt: expense.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, expense, settlement.outstanding.greaterThan(0)),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createExpense(
  context: UserContext,
  input: CreateExpenseInput,
): Promise<ExpenseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.create");

  const project = await validateProject(context, input.projectId, input.currency);
  const totals = calculateExpenseTotal(input.netAmount, input.taxAmount);

  const expenseId = await prisma.$transaction(async (tx) => {
    if (input.expenseNumber) {
      await assertNumberIsFree(tx, context, input.expenseNumber, null);
    }

    const expense = await tx.expense.create({
      data: {
        companyId: context.companyId,
        expenseNumber: input.expenseNumber ?? null,
        projectId: project?.id ?? null,
        expenseDate: input.expenseDate,
        category: input.category,
        description: input.description,
        payeeName: input.payeeName ?? null,
        currency: input.currency,
        netAmount: totals.netAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expense.id,
      action: "FINANCE_EXPENSE_CREATED",
      message: `recorded expense ${input.description}`,
      metadata: {
        currency: input.currency,
        totalAmount: toAmountString(totals.totalAmount),
        category: input.category,
      } as Prisma.InputJsonValue,
    });

    return expense.id;
  });

  return getExpense(context, expenseId);
}

export async function updateExpense(
  context: UserContext,
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<ExpenseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.update");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  if (!isExpenseEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only a draft or rejected expense can be edited. Approved cost is fixed.",
    );
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This expense was updated by another user. Refresh and review the latest changes.",
    );
  }

  const project = await validateProject(context, input.projectId, input.currency);
  const totals = calculateExpenseTotal(input.netAmount, input.taxAmount);

  await prisma.$transaction(async (tx) => {
    if (input.expenseNumber) {
      await assertNumberIsFree(tx, context, input.expenseNumber, expenseId);
    }

    await tx.expense.update({
      where: { id: expenseId },
      data: {
        expenseNumber: input.expenseNumber ?? null,
        projectId: project?.id ?? null,
        expenseDate: input.expenseDate,
        category: input.category,
        description: input.description,
        payeeName: input.payeeName ?? null,
        currency: input.currency,
        netAmount: totals.netAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_UPDATED",
      message: `updated expense ${input.description}`,
      metadata: changeMetadata({
        totalAmount: {
          from: toAmountString(existing.totalAmount),
          to: toAmountString(totals.totalAmount),
        },
      }),
    });
  });

  return getExpense(context, expenseId);
}

export async function submitExpense(context: UserContext, expenseId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.submit");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  if (!isExpenseSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", `A ${existing.status.toLowerCase()} expense cannot be submitted.`);
  }

  await prisma.$transaction(async (tx) => {
    await moveStatus(tx, context, existing, "PENDING_APPROVAL");
    await approvals.openApproval(tx, context, "EXPENSE", expenseId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_SUBMITTED",
      message: `submitted expense ${existing.description} for approval`,
    });
  });
}

export async function approveExpense(
  context: UserContext,
  expenseId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "EXPENSE");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "EXPENSE", expenseId);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "APPROVED");
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_APPROVED",
      message: `approved expense ${existing.description}`,
    });

    // `required` policy: the evidence commits with the approval (PRD #28 §136).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_EXPENSE_APPROVED,
        entity: { type: ENTITY, id: expenseId, label: existing.expenseNumber },
        before: { status: existing.status },
        after: {
          status: "APPROVED",
          amount: existing.totalAmount.toString(),
          currency: existing.currency,
        },
        reason: note,
      },
      { tx },
    );
  });
}

export async function rejectExpense(
  context: UserContext,
  expenseId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "EXPENSE");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "EXPENSE", expenseId);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "REJECTED");
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_REJECTED",
      message: `rejected expense ${existing.description}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_EXPENSE_REJECTED,
        entity: { type: ENTITY, id: expenseId, label: existing.expenseNumber },
        before: { status: existing.status },
        after: { status: "REJECTED" },
        reason,
      },
      { tx },
    );
  });
}

export async function cancelExpense(context: UserContext, expenseId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.cancel");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  if (!CANCELLABLE_EXPENSE_STATUSES.includes(existing.status)) {
    throw new AccessError("CONFLICT", `A ${existing.status.toLowerCase()} expense cannot be cancelled.`);
  }

  await prisma.$transaction(async (tx) => {
    const paid = await tx.payment.aggregate({
      where: { expenseId, status: "RECORDED" },
      _sum: { amount: true },
    });

    if ((paid._sum.amount ?? new Prisma.Decimal(0)).greaterThan(0)) {
      throw new AccessError(
        "CONFLICT",
        "This expense has recorded payments. Void them before cancelling it.",
      );
    }

    await moveStatus(tx, context, existing, "CANCELLED");
    await approvals.cancelPendingApprovals(tx, context, "EXPENSE", expenseId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_CANCELLED",
      message: `cancelled expense ${existing.description}`,
    });
  });
}

export async function archiveExpense(context: UserContext, expenseId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.archive");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  if (!isExpenseArchivable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Approved cost stays visible — it is what budget vs actual is calculated from.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expenseId },
      data: {
        status: "ARCHIVED",
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await approvals.cancelPendingApprovals(tx, context, "EXPENSE", expenseId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_ARCHIVED",
      message: `archived expense ${existing.description}`,
    });
  });
}

export async function restoreExpense(context: UserContext, expenseId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.restore");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  if (existing.status !== "ARCHIVED") {
    throw new AccessError("CONFLICT", "This expense is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expenseId },
      data: {
        status: existing.preArchiveStatus ?? "DRAFT",
        preArchiveStatus: null,
        archivedAt: null,
        archivedByMemberId: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_RESTORED",
      message: `restored expense ${existing.description}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: ExpenseStatus },
  next: ExpenseStatus,
): Promise<void> {
  if (!canTransitionExpense(existing.status, next)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `An expense cannot move from ${existing.status} to ${next}.`,
    );
  }

  const result = await tx.expense.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: next, updatedByMemberId: context.membershipId },
  });

  if (result.count === 0) {
    throw new AccessError("CONFLICT", "This expense changed while you were working on it.");
  }
}

/**
 * Validates the project an expense is filed against (PRD #15 §95).
 *
 * The currency check is the important one: if the project has an approved
 * budget, an expense in a different currency could never be added into its
 * actual cost, so it is refused rather than silently excluded (PRD #15 §34).
 */
async function validateProject(
  context: UserContext,
  projectId: string | undefined,
  currency: string,
) {
  if (!projectId) {
    // A company-level expense needs company-level finance scope: a
    // project-scoped reader has no project to authorise it against
    // (PRD #15 §211).
    if (!hasCompanyFinanceScope(context)) {
      throw new AccessError(
        "FORBIDDEN",
        "Your finance access is limited to your projects, so an expense needs a project.",
      );
    }
    return null;
  }

  const project = await prisma.project.findFirst({
    where: {
      AND: [
        buildProjectScopeWhere(context),
        { id: projectId, archivedAt: null, status: { not: "ARCHIVED" } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");

  const budget = await prisma.projectBudget.findFirst({
    where: { projectId, isCurrent: true, status: "APPROVED" },
    select: { currency: true },
  });

  if (budget && budget.currency !== currency) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `${project.name} is budgeted in ${budget.currency}. V0.1 does not convert currencies, so its costs must be in ${budget.currency} too.`,
    );
  }

  return project;
}

async function assertNumberIsFree(
  tx: Prisma.TransactionClient,
  context: UserContext,
  expenseNumber: string,
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.expense.findFirst({
    where: {
      companyId: context.companyId,
      expenseNumber,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (clash) {
    throw new AccessError(
      "CONFLICT",
      `Expense number ${expenseNumber} is already used in this company.`,
    );
  }
}

async function memberRef(memberId: string) {
  const member = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (!member) return null;
  return { memberId: member.id, fullName: `${member.user.firstName} ${member.user.lastName}` };
}

export function toSummaryDTO(
  row: repository.ExpenseRow,
  paidAmount: Prisma.Decimal | undefined,
): ExpenseSummaryDTO {
  const settlement = settlementFor(row.totalAmount, paidAmount);

  return {
    id: row.id,
    expenseNumber: row.expenseNumber,
    description: row.description,
    category: row.category,
    project: row.project,
    payeeName: row.payeeName,
    expenseDate: businessDateString(row.expenseDate),
    currency: row.currency,
    totalAmount: toAmountString(row.totalAmount),
    paidAmount: toAmountString(settlement.paid),
    outstandingAmount: toAmountString(settlement.outstanding),
    status: row.status,
    settlementStatus: expenseSettlement(settlement),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  expense: repository.ExpenseDetailRow,
  hasOutstanding: boolean,
): RecordCapabilities {
  const archived = expense.status === "ARCHIVED";

  return {
    canEdit: !archived && isExpenseEditable(expense.status) && can(context, "finance.expense.update"),
    canSubmit:
      !archived && isExpenseSubmittable(expense.status) && can(context, "finance.expense.submit"),
    canApprove:
      expense.status === "PENDING_APPROVAL" && approvals.canApproveType(context, "EXPENSE"),
    canReject:
      expense.status === "PENDING_APPROVAL" && approvals.canRejectType(context, "EXPENSE"),
    canMarkSent: false,
    canRecordPayment:
      expense.status === "APPROVED" && hasOutstanding && can(context, "finance.payment.create"),
    canCancel:
      !archived &&
      CANCELLABLE_EXPENSE_STATUSES.includes(expense.status) &&
      can(context, "finance.expense.cancel"),
    canClose: false,
    canRevise: false,
    canArchive:
      !archived && isExpenseArchivable(expense.status) && can(context, "finance.expense.archive"),
    canRestore: archived && can(context, "finance.expense.restore"),
    canViewActivity: can(context, "finance.activity.view"),
    canViewDocuments: can(context, "finance.document.view") && can(context, "document.view"),
  };
}
