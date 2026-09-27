import { Prisma, type ExpenseStatus } from "@prisma/client";
import { targetsOf, transitionFor } from "@/lib/core/state/machine";
import { applyTransition } from "@/lib/core/state/transition";
import { allocateNumber } from "@/lib/core/numbering/numbering.service";

import { can } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { AccessError, assertFound, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import { inGroupWorkspace } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { businessDateString, keepOrSet } from "../finance.fields";
import { toAmountString } from "../finance.money";
import { hasCompanyFinanceScope } from "../finance.scope";
import { assertSettlementIntegrity, EXPORT_ROW_LIMIT, exportLimitExceeded, measuredRegister } from "../finance.register";
import { paidByExpense, settlementFor } from "../finance.settlement";
import { companyOf, financeContexts, financeExportContexts, narrowToCompany } from "../finance.workspace";
import { PAYMENT_SELECT, toSummaryDTO as paymentSummaryDTO } from "../payments/payment.service";
import type { CompanyRef, ExpenseDetailDTO, ExpenseSummaryDTO, FinanceListSummary, RecordCapabilities, WithCompany } from "../finance.types";
import { calculateExpenseTotal } from "../invoices/invoice.calculation";
import { expenseSettlement } from "../invoices/invoice.status";
import * as repository from "./expense.repository";
import { EXPENSE_TOTAL_MESSAGE, expenseTotalIsPositive, type CreateExpenseInput, type ExpenseListQuery, type UpdateExpenseInput } from "./expense.schema";
import { expenseMachine, type ExpenseTransitionAction } from "./expense.machine";
import {
  CANCELLABLE_EXPENSE_STATUSES,
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

/** What every register read may be told: the Group `company` filter, and a clock for tests. */
export type ExpenseRegisterOptions = { company?: string | null; now?: Date };

export type ExpenseListResult = {
  data: ExpenseSummaryDTO[];
  pagination: ReturnType<typeof paginationMeta>;
  summary: FinanceListSummary;
};

/**
 * The expenses of one company (PRD #15 §167; AUD-01 §4-§6): settlement filtered
 * in the database before the count, the totals and the page.
 */
export async function listExpenses(context: UserContext, query: ExpenseListQuery, options: Pick<ExpenseRegisterOptions, "now"> = {}): Promise<ExpenseListResult> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.view");
  return measuredRegister("expenses", "list", "company", () => registerPage([context], query, options.now, false));
}

/**
 * The expense list of the active workspace (Workspace Context §36, §45): a
 * company workspace is `listExpenses`, untouched; the Group workspace is every
 * company the reader may open Finance in, each row naming its company, narrowed
 * by `options.company` only within those companies (§57, §86).
 */
export async function listExpensesForWorkspace(
  session: UserContext,
  query: ExpenseListQuery,
  options: ExpenseRegisterOptions = {},
): Promise<ExpenseListResult> {
  if (!inGroupWorkspace(session)) return listExpenses(session, query, options);

  // Nothing readable is an empty answer, not an error (§76).
  const readable = narrowToCompany(await financeContexts(session, "finance.expense.view"), options.company);
  return measuredRegister("expenses", "list", "group", () => registerPage(readable, query, options.now, true));
}

async function registerPage(contexts: UserContext[], query: ExpenseListQuery, now: Date | undefined, grouped: boolean): Promise<ExpenseListResult> {
  const evaluatedAt = now ?? new Date();
  const { rows, summary, page } = await repository.readExpenseRegister(contexts, query, {
    evaluatedAt,
    window: { kind: "page", page: query.page, limit: query.limit },
  });
  const companies = new Map(contexts.map((context) => [context.companyId, companyOf(context)]));
  const data = rows.map((row) => {
    const dto = toSummaryDTO(row, row.settlement?.paidAmount);
    return grouped ? { ...dto, company: companies.get(row.companyId)! } : dto;
  });
  return { data, pagination: paginationMeta(summary.matchingCount, page, query.limit), summary };
}

/**
 * Every expense the register's filters match, for a CSV file (AUD-01 §8): the
 * list's read without the page, refused whole beyond `EXPORT_ROW_LIMIT`.
 */
export async function exportExpensesForWorkspace(
  session: UserContext,
  query: ExpenseListQuery,
  options: ExpenseRegisterOptions = {},
): Promise<{ rows: Array<WithCompany<ExpenseSummaryDTO>>; evaluatedAt: Date }> {
  const scope = inGroupWorkspace(session) ? "group" : "company";
  return measuredRegister("expenses", "export", scope, async () => {
    const contexts = await financeExportContexts(session, "finance.expense.view", options.company);
    const evaluatedAt = options.now ?? new Date();
    const { rows, summary } = await repository.readExpenseRegister(contexts, query, {
      evaluatedAt,
      window: { kind: "export", limit: EXPORT_ROW_LIMIT },
      timeoutMs: 30_000,
    });
    if (summary.matchingCount > EXPORT_ROW_LIMIT) throw exportLimitExceeded();
    const companies = new Map<string, CompanyRef>(contexts.map((context) => [context.companyId, companyOf(context)]));
    return {
      rows: rows.map((row) => ({ ...toSummaryDTO(row, row.settlement?.paidAmount), company: companies.get(row.companyId)! })),
      evaluatedAt,
    };
  });
}

export async function getExpense(
  context: UserContext,
  expenseId: string,
): Promise<ExpenseDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.expense.view");

  const expense = assertFound(await repository.findExpenseInScope(context, expenseId));

  const [paid, settlementRow, payments, history, creator] = await Promise.all([
    paidByExpense([expense.id]),
    repository.expenseSettlementRow(expense.id),
    can(context, "finance.payment.view")
      ? prisma.payment.findMany({
          // Every payment with money allocated to this expense (E-05F §31).
          where: { allocations: { some: { expenseId: expense.id } } },
          // Newest first, the id breaking a same-day tie, so the order holds still (AUD-08 §4, DT-04).
          orderBy: [{ paymentDate: "desc" }, { id: "asc" }],
          select: PAYMENT_SELECT,
        })
      : Promise.resolve([]),
    approvals.approvalHistory(context, "EXPENSE", expense.id),
    memberRef(expense.createdByMemberId),
  ]);

  assertSettlementIntegrity("expenses", settlementRow?.integrityIssues ?? 0);
  const settlement = settlementFor(expense.totalAmount, paid.get(expense.id));

  return {
    ...toSummaryDTO(expense, paid.get(expense.id)),
    netAmount: toAmountString(expense.netAmount),
    taxAmount: toAmountString(expense.taxAmount),
    notes: expense.notes,
    archivedAt: expense.archivedAt?.toISOString() ?? null,
    payments: payments.map((payment) => paymentSummaryDTO(context, payment)),
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
    // Null when the company has set expenses to MANUAL, in which case whatever
    // was typed applies — including nothing at all (PRD #24 §102, §114).
    const allocated = await allocateNumber(
      { companyId: context.companyId, moduleKey: MODULE, entityType: "expense" },
      { tx, occurredAt: input.expenseDate },
    );
    const expenseNumber = allocated ?? input.expenseNumber ?? null;

    if (expenseNumber) {
      await assertNumberIsFree(tx, context, expenseNumber, null);
    }

    const expense = await tx.expense.create({
      data: {
        companyId: context.companyId,
        expenseNumber,
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

  // Absent keeps what is saved; empty or null clears (AUD-09 §4, FV-05). The
  // edit form always sends every field, so this only changes what an API
  // caller that leaves a key out gets: its saved value, not an erasure.
  const projectId = keepOrSet(input.projectId, existing.project?.id ?? null);
  const expenseNumber = keepOrSet(input.expenseNumber, existing.expenseNumber);
  const taxAmount = input.taxAmount ?? existing.taxAmount.toString();
  if (!expenseTotalIsPositive(input.netAmount, toAmountString(taxAmount))) {
    throw new AccessError("VALIDATION_ERROR", EXPENSE_TOTAL_MESSAGE, { netAmount: [EXPENSE_TOTAL_MESSAGE] });
  }

  const project = await validateProject(context, projectId ?? undefined, input.currency);
  const totals = calculateExpenseTotal(input.netAmount, taxAmount);

  await prisma.$transaction(async (tx) => {
    if (expenseNumber) {
      await assertNumberIsFree(tx, context, expenseNumber, expenseId);
    }

    // Conditional on the status the edit was checked against, so an expense
    // submitted or approved in the meantime is not rewritten (PRD #47 §66).
    const written = await tx.expense.updateMany({
      where: { id: expenseId, companyId: context.companyId, status: existing.status },
      data: {
        expenseNumber,
        projectId: project?.id ?? null,
        expenseDate: input.expenseDate,
        category: input.category,
        description: input.description,
        payeeName: input.payeeName,
        currency: input.currency,
        netAmount: totals.netAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        notes: input.notes,
        updatedByMemberId: context.membershipId,
      },
    });
    if (written.count === 0) {
      throw stateDenied("This expense changed while you were working on it. Refresh and review it.");
    }

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
    await moveStatus(tx, context, existing, "submit");
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
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "EXPENSE");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "EXPENSE", expenseId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "approve");
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
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "EXPENSE");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "EXPENSE", expenseId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "reject", reason);
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

/**
 * Returns the expense for revision (PRD #41 §48): back to draft with the
 * approver's reason, so the requester can correct it and submit it again as a
 * new approval cycle. The decision history keeps the returned cycle.
 */
export async function returnExpense(
  context: UserContext,
  expenseId: string,
  reason: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanReject(context, "EXPENSE");

  const existing = assertFound(await repository.findExpenseInScope(context, expenseId));

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "EXPENSE", expenseId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await moveStatus(tx, context, existing, "return", reason);
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: expenseId,
      action: "FINANCE_EXPENSE_RETURNED",
      message: `returned expense ${existing.description} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
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
    const paid = (await paidByExpense([expenseId], tx)).get(expenseId) ?? new Prisma.Decimal(0);

    if (paid.greaterThan(0)) {
      throw new AccessError(
        "CONFLICT",
        "This expense has recorded payments. Void them before cancelling it.",
      );
    }

    await moveStatus(tx, context, existing, "cancel");
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
    await applyTransition(tx, {
      machine: expenseMachine,
      action: "archive",
      id: expenseId,
      context,
      from: existing.status,
      data: {
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
    await applyTransition(tx, {
      machine: expenseMachine,
      action: "restore",
      id: expenseId,
      context,
      from: existing.status,
      to: existing.preArchiveStatus ?? "DRAFT",
      data: { preArchiveStatus: null, archivedAt: null, archivedByMemberId: null },
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

/**
 * Moves an expense by one of its machine's actions, from the status it was read in.
 *
 * A move the workflow never makes is refused as the validation error it has
 * always been, before anything is written. The write goes through
 * `applyTransition`, conditional on the status we read, so two people acting at
 * once cannot both win (PRD #49 §64).
 */
async function moveStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  existing: { id: string; status: ExpenseStatus },
  action: ExpenseTransitionAction,
  reason?: string,
): Promise<void> {
  const transition = transitionFor(expenseMachine, action)!;
  if (!transition.from.includes(existing.status)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `An expense cannot move from ${existing.status} to ${targetsOf(transition)[0]}.`,
    );
  }

  await applyTransition(tx, {
    machine: expenseMachine,
    action,
    id: existing.id,
    context,
    from: existing.status,
    reason,
    data: { updatedByMemberId: context.membershipId },
  });
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
  // Beside the picker, whatever the reason: a forged, foreign or archived id
  // answers exactly like a missing one (AUD-09 §5, FV-09; PRD #47 §20).
  if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.", { projectId: ["Choose a project you have access to."] });

  const budget = await prisma.projectBudget.findFirst({
    where: { projectId, isCurrent: true, status: "APPROVED" },
    select: { currency: true },
  });

  if (budget && budget.currency !== currency) {
    const message = `${project.name} is budgeted in ${budget.currency}. V0.1 does not convert currencies, so its costs must be in ${budget.currency} too.`;
    throw new AccessError("VALIDATION_ERROR", message, { currency: [message] });
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
