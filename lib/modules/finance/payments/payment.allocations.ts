import { Prisma, type PaymentDirection, type PaymentStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { acceptsDisbursement } from "../expenses/expense.status";
import { acceptsPayment } from "../invoices/invoice.status";
import { allocatedByPayment, lockRow, outstandingForExpense, outstandingForInvoice, paidByInstallment } from "../finance.settlement";
import { clampAtZero, subtract, toAmountString, ZERO, type Money } from "../finance.money";

/**
 * Allocating money (E-05F §31-§34, §72, §77-§81).
 *
 * The one place a payment is pointed at what it settles — an installment of a
 * sale contract, an invoice, both when the invoice bills that installment, or an
 * expense — and the one place the two ceilings are enforced:
 *
 *   a payment is never allocated beyond its own amount (§79), and
 *   nothing is allocated beyond what it still has outstanding (§80).
 *
 * Both are recalculated inside the caller's transaction after the rows are
 * locked — the payment first, then the contract, invoice or expense it settles —
 * so two allocations racing for the last euro leave one allocation and one
 * refusal. Every path locks in that order, which is what keeps them from
 * deadlocking one another.
 *
 * An allocation is never edited. A correction reverses it with a reason and the
 * row stays (§81).
 */

type Tx = Prisma.TransactionClient;

export type AllocationTarget = { installmentId: string } | { invoiceId: string } | { expenseId: string };

export type LockedPayment = {
  id: string;
  companyId: string;
  direction: PaymentDirection;
  status: PaymentStatus;
  amount: Money;
  currency: string;
  clientId: string | null;
  contractId: string | null;
  projectId: string | null;
};

export type AllocationResult = {
  allocationId: string;
  amount: Money;
  contractId: string | null;
  installmentId: string | null;
  invoiceId: string | null;
  expenseId: string | null;
};

const PAYMENT_LOCK_SELECT = { id: true, companyId: true, direction: true, status: true, amount: true, currency: true, clientId: true, contractId: true, projectId: true } as const;

function refuse(code: string, message: string, status: "CONFLICT" | "VALIDATION_ERROR" = "VALIDATION_ERROR"): AccessError {
  return new AccessError(status, message, { code });
}

/** The payment, held for the rest of the transaction (§78, §79). */
export async function lockPayment(tx: Tx, companyId: string, paymentId: string): Promise<LockedPayment> {
  await lockRow(tx, "payments", paymentId);
  const payment = await tx.payment.findFirst({ where: { companyId, id: paymentId }, select: PAYMENT_LOCK_SELECT });
  if (!payment) throw new AccessError("NOT_FOUND", "That payment could not be found.");
  return payment;
}

/** What is still free to allocate on a payment: its amount less its unreversed allocations (§34). */
export async function unallocatedOn(tx: Tx, payment: Pick<LockedPayment, "id" | "amount">): Promise<Money> {
  const allocated = (await allocatedByPayment([payment.id], tx)).get(payment.id) ?? ZERO;
  return clampAtZero(subtract(payment.amount, allocated));
}

function money(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value);
}

/**
 * Allocates `amount` of a locked payment to one target. The caller has already
 * authorised the person for the payment and the target; this checks that the
 * money fits.
 */
export async function allocate(tx: Tx, context: UserContext, payment: LockedPayment, target: AllocationTarget, rawAmount: Prisma.Decimal.Value): Promise<AllocationResult> {
  const amount = money(rawAmount);
  if (!amount.greaterThan(0)) throw refuse("ALLOCATION_AMOUNT_INVALID", "An allocation must be greater than zero.");
  if (payment.status !== "RECORDED") throw refuse("PAYMENT_VOIDED", "This payment has been voided, so none of it can be allocated.", "CONFLICT");

  const free = await unallocatedOn(tx, payment);
  if (free.lessThanOrEqualTo(0)) throw refuse("PAYMENT_FULLY_ALLOCATED", "This payment is already fully allocated.", "CONFLICT");
  if (amount.greaterThan(free)) {
    throw refuse("ALLOCATION_EXCEEDS_PAYMENT", `That is more than the ${toAmountString(free)} ${payment.currency} still unallocated on this payment.`);
  }

  const resolved =
    "expenseId" in target
      ? await expenseTarget(tx, payment, target.expenseId, amount)
      : "invoiceId" in target
        ? await invoiceTarget(tx, payment, target.invoiceId, amount)
        : await installmentTarget(tx, payment, target.installmentId, amount);

  const allocation = await tx.paymentAllocation.create({
    data: {
      companyId: payment.companyId,
      paymentId: payment.id,
      contractId: resolved.contractId,
      installmentId: resolved.installmentId,
      invoiceId: resolved.invoiceId,
      expenseId: resolved.expenseId,
      amount,
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PAYMENT_ALLOCATED,
      entity: { type: "Payment", id: payment.id, label: resolved.label },
      projectId: payment.projectId,
      after: { paymentId: payment.id, allocationId: allocation.id, contractId: resolved.contractId, installmentId: resolved.installmentId, invoiceId: resolved.invoiceId, expenseId: resolved.expenseId, amount: toAmountString(amount), currency: payment.currency },
    },
    { tx },
  );

  return { allocationId: allocation.id, amount, contractId: resolved.contractId, installmentId: resolved.installmentId, invoiceId: resolved.invoiceId, expenseId: resolved.expenseId };
}

type Resolved = { contractId: string | null; installmentId: string | null; invoiceId: string | null; expenseId: string | null; label: string };

async function expenseTarget(tx: Tx, payment: LockedPayment, expenseId: string, amount: Money): Promise<Resolved> {
  if (payment.direction !== "DISBURSEMENT") throw refuse("ALLOCATION_TARGET_INVALID", "Money received cannot pay an expense.");
  await lockRow(tx, "expenses", expenseId);
  const expense = await tx.expense.findFirst({ where: { companyId: payment.companyId, id: expenseId }, select: { id: true, status: true, currency: true, totalAmount: true, expenseNumber: true, description: true } });
  if (!expense) throw refuse("ALLOCATION_TARGET_INVALID", "That expense does not exist.");
  if (!acceptsDisbursement(expense.status)) throw refuse("EXPENSE_NOT_PAYABLE", "Only an approved expense can be paid.", "CONFLICT");
  if (expense.currency !== payment.currency) throw refuse("CURRENCY_MISMATCH", `This payment is in ${payment.currency} and the expense in ${expense.currency}.`);
  const outstanding = await outstandingForExpense(tx, expense.id, expense.totalAmount);
  if (amount.greaterThan(outstanding)) throw refuse("ALLOCATION_EXCEEDS_OUTSTANDING", `That is more than the ${toAmountString(outstanding)} ${expense.currency} still outstanding on this expense.`);
  return { contractId: null, installmentId: null, invoiceId: null, expenseId: expense.id, label: expense.expenseNumber ?? expense.description };
}

async function invoiceTarget(tx: Tx, payment: LockedPayment, invoiceId: string, amount: Money): Promise<Resolved> {
  if (payment.direction !== "RECEIPT") throw refuse("ALLOCATION_TARGET_INVALID", "Money paid out cannot settle an invoice.");
  const head = await tx.invoice.findFirst({ where: { companyId: payment.companyId, id: invoiceId }, select: { installmentId: true } });
  if (!head) throw refuse("ALLOCATION_TARGET_INVALID", "That invoice does not exist.");
  // An invoice for an installment is settled by what is allocated to the installment (E-05F §26).
  if (head.installmentId) return installmentTarget(tx, payment, head.installmentId, amount, { requireSentInvoice: invoiceId });

  await lockRow(tx, "invoices", invoiceId);
  const invoice = await tx.invoice.findFirst({ where: { companyId: payment.companyId, id: invoiceId }, select: { id: true, invoiceNumber: true, status: true, currency: true, totalAmount: true, clientId: true } });
  if (!invoice) throw refuse("ALLOCATION_TARGET_INVALID", "That invoice does not exist.");
  if (!acceptsPayment(invoice.status)) throw refuse("INVOICE_NOT_PAYABLE", "Payments can only be recorded against an invoice that has been sent.", "CONFLICT");
  if (invoice.clientId !== payment.clientId) throw refuse("ALLOCATION_TARGET_INVALID", "That invoice bills a different client from the one who paid.");
  if (payment.contractId) throw refuse("ALLOCATION_TARGET_INVALID", "A payment against a sale contract settles that contract's installments.");
  if (invoice.currency !== payment.currency) throw refuse("CURRENCY_MISMATCH", `This payment is in ${payment.currency} and the invoice in ${invoice.currency}.`);
  const outstanding = await outstandingForInvoice(tx, invoice.id, invoice.totalAmount);
  if (amount.greaterThan(outstanding)) {
    throw refuse("ALLOCATION_EXCEEDS_OUTSTANDING", `That is more than the ${toAmountString(outstanding)} ${invoice.currency} still outstanding. V0.1 does not hold customer credit.`);
  }
  return { contractId: null, installmentId: null, invoiceId: invoice.id, expenseId: null, label: invoice.invoiceNumber };
}

async function installmentTarget(tx: Tx, payment: LockedPayment, installmentId: string, amount: Money, options: { requireSentInvoice?: string } = {}): Promise<Resolved> {
  if (payment.direction !== "RECEIPT") throw refuse("ALLOCATION_TARGET_INVALID", "Money paid out cannot settle an installment.");
  const head = await tx.paymentInstallment.findFirst({ where: { companyId: payment.companyId, id: installmentId }, select: { contractId: true } });
  if (!head) throw refuse("ALLOCATION_TARGET_INVALID", "That installment does not exist.");
  // Every payment on one contract queues behind the contract (§78, §80).
  await lockRow(tx, "contracts", head.contractId);
  const installment = await tx.paymentInstallment.findFirst({
    where: { companyId: payment.companyId, id: installmentId },
    select: {
      id: true,
      label: true,
      amount: true,
      currency: true,
      contractId: true,
      schedule: { select: { status: true } },
      invoices: { where: { status: { notIn: ["CANCELLED", "ARCHIVED"] } }, select: { id: true, status: true }, take: 1 },
    },
  });
  if (!installment) throw refuse("ALLOCATION_TARGET_INVALID", "That installment does not exist.");
  if (installment.schedule.status !== "ACTIVE") throw refuse("SCHEDULE_NOT_ACTIVE", "Payments are allocated to installments of the active payment schedule.", "CONFLICT");

  // Money settling a contract's installment is recorded against that contract, so the
  // contract's paid and unallocated figures always come from the same payments (§91).
  if (payment.contractId !== installment.contractId) throw refuse("ALLOCATION_TARGET_INVALID", "That installment belongs to another contract.");
  if (installment.currency !== payment.currency) throw refuse("CURRENCY_MISMATCH", `This payment is in ${payment.currency} and the installment in ${installment.currency}.`);

  const invoice = installment.invoices[0] ?? null;
  if (options.requireSentInvoice && (invoice?.id !== options.requireSentInvoice || !acceptsPayment(invoice.status))) {
    throw refuse("INVOICE_NOT_PAYABLE", "Payments can only be recorded against an invoice that has been sent.", "CONFLICT");
  }

  const paid = (await paidByInstallment([installment.id], tx)).get(installment.id) ?? ZERO;
  const outstanding = clampAtZero(subtract(installment.amount, paid));
  if (outstanding.lessThanOrEqualTo(0)) throw refuse("INSTALLMENT_PAID", `${installment.label} is already paid in full.`, "CONFLICT");
  if (amount.greaterThan(outstanding)) {
    throw refuse("ALLOCATION_EXCEEDS_OUTSTANDING", `That is more than the ${toAmountString(outstanding)} ${installment.currency} still outstanding on ${installment.label}.`);
  }
  return { contractId: installment.contractId, installmentId: installment.id, invoiceId: invoice?.id ?? null, expenseId: null, label: installment.label };
}

/**
 * Reverses one allocation with a reason (§81): the money goes back to being
 * unallocated on its payment, and the row stays as history. Conditional on it
 * not being reversed already, so two corrections cannot both land.
 */
export async function reverseAllocation(tx: Tx, context: UserContext, allocationId: string, reason: string): Promise<{ paymentId: string; contractId: string | null; projectId: string | null }> {
  const head = await tx.paymentAllocation.findFirst({ where: { companyId: context.companyId, id: allocationId }, select: { paymentId: true } });
  if (!head) throw new AccessError("NOT_FOUND", "That allocation could not be found.");
  const payment = await lockPayment(tx, context.companyId, head.paymentId);
  const allocation = await tx.paymentAllocation.findFirst({
    where: { companyId: context.companyId, id: allocationId },
    select: { id: true, amount: true, contractId: true, installmentId: true, invoiceId: true, expenseId: true, reversedAt: true },
  });
  if (!allocation) throw new AccessError("NOT_FOUND", "That allocation could not be found.");
  if (allocation.contractId) await lockRow(tx, "contracts", allocation.contractId);

  const reversed = await tx.paymentAllocation.updateMany({
    where: { companyId: context.companyId, id: allocation.id, reversedAt: null },
    data: { reversedAt: new Date(), reversedByMemberId: context.membershipId, reversalReason: reason },
  });
  if (reversed.count === 0) throw refuse("ALLOCATION_ALREADY_REVERSED", "This allocation has already been reversed.", "CONFLICT");

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PAYMENT_ALLOCATION_CORRECTED,
      entity: { type: "Payment", id: payment.id, label: payment.id },
      projectId: payment.projectId,
      before: { allocationId: allocation.id, amount: toAmountString(allocation.amount), reversed: false },
      after: { paymentId: payment.id, allocationId: allocation.id, contractId: allocation.contractId, installmentId: allocation.installmentId, invoiceId: allocation.invoiceId, expenseId: allocation.expenseId, amount: toAmountString(allocation.amount), currency: payment.currency, reversed: true, reason },
    },
    { tx },
  );
  return { paymentId: payment.id, contractId: allocation.contractId, projectId: payment.projectId };
}
