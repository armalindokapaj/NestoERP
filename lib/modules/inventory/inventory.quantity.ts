import { Prisma } from "@prisma/client";

/**
 * Inventory arithmetic (PRD #20 §72, §241, §242).
 *
 * Quantities carry four decimals and never become JavaScript numbers on the way
 * to a decision. Cement is bought by the cubic metre and steel by the tonne;
 * `0.1 + 0.2` is the wrong tool for deciding whether there is enough of either
 * (PRD #20 §242).
 */

export const QUANTITY_DP = 4;

export function quantity(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** Rounds to the stored precision, so a stored value and a computed one agree. */
export function toStoredQuantity(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return quantity(value).toDecimalPlaces(QUANTITY_DP, Prisma.Decimal.ROUND_HALF_UP);
}

/** "42", not "42.0000" — trailing zeros are noise on a quantity (PRD #20 §272). */
export function quantityString(value: Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return value.toDecimalPlaces(QUANTITY_DP).toString();
}

export const ZERO = new Prisma.Decimal(0);

export function isPositive(value: Prisma.Decimal): boolean {
  return value.greaterThan(ZERO);
}

export function sum(values: (Prisma.Decimal | null | undefined)[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value ?? ZERO), ZERO);
}
