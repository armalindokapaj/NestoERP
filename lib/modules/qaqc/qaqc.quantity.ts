import { Prisma } from "@prisma/client";

/**
 * Quality arithmetic (PRD #21 §91, §220).
 *
 * Quantities carry four decimals and never become JavaScript numbers on the way
 * to a decision. The equation this module exists to hold —
 * `accepted + rejected + conditional = inspected` — has to balance *exactly*,
 * and binary floating point cannot promise that.
 */

export const QUANTITY_DP = 4;

export const ZERO = new Prisma.Decimal(0);

export function quantity(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function toStoredQuantity(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return quantity(value).toDecimalPlaces(QUANTITY_DP, Prisma.Decimal.ROUND_HALF_UP);
}

/** "42", not "42.0000" — trailing zeros are noise on a quantity. */
export function quantityString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return value.toDecimalPlaces(QUANTITY_DP).toString();
}

export function sum(values: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value ?? ZERO), ZERO);
}

export function isPositive(value: Prisma.Decimal): boolean {
  return value.greaterThan(ZERO);
}

export type DecisionQuantities = {
  inspected: Prisma.Decimal;
  accepted: Prisma.Decimal;
  rejected: Prisma.Decimal;
  conditional: Prisma.Decimal;
};

/**
 * Whether a material decision accounts for everything it inspected
 * (PRD #21 §91).
 *
 * Every unit looked at must end up in exactly one bucket. A decision where the
 * three outcomes do not add back to the inspected quantity is a decision that
 * has silently lost material, which is the one thing a goods-inwards record
 * must never do.
 */
export function balances(input: DecisionQuantities): boolean {
  return input.accepted.plus(input.rejected).plus(input.conditional).equals(input.inspected);
}

export function imbalance(input: DecisionQuantities): Prisma.Decimal {
  return input.accepted
    .plus(input.rejected)
    .plus(input.conditional)
    .minus(input.inspected);
}

/**
 * What a decision lets through to stock (PRD #21 §96, §97).
 *
 * Conditional quantity counts as released: it is material the company has
 * decided to use, with a condition recorded against it. Rejected quantity never
 * reaches a warehouse.
 */
export function releasableQuantity(input: DecisionQuantities): Prisma.Decimal {
  return input.accepted.plus(input.conditional);
}
