import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { clampAtZero, subtract, ZERO, type Money } from "./finance.money";

/**
 * How much has actually been paid (PRD #15 §43, §268, §269; E-05F §31, §35, §36).
 *
 * Money settles a record through its allocations: a payment's amount says what
 * was received, its allocations say what that money paid. An invoice, an
 * expense, an installment and a sale contract are all settled the same way —
 * the sum of the allocations that point at them — so there is one engine for
 * every question "how much of this is paid?" (E-05F §31).
 *
 * Only a *live* allocation counts: one not reversed, of a payment still
 * `RECORDED`. A voided payment and a reversed allocation leave their rows behind
 * as history and stop contributing the moment they are corrected (PRD #15 §86;
 * E-05F §81).
 *
 * One grouped aggregate for a whole page of records rather than one query per
 * row: a fifty-invoice list must not become fifty-one round trips
 * (PRD #15 §268).
 */

export type SettlementMap = Map<string, Money>;

/** The allocations that count: not reversed, of a payment that still stands. */
export const LIVE_ALLOCATION = { reversedAt: null, payment: { is: { status: "RECORDED" } } } satisfies Prisma.PaymentAllocationWhereInput;

type Target = "invoiceId" | "expenseId" | "installmentId" | "contractId" | "paymentId";

async function paidBy(target: Target, ids: string[], client: Prisma.TransactionClient): Promise<SettlementMap> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await client.paymentAllocation.groupBy({
    by: [target],
    where: { ...LIVE_ALLOCATION, [target]: { in: wanted } },
    _sum: { amount: true },
  });
  const map: SettlementMap = new Map();
  for (const row of rows) {
    const id = row[target];
    if (id) map.set(id, row._sum.amount ?? ZERO);
  }
  return map;
}

export function paidByInvoice(invoiceIds: string[], client: Prisma.TransactionClient = prisma): Promise<SettlementMap> {
  return paidBy("invoiceId", invoiceIds, client);
}

export function paidByExpense(expenseIds: string[], client: Prisma.TransactionClient = prisma): Promise<SettlementMap> {
  return paidBy("expenseId", expenseIds, client);
}

/** Paid against each installment of a sale contract's schedule (E-05F §21, §22). */
export function paidByInstallment(installmentIds: string[], client: Prisma.TransactionClient = prisma): Promise<SettlementMap> {
  return paidBy("installmentId", installmentIds, client);
}

/** Paid against each sale contract, over every schedule it has had (E-05F §35, §36). */
export function paidByContract(contractIds: string[], client: Prisma.TransactionClient = prisma): Promise<SettlementMap> {
  return paidBy("contractId", contractIds, client);
}

/** How much of each payment its live allocations already use (E-05F §34, §79). */
export function allocatedByPayment(paymentIds: string[], client: Prisma.TransactionClient = prisma): Promise<SettlementMap> {
  const wanted = [...new Set(paymentIds)];
  if (wanted.length === 0) return Promise.resolve(new Map());
  return client.paymentAllocation
    .groupBy({ by: ["paymentId"], where: { reversedAt: null, paymentId: { in: wanted } }, _sum: { amount: true } })
    .then((rows) => new Map(rows.map((row) => [row.paymentId, row._sum.amount ?? ZERO])));
}

export function settlementFor(total: Money, paid: Money | undefined) {
  const paidAmount = paid ?? ZERO;
  return { paid: paidAmount, outstanding: clampAtZero(subtract(total, paidAmount)) };
}

/**
 * The outstanding balance, read inside a transaction (PRD #15 §83, §84).
 *
 * Recording a payment locks the record it settles and recalculates this *within*
 * the same transaction rather than trusting a figure read a moment earlier, so
 * two people paying the same invoice at once cannot both be told there is room.
 */
export async function outstandingForInvoice(tx: Prisma.TransactionClient, invoiceId: string, total: Money): Promise<Money> {
  const paid = (await paidByInvoice([invoiceId], tx)).get(invoiceId) ?? ZERO;
  return clampAtZero(subtract(total, paid));
}

export async function outstandingForExpense(tx: Prisma.TransactionClient, expenseId: string, total: Money): Promise<Money> {
  const paid = (await paidByExpense([expenseId], tx)).get(expenseId) ?? ZERO;
  return clampAtZero(subtract(total, paid));
}

/** Holds a row for the rest of the transaction, so money moving against it queues (PRD #15 §83). */
export async function lockRow(tx: Prisma.TransactionClient, table: "invoices" | "expenses" | "contracts" | "payments", id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`;
}
