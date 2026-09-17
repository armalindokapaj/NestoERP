import { Prisma } from "@prisma/client";

import type { PaymentScheduleStatus } from "@prisma/client";
import { DUE_SOON_DAYS, type InstallmentStatus, type UnitFinancialStatus } from "./unit-finance.types";

/**
 * The derivations every Finance surface of a unit agrees on (E-05F §22, §35-§41,
 * §85). Pure: amounts in, statuses out. The inventory computes the same in SQL
 * to filter and count, and its tests hold the two to each other.
 *
 * `today` is the start of the company's local day as a stored business date
 * compares (`lib/core/notifications/company-day.ts`): due dates are calendar
 * facts at midday UTC, so "past due" is `dueDate < today`.
 */

const DAY = 86_400_000;
const ZERO = new Prisma.Decimal(0);

type Amount = Prisma.Decimal.Value;

function dec(value: Amount): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function outstanding(amount: Amount, paid: Amount): Prisma.Decimal {
  const left = dec(amount).minus(paid);
  return left.lessThan(0) ? ZERO : left;
}

/** Contract statuses under which money is owed (§85): signed, in force, or completed. */
export const COLLECTING_CONTRACT_STATUSES = ["SIGNED", "ACTIVE", "COMPLETED"] as const;

export function isCollecting(status: string): boolean {
  return (COLLECTING_CONTRACT_STATUSES as readonly string[]).includes(status);
}

/** A schedule whose installments are owed: the active one, or the one a completed contract closed. */
export function isCurrentSchedule(status: PaymentScheduleStatus): boolean {
  return status === "ACTIVE" || status === "COMPLETED";
}

/**
 * An installment's status (§22), from its schedule, its due date and what is
 * allocated to it — never stored. Past due overrides part payment: €20,000 of
 * €50,000 paid a week late is overdue.
 */
export function installmentStatus(input: { scheduleStatus: PaymentScheduleStatus; amount: Amount; paid: Amount; dueDate: Date; today: Date }): InstallmentStatus {
  const paidInFull = dec(input.paid).greaterThanOrEqualTo(input.amount);
  if (!isCurrentSchedule(input.scheduleStatus) && input.scheduleStatus !== "DRAFT") return paidInFull ? "PAID" : "CANCELLED";
  if (paidInFull) return "PAID";
  if (input.scheduleStatus === "DRAFT") return "UPCOMING";
  if (input.dueDate.getTime() < input.today.getTime()) return "OVERDUE";
  if (dec(input.paid).greaterThan(0)) return "PARTIALLY_PAID";
  if (input.dueDate.getTime() < input.today.getTime() + (DUE_SOON_DAYS + 1) * DAY) return "DUE";
  return "UPCOMING";
}

/**
 * The unit's financial status (§40, §41, §85), in this order:
 *
 *   no live contract                                   NO_CONTRACT
 *   contract not yet signed                            CONTRACT_PENDING
 *   nothing outstanding and nothing left to resolve    FINANCIALLY_COMPLETE
 *   nothing outstanding, but money unallocated or an
 *   installment still open (a schedule over the value) PAID
 *   anything past due                                  OVERDUE
 *   nothing paid                                       PAYMENT_PENDING
 *   otherwise                                          PARTIALLY_PAID
 *
 * Settled before overdue: a contract paid in full is not overdue because one
 * installment of a superseded plan was late.
 */
export function financialStatus(input: {
  contractStatus: string | null;
  value: Amount;
  paid: Amount;
  overdue: Amount;
  unallocated: Amount;
  openInstallments: Amount;
}): UnitFinancialStatus {
  if (input.contractStatus === null) return "NO_CONTRACT";
  if (!isCollecting(input.contractStatus)) return "CONTRACT_PENDING";
  if (outstanding(input.value, input.paid).isZero()) {
    return dec(input.unallocated).greaterThan(0) || dec(input.openInstallments).greaterThan(0) ? "PAID" : "FINANCIALLY_COMPLETE";
  }
  if (dec(input.overdue).greaterThan(0)) return "OVERDUE";
  if (dec(input.paid).lessThanOrEqualTo(0)) return "PAYMENT_PENDING";
  return "PARTIALLY_PAID";
}

/** Paid over value as a percentage with one decimal (§39); none without a value. */
export function progressPercent(value: Amount, paid: Amount): string | null {
  const whole = dec(value);
  if (whole.lessThanOrEqualTo(0)) return null;
  const share = dec(paid).dividedBy(whole).times(100);
  return (share.greaterThan(100) ? dec(100) : share).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP).toFixed(1);
}

/**
 * What a new schedule's installments must add up to (§24, §84): the contract
 * value less what was collected against the installments of earlier schedules.
 * Paid history stays on the schedule it was paid against; the new plan covers
 * what is left.
 */
export function scheduleTarget(value: Amount, carriedPaid: Amount): Prisma.Decimal {
  return outstanding(value, carriedPaid);
}

export function sumAmounts(amounts: Amount[]): Prisma.Decimal {
  return amounts.reduce<Prisma.Decimal>((total, amount) => total.plus(amount), ZERO);
}

/** The installments in the order they fall due, then by sequence. */
export function byDueDate<T extends { dueDate: Date; sequence: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.sequence - b.sequence);
}

/**
 * A default split of `total` into the given installments' amounts, earliest
 * first, never above what each still owes (§31): what the record-payment form
 * proposes before a person changes it.
 */
export function proposeAllocations(total: Amount, installments: Array<{ id: string; dueDate: Date; sequence: number; outstanding: Amount }>): Array<{ installmentId: string; amount: string }> {
  let left = dec(total);
  const result: Array<{ installmentId: string; amount: string }> = [];
  for (const row of byDueDate(installments)) {
    if (left.lessThanOrEqualTo(0)) break;
    const owed = dec(row.outstanding);
    if (owed.lessThanOrEqualTo(0)) continue;
    const take = left.lessThan(owed) ? left : owed;
    result.push({ installmentId: row.id, amount: take.toFixed(2) });
    left = left.minus(take);
  }
  return result;
}
