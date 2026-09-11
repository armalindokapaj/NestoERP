import { Prisma } from "@prisma/client";

/**
 * The one money helper (PRD #15 §30, §205, §206).
 *
 * Financial arithmetic never touches a JavaScript `number`. Every persisted
 * amount is a `Prisma.Decimal`, every amount that crosses the API is a decimal
 * string, and rounding happens in exactly one place — so a total computed in
 * the invoice service and the same total computed in a report agree to the
 * cent (PRD #15 §31, §229).
 */

export type Money = Prisma.Decimal;

/** Currency precision. V0.1 supports minor units of two digits (PRD #15 §32). */
export const MONEY_SCALE = 2;

/** Quantity, unit price and tax rate carry more precision than a total. */
export const RATE_SCALE = 4;

export const ZERO: Money = new Prisma.Decimal(0);

export function money(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value);
}

/**
 * Rounds to currency precision, half away from zero.
 *
 * Half-up on a positive amount is what an invoice reader expects, and the
 * symmetric rule is the one that survives a credit note later.
 */
export function roundMoney(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function roundRate(value: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(value).toDecimalPlaces(RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

export function add(...values: Prisma.Decimal.Value[]): Money {
  return values.reduce<Money>((total, value) => total.plus(value), ZERO);
}

export function subtract(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(a).minus(b);
}

export function multiply(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(a).times(b);
}

/** `base × percent / 100`, rounded to currency precision (PRD #15 §53). */
export function percentOf(base: Prisma.Decimal.Value, percent: Prisma.Decimal.Value): Money {
  return roundMoney(new Prisma.Decimal(base).times(percent).dividedBy(100));
}

export function isPositive(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).greaterThan(0);
}

export function isNegative(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).lessThan(0);
}

export function isZero(value: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(value).isZero();
}

export function greaterThan(a: Prisma.Decimal.Value, b: Prisma.Decimal.Value): boolean {
  return new Prisma.Decimal(a).greaterThan(b);
}

/** Never below zero: an outstanding balance is a debt, not a credit (PRD #15 §79). */
export function clampAtZero(value: Prisma.Decimal.Value): Money {
  const amount = new Prisma.Decimal(value);
  return amount.lessThan(0) ? ZERO : amount;
}

/**
 * The API representation (PRD #15 §30, §229).
 *
 * Always a string with the currency's own precision: `"12500.50"`, never
 * `12500.4999999997` and never a bare `number` a JSON parser will round for us.
 */
export function toAmountString(value: Prisma.Decimal.Value | null | undefined): string {
  if (value === null || value === undefined) return roundMoney(0).toFixed(MONEY_SCALE);
  return roundMoney(value).toFixed(MONEY_SCALE);
}

export function toRateString(value: Prisma.Decimal.Value | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return new Prisma.Decimal(value).toString();
}

/**
 * A percentage for display, as a string with one decimal place.
 *
 * A zero denominator answers `null` rather than `Infinity` or `0`: "utilisation
 * of a budget that does not exist" has no honest number (PRD #15 §151).
 */
export function percentageString(
  part: Prisma.Decimal.Value,
  whole: Prisma.Decimal.Value,
): string | null {
  const denominator = new Prisma.Decimal(whole);
  if (denominator.isZero()) return null;
  return new Prisma.Decimal(part)
    .dividedBy(denominator)
    .times(100)
    .toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(1);
}
