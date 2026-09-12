import { Prisma } from "@prisma/client";

import { toAmountString } from "@/lib/modules/finance/finance.money";

/**
 * Procurement arithmetic (PRD #19 §190–§194, §240–§243).
 *
 * Quantity carries four decimals, unit price four, and money two. Every total
 * is computed here from the lines rather than trusted from the client: a header
 * total a browser sent is a number nobody checked (PRD #19 §49, §105).
 *
 * Rounding happens once, at the line, and the document total is the sum of
 * rounded lines. Summing unrounded lines and rounding at the end produces a
 * total that disagrees with the column above it by a cent, which is the kind of
 * disagreement a supplier notices.
 */

export const QUANTITY_DP = 4;
export const MONEY_DP = 2;

export type LineInput = {
  quantity: Prisma.Decimal | string | number;
  unitPrice: Prisma.Decimal | string | number;
  taxRate: Prisma.Decimal | string | number;
};

export type LineTotals = {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DP, Prisma.Decimal.ROUND_HALF_UP);
}

/** One priced line: quantity × unit price, then tax on the rounded subtotal. */
export function lineTotals(line: LineInput): LineTotals {
  const subtotal = roundMoney(decimal(line.quantity).mul(decimal(line.unitPrice)));
  const taxAmount = roundMoney(subtotal.mul(decimal(line.taxRate)));
  return { subtotal, taxAmount, totalAmount: subtotal.plus(taxAmount) };
}

/** A document total is the sum of its rounded lines (PRD #19 §105, §193). */
export function documentTotals(lines: LineInput[]): LineTotals {
  let subtotal = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);

  for (const line of lines) {
    const totals = lineTotals(line);
    subtotal = subtotal.plus(totals.subtotal);
    taxAmount = taxAmount.plus(totals.taxAmount);
  }

  return { subtotal, taxAmount, totalAmount: subtotal.plus(taxAmount) };
}

/** Sums lines whose totals were already computed, without rounding twice. */
export function sumLineTotals(lines: LineTotals[]): LineTotals {
  let subtotal = new Prisma.Decimal(0);
  let taxAmount = new Prisma.Decimal(0);

  for (const line of lines) {
    subtotal = subtotal.plus(line.subtotal);
    taxAmount = taxAmount.plus(line.taxAmount);
  }

  return { subtotal, taxAmount, totalAmount: subtotal.plus(taxAmount) };
}

/**
 * A request is estimated, not priced (PRD #19 §48, §49).
 *
 * Its lines carry an optional estimated unit price, and a line with none
 * contributes nothing rather than zero — an unpriced ask is not a free one.
 */
export function estimatedTotal(
  lines: { quantity: Prisma.Decimal | string | number; estimatedUnitPrice: Prisma.Decimal | string | number | null }[],
): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const line of lines) {
    if (line.estimatedUnitPrice === null) continue;
    total = total.plus(roundMoney(decimal(line.quantity).mul(decimal(line.estimatedUnitPrice))));
  }
  return total;
}

export function quantityString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) return "0";
  // Trailing zeros are noise on a quantity: "42" reads better than "42.0000".
  return value.toDecimalPlaces(QUANTITY_DP).toString();
}

export { toAmountString };
