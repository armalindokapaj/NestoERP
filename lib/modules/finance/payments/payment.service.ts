import { Prisma } from "@prisma/client";
import { applyTransition } from "@/lib/core/state/transition";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { businessDateString } from "../finance.fields";
import { money, subtract, toAmountString, ZERO } from "../finance.money";
import { buildExpenseScopeWhere, buildInvoiceScopeWhere, buildPaymentScopeWhere } from "../finance.scope";
import type { PaymentAllocationDTO, PaymentSummaryDTO } from "../finance.types";
import { contractFactsBeforeVoid, recordStatusAfterVoid } from "../units/unit-finance.events";
import { allocate, lockPayment } from "./payment.allocations";
import { paymentMachine } from "./payment.machine";
import type { CreatePaymentInput, PaymentListQuery } from "./payment.schema";

/**
 * Payments (PRD #15 §70–§86; E-05F §29-§34, §81).
 *
 * A payment is the money; its allocations are what the money settles. Recorded
 * here against one invoice or one expense, a payment is allocated to it in full
 * in the same transaction, through the allocation engine that holds the rule
 * this module has always held: nothing is paid beyond what is still owed
 * (PRD #15 §79). That is checked inside the transaction after the invoice or
 * expense is locked, so two people paying the last €500 at once leave one
 * payment and one refusal (PRD #15 §83, §84).
 *
 * A payment is never deleted. Voiding leaves the row, its allocations and its
 * reason behind and stops all of it counting — which is the difference between
 * a correction and a cover-up (PRD #15 §85).
 */

const MODULE = "finance" as const;
const ENTITY = "Payment";

export const PAYMENT_SELECT = {
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
  contractId: true,
  contract: { select: { id: true, contractNumber: true } },
  allocations: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amount: true,
      reversedAt: true,
      reversalReason: true,
      invoiceId: true,
      invoice: { select: { id: true, invoiceNumber: true } },
      expense: { select: { id: true, expenseNumber: true, description: true } },
      installment: { select: { id: true, label: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

const ORDER: Record<string, Prisma.PaymentOrderByWithRelationInput[]> = {
  "date-desc": [{ paymentDate: "desc" }],
  "date-asc": [{ paymentDate: "asc" }],
  "amount-desc": [{ amount: "desc" }],
  "amount-asc": [{ amount: "asc" }],
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listPayments(context: UserContext, query: PaymentListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.view");

  const filters: Prisma.PaymentWhereInput[] = [buildPaymentScopeWhere(context)];

  const search = searchClause(query.search, ["reference", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.PaymentWhereInput),
        { allocations: { some: { invoice: { is: { invoiceNumber: { contains: term, mode: "insensitive" } } } } } },
        { allocations: { some: { expense: { is: { description: { contains: term, mode: "insensitive" } } } } } },
        { contract: { is: { contractNumber: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.direction?.length) filters.push({ direction: { in: query.direction } });
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.method?.length) filters.push({ method: { in: query.method } });
  if (query.invoiceId) filters.push({ allocations: { some: { invoiceId: query.invoiceId } } });
  if (query.expenseId) filters.push({ allocations: { some: { expenseId: query.expenseId } } });
  if (query.currency) filters.push({ currency: query.currency });
  if (query.paidFrom) filters.push({ paymentDate: { gte: query.paidFrom } });
  if (query.paidTo) filters.push({ paymentDate: { lte: query.paidTo } });

  const where: Prisma.PaymentWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: ORDER[query.sort] ?? ORDER["date-desc"],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: PAYMENT_SELECT,
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    data: rows.map((row) => toSummaryDTO(context, row)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getPayment(context: UserContext, paymentId: string): Promise<PaymentSummaryDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.view");

  const payment = assertFound(
    await prisma.payment.findFirst({
      where: { AND: [buildPaymentScopeWhere(context), { id: paymentId }] },
      select: PAYMENT_SELECT,
    }),
  );

  return toSummaryDTO(context, payment);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function recordPayment(context: UserContext, input: CreatePaymentInput): Promise<string> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.create");

  const amount = money(input.amount);

  return prisma.$transaction(async (tx) => {
    if (input.invoiceId) return recordReceipt(tx, context, input, amount);
    return recordDisbursement(tx, context, input, amount);
  });
}

async function recordReceipt(tx: Prisma.TransactionClient, context: UserContext, input: CreatePaymentInput, amount: Prisma.Decimal): Promise<string> {
  // Read through the caller's own scope, so an invoice they cannot open reads
  // as "does not exist" rather than as a payable target (PRD #15 §216).
  const invoice = await tx.invoice.findFirst({
    where: { AND: [buildInvoiceScopeWhere(context), { id: input.invoiceId }] },
    select: { id: true, invoiceNumber: true, currency: true, clientId: true, projectId: true, contractId: true },
  });

  if (!invoice) throw new AccessError("VALIDATION_ERROR", "That invoice does not exist.");
  // An invoice billing a sale contract's installment is collected on the unit's
  // Finance section, where the contract's own permissions apply (E-05F §54).
  if (invoice.contractId) assertPermission(context, "project.unit.finance.record_payment");

  const payment = await tx.payment.create({
    data: {
      companyId: context.companyId,
      direction: "RECEIPT",
      clientId: invoice.clientId,
      contractId: invoice.contractId,
      projectId: invoice.projectId,
      amount,
      // Inherited, never supplied: there is no FX engine to reconcile a
      // mismatch (PRD #15 §76).
      currency: invoice.currency,
      paymentDate: input.paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      status: "RECORDED",
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });

  // The whole amount settles this invoice; the engine refuses more than is owed.
  const locked = await lockPayment(tx, context.companyId, payment.id);
  await allocate(tx, context, locked, { invoiceId: invoice.id }, amount);

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: payment.id,
    action: "FINANCE_PAYMENT_RECORDED",
    message: `recorded ${toAmountString(amount)} ${invoice.currency} against invoice ${invoice.invoiceNumber}`,
    metadata: { invoiceId: invoice.id, direction: "RECEIPT" } as Prisma.InputJsonValue,
  });

  // Money moving is `required` evidence, recorded on the caller's transaction
  // so a payment cannot exist unaudited (PRD #28 §102, §136).
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.FINANCE_PAYMENT_RECORDED,
      entity: { type: ENTITY, id: payment.id, label: invoice.invoiceNumber },
      projectId: invoice.projectId,
      after: { amount: amount.toString(), currency: invoice.currency, direction: "RECEIPT", status: "RECORDED" },
    },
    { tx },
  );

  return payment.id;
}

async function recordDisbursement(tx: Prisma.TransactionClient, context: UserContext, input: CreatePaymentInput, amount: Prisma.Decimal): Promise<string> {
  const expense = await tx.expense.findFirst({
    where: { AND: [buildExpenseScopeWhere(context), { id: input.expenseId }] },
    select: { id: true, expenseNumber: true, description: true, currency: true, projectId: true },
  });

  if (!expense) throw new AccessError("VALIDATION_ERROR", "That expense does not exist.");

  const payment = await tx.payment.create({
    data: {
      companyId: context.companyId,
      direction: "DISBURSEMENT",
      projectId: expense.projectId,
      amount,
      currency: expense.currency,
      paymentDate: input.paymentDate,
      method: input.method,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      status: "RECORDED",
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });

  const locked = await lockPayment(tx, context.companyId, payment.id);
  await allocate(tx, context, locked, { expenseId: expense.id }, amount);

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: ENTITY,
    entityId: payment.id,
    action: "FINANCE_PAYMENT_RECORDED",
    message: `paid ${toAmountString(amount)} ${expense.currency} against ${expense.expenseNumber ?? expense.description}`,
    metadata: { expenseId: expense.id, direction: "DISBURSEMENT" } as Prisma.InputJsonValue,
  });

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.FINANCE_PAYMENT_RECORDED,
      entity: { type: ENTITY, id: payment.id, label: expense.expenseNumber ?? expense.description },
      projectId: expense.projectId,
      after: { amount: amount.toString(), currency: expense.currency, direction: "DISBURSEMENT", status: "RECORDED" },
    },
    { tx },
  );

  return payment.id;
}

/**
 * Voids a payment with a reason (PRD #15 §85; E-05F §81). Its allocations stay
 * on record and stop counting with it. Money recorded against a sale contract is
 * that contract's collection, so voiding it is also the unit's correction grant.
 */
export async function voidPayment(context: UserContext, paymentId: string, reason: string): Promise<{ contractId: string | null }> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.void");

  const payment = assertFound(
    await prisma.payment.findFirst({
      where: { AND: [buildPaymentScopeWhere(context), { id: paymentId }] },
      select: { id: true, status: true, amount: true, currency: true, projectId: true, contractId: true, contract: { select: { contractNumber: true } }, allocations: { take: 1, orderBy: { createdAt: "asc" }, select: { invoice: { select: { invoiceNumber: true } }, expense: { select: { expenseNumber: true, description: true } } } } },
    }),
  );
  if (payment.contractId) assertPermission(context, "project.unit.finance.correct");

  if (payment.status !== "RECORDED") {
    throw new AccessError("CONFLICT", "This payment has already been voided.");
  }
  // A sale contract's figures before, to record the unit's financial status if voiding moves it (E-05F §97).
  const before = payment.contractId ? await contractFactsBeforeVoid(context.companyId, payment.contractId) : undefined;

  await prisma.$transaction(async (tx) => {
    // Conditional on the payment still being recorded, so two people voiding
    // it at once cannot both reverse the same money.
    await applyTransition(tx, {
      machine: paymentMachine,
      action: "void",
      id: paymentId,
      context,
      from: payment.status,
      reason,
      data: {
        voidedByMemberId: context.membershipId,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });

    const first = payment.allocations[0];
    const target = payment.contract?.contractNumber ?? first?.invoice?.invoiceNumber ?? first?.expense?.expenseNumber ?? first?.expense?.description ?? "a finance record";

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: paymentId,
      action: "FINANCE_PAYMENT_VOIDED",
      message: `voided ${toAmountString(payment.amount)} ${payment.currency} against ${target}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });

    // Reversing money is the CRITICAL one in this module (PRD #28 §102).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.FINANCE_PAYMENT_REVERSED,
        entity: { type: ENTITY, id: paymentId, label: target },
        projectId: payment.projectId,
        before: { amount: payment.amount.toString(), currency: payment.currency, status: "RECORDED" },
        after: { status: "VOIDED" },
        reason,
      },
      { tx },
    );
  });
  if (payment.contractId) await recordStatusAfterVoid(context, payment.contractId, before);
  return { contractId: payment.contractId };
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

function allocationDTO(row: PaymentRow["allocations"][number]): PaymentAllocationDTO {
  const [type, targetId, reference] = row.installment
    ? (["INSTALLMENT", row.installment.id, row.installment.label] as const)
    : row.invoice
      ? (["INVOICE", row.invoice.id, row.invoice.invoiceNumber] as const)
      : (["EXPENSE", row.expense!.id, row.expense!.expenseNumber ?? row.expense!.description] as const);
  return { id: row.id, type, targetId, reference, invoiceId: row.invoiceId, amount: toAmountString(row.amount), reversed: row.reversedAt !== null, reversalReason: row.reversalReason };
}

export function toSummaryDTO(context: UserContext, row: PaymentRow): PaymentSummaryDTO {
  const live = row.allocations.filter((allocation) => allocation.reversedAt === null);
  const allocated = live.reduce((sum, allocation) => sum.plus(allocation.amount), ZERO);
  const first = live[0] ?? row.allocations[0];
  const related = row.contract
    ? { type: "CONTRACT" as const, id: row.contract.id, reference: row.contract.contractNumber }
    : first?.invoice
      ? { type: "INVOICE" as const, id: first.invoice.id, reference: first.invoice.invoiceNumber }
      : first?.expense
        ? { type: "EXPENSE" as const, id: first.expense.id, reference: first.expense.expenseNumber ?? first.expense.description }
        : null;

  return {
    id: row.id,
    direction: row.direction,
    paymentDate: businessDateString(row.paymentDate),
    currency: row.currency,
    amount: toAmountString(row.amount),
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    voidReason: row.voidReason,
    relatedRecord: related,
    allocatedAmount: toAmountString(allocated),
    unallocatedAmount: toAmountString(subtract(row.amount, allocated)),
    allocations: row.allocations.map(allocationDTO),
    capabilities: {
      canVoid: row.status === "RECORDED" && can(context, "finance.payment.void") && (row.contractId === null || can(context, "project.unit.finance.correct")),
    },
  };
}
