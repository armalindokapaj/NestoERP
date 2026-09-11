import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { clampAtZero, subtract, ZERO, type Money } from "./finance.money";

/**
 * How much has actually been paid (PRD #15 §43, §268, §269).
 *
 * One grouped aggregate for a whole page of records rather than one query per
 * row: a fifty-invoice list must not become fifty-one round trips
 * (PRD #15 §268).
 *
 * Only `RECORDED` payments count. A voided payment leaves its row behind as
 * history but stops contributing the moment it is voided (PRD #15 §86).
 */

export type SettlementMap = Map<string, Money>;

export async function paidByInvoice(
  invoiceIds: string[],
  client: Prisma.TransactionClient = prisma,
): Promise<SettlementMap> {
  if (invoiceIds.length === 0) return new Map();

  const rows = await client.payment.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoiceIds }, status: "RECORDED" },
    _sum: { amount: true },
  });

  return new Map(
    rows
      .filter((row): row is typeof row & { invoiceId: string } => row.invoiceId !== null)
      .map((row) => [row.invoiceId, row._sum.amount ?? ZERO]),
  );
}

export async function paidByExpense(
  expenseIds: string[],
  client: Prisma.TransactionClient = prisma,
): Promise<SettlementMap> {
  if (expenseIds.length === 0) return new Map();

  const rows = await client.payment.groupBy({
    by: ["expenseId"],
    where: { expenseId: { in: expenseIds }, status: "RECORDED" },
    _sum: { amount: true },
  });

  return new Map(
    rows
      .filter((row): row is typeof row & { expenseId: string } => row.expenseId !== null)
      .map((row) => [row.expenseId, row._sum.amount ?? ZERO]),
  );
}

export function settlementFor(total: Money, paid: Money | undefined) {
  const paidAmount = paid ?? ZERO;
  return { paid: paidAmount, outstanding: clampAtZero(subtract(total, paidAmount)) };
}

/**
 * The outstanding balance, read inside a transaction (PRD #15 §83, §84).
 *
 * Recording a payment recalculates this *within* the same transaction rather
 * than trusting a figure read a moment earlier, so two people paying the same
 * invoice at once cannot both be told there is room.
 */
export async function outstandingForInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  total: Money,
): Promise<Money> {
  const sum = await tx.payment.aggregate({
    where: { invoiceId, status: "RECORDED" },
    _sum: { amount: true },
  });
  return clampAtZero(subtract(total, sum._sum.amount ?? ZERO));
}

export async function outstandingForExpense(
  tx: Prisma.TransactionClient,
  expenseId: string,
  total: Money,
): Promise<Money> {
  const sum = await tx.payment.aggregate({
    where: { expenseId, status: "RECORDED" },
    _sum: { amount: true },
  });
  return clampAtZero(subtract(total, sum._sum.amount ?? ZERO));
}
