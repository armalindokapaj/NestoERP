import { add, money, percentOf, roundMoney, type Money } from "../finance.money";

/**
 * Invoice arithmetic (PRD #15 §52, §53, §54, §206).
 *
 * The browser may compute a preview; these are the numbers that get stored.
 * Nothing here reads a total from its input — every figure is derived from
 * quantity, unit price and tax rate, so a crafted request cannot invoice a
 * client for one amount while showing another (PRD #15 §220).
 *
 * Rounding order is fixed and tested: each line is rounded to currency
 * precision first, and the invoice totals are sums of already-rounded lines.
 * The alternative — summing unrounded lines and rounding once — gives a
 * different answer, and an invoice whose lines do not add up to its total is
 * the kind of thing a client notices (PRD #15 §206).
 */

export type LineInput = {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  taxRate: string | number;
};

export type CalculatedLine = {
  description: string;
  quantity: Money;
  unitPrice: Money;
  taxRate: Money;
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
  sortOrder: number;
};

export type CalculatedInvoice = {
  lines: CalculatedLine[];
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
};

export function calculateLine(line: LineInput, sortOrder: number): CalculatedLine {
  const quantity = money(line.quantity);
  const unitPrice = money(line.unitPrice);
  const taxRate = money(line.taxRate);

  const subtotal = roundMoney(quantity.times(unitPrice));
  const taxAmount = percentOf(subtotal, taxRate);

  return {
    description: line.description,
    quantity,
    unitPrice,
    taxRate,
    subtotal,
    taxAmount,
    totalAmount: roundMoney(subtotal.plus(taxAmount)),
    sortOrder,
  };
}

export function calculateInvoice(lines: LineInput[]): CalculatedInvoice {
  const calculated = lines.map((line, index) => calculateLine(line, index));

  return {
    lines: calculated,
    subtotal: roundMoney(add(...calculated.map((line) => line.subtotal))),
    taxAmount: roundMoney(add(...calculated.map((line) => line.taxAmount))),
    totalAmount: roundMoney(add(...calculated.map((line) => line.totalAmount))),
  };
}

/** `netAmount + taxAmount`, computed rather than accepted (PRD #15 §92). */
export function calculateExpenseTotal(
  netAmount: string | number,
  taxAmount: string | number,
): { netAmount: Money; taxAmount: Money; totalAmount: Money } {
  const net = roundMoney(netAmount);
  const tax = roundMoney(taxAmount);
  return { netAmount: net, taxAmount: tax, totalAmount: roundMoney(net.plus(tax)) };
}

/** `sum(plannedAmount)` across budget lines (PRD #15 §107). */
export function calculateBudgetTotal(lines: { plannedAmount: string | number }[]): Money {
  return roundMoney(add(...lines.map((line) => money(line.plannedAmount))));
}
