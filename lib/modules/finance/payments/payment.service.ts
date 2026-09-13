import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { businessDateString } from "../finance.fields";
import { money, toAmountString } from "../finance.money";
import {
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
  buildPaymentScopeWhere,
} from "../finance.scope";
import { outstandingForExpense, outstandingForInvoice } from "../finance.settlement";
import type { PaymentSummaryDTO } from "../finance.types";
import { acceptsPayment } from "../invoices/invoice.status";
import { acceptsDisbursement } from "../expenses/expense.status";
import type { CreatePaymentInput, PaymentListQuery } from "./payment.schema";

/**
 * Payments (PRD #15 §70–§86).
 *
 * The rule this file exists to hold is that a payment can never exceed what is
 * still owed (PRD #15 §79). Checking that *before* the transaction would be a
 * race: two people paying the last €500 of an invoice at the same moment would
 * both read €500 outstanding and both be allowed. So the outstanding balance is
 * recalculated inside the transaction, after the row is locked, and the second
 * payment is refused (PRD #15 §83, §84).
 *
 * A payment is never deleted. Voiding leaves the row and its reason behind and
 * stops it counting — which is the difference between a correction and a
 * cover-up (PRD #15 §85).
 */

const MODULE = "finance" as const;
const ENTITY = "Payment";

const PAYMENT_SELECT = {
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
  invoice: { select: { id: true, invoiceNumber: true } },
  expense: { select: { id: true, expenseNumber: true, description: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

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
        { invoice: { invoiceNumber: { contains: term, mode: "insensitive" } } },
        { expense: { description: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.direction?.length) filters.push({ direction: { in: query.direction } });
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.method?.length) filters.push({ method: { in: query.method } });
  if (query.invoiceId) filters.push({ invoiceId: query.invoiceId });
  if (query.expenseId) filters.push({ expenseId: query.expenseId });
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

export async function getPayment(
  context: UserContext,
  paymentId: string,
): Promise<PaymentSummaryDTO> {
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

export async function recordPayment(
  context: UserContext,
  input: CreatePaymentInput,
): Promise<string> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.create");

  const amount = money(input.amount);

  const paymentId = await prisma.$transaction(async (tx) => {
    if (input.invoiceId) return recordReceipt(tx, context, input, amount);
    return recordDisbursement(tx, context, input, amount);
  });

  return paymentId;
}

async function recordReceipt(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreatePaymentInput,
  amount: Prisma.Decimal,
): Promise<string> {
  // Read through the caller's own scope, so an invoice they cannot open reads
  // as "does not exist" rather than as a payable target (PRD #15 §216).
  const invoice = await tx.invoice.findFirst({
    where: { AND: [buildInvoiceScopeWhere(context), { id: input.invoiceId }] },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      totalAmount: true,
      clientId: true,
    },
  });

  if (!invoice) throw new AccessError("VALIDATION_ERROR", "That invoice does not exist.");

  if (!acceptsPayment(invoice.status)) {
    throw new AccessError(
      "CONFLICT",
      "Payments can only be recorded against an invoice that has been sent.",
    );
  }

  const outstanding = await outstandingForInvoice(tx, invoice.id, invoice.totalAmount);

  if (amount.greaterThan(outstanding)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `That is more than the ${toAmountString(outstanding)} ${invoice.currency} still outstanding. V0.1 does not hold customer credit.`,
    );
  }

  const payment = await tx.payment.create({
    data: {
      companyId: context.companyId,
      direction: "RECEIPT",
      invoiceId: invoice.id,
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
      after: {
        amount: amount.toString(),
        currency: invoice.currency,
        direction: "RECEIPT",
        status: "RECORDED",
      },
    },
    { tx },
  );

  return payment.id;
}

async function recordDisbursement(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: CreatePaymentInput,
  amount: Prisma.Decimal,
): Promise<string> {
  const expense = await tx.expense.findFirst({
    where: { AND: [buildExpenseScopeWhere(context), { id: input.expenseId }] },
    select: {
      id: true,
      expenseNumber: true,
      description: true,
      status: true,
      currency: true,
      totalAmount: true,
    },
  });

  if (!expense) throw new AccessError("VALIDATION_ERROR", "That expense does not exist.");

  if (!acceptsDisbursement(expense.status)) {
    throw new AccessError("CONFLICT", "Only an approved expense can be paid.");
  }

  const outstanding = await outstandingForExpense(tx, expense.id, expense.totalAmount);

  if (amount.greaterThan(outstanding)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `That is more than the ${toAmountString(outstanding)} ${expense.currency} still outstanding on this expense.`,
    );
  }

  const payment = await tx.payment.create({
    data: {
      companyId: context.companyId,
      direction: "DISBURSEMENT",
      expenseId: expense.id,
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
      entity: {
        type: ENTITY,
        id: payment.id,
        label: expense.expenseNumber ?? expense.description,
      },
      after: {
        amount: amount.toString(),
        currency: expense.currency,
        direction: "DISBURSEMENT",
        status: "RECORDED",
      },
    },
    { tx },
  );

  return payment.id;
}

export async function voidPayment(
  context: UserContext,
  paymentId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "finance.payment.void");

  const payment = assertFound(
    await prisma.payment.findFirst({
      where: { AND: [buildPaymentScopeWhere(context), { id: paymentId }] },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        invoice: { select: { invoiceNumber: true } },
        expense: { select: { expenseNumber: true, description: true } },
      },
    }),
  );

  if (payment.status !== "RECORDED") {
    throw new AccessError("CONFLICT", "This payment has already been voided.");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.payment.updateMany({
      where: { id: paymentId, status: "RECORDED" },
      data: {
        status: "VOIDED",
        voidedByMemberId: context.membershipId,
        voidedAt: new Date(),
        voidReason: reason,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "This payment has already been voided.");
    }

    const target =
      payment.invoice?.invoiceNumber ??
      payment.expense?.expenseNumber ??
      payment.expense?.description ??
      "a finance record";

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
        before: {
          amount: payment.amount.toString(),
          currency: payment.currency,
          status: "RECORDED",
        },
        after: { status: "VOIDED" },
        reason,
      },
      { tx },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* DTO                                                                         */
/* -------------------------------------------------------------------------- */

export function toSummaryDTO(context: UserContext, row: PaymentRow): PaymentSummaryDTO {
  const related = row.invoice
    ? { type: "INVOICE" as const, id: row.invoice.id, reference: row.invoice.invoiceNumber }
    : row.expense
      ? {
          type: "EXPENSE" as const,
          id: row.expense.id,
          reference: row.expense.expenseNumber ?? row.expense.description,
        }
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
    capabilities: {
      canVoid: row.status === "RECORDED" && can(context, "finance.payment.void"),
    },
  };
}
