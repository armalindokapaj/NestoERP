import { Prisma, type LeaveType } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { isBalanceTracked } from "../hr.status";
import type { LeaveBalanceDTO } from "../hr.types";

/**
 * Leave balances (PRD #16 §79–§85, §196, §218).
 *
 * `usedDays` is maintained transactionally from approved leave and is never
 * accepted from a browser. Approving adds; cancelling an approved request
 * subtracts. That is the whole contract, and it is the reason the number can be
 * trusted by the check that refuses a request for more days than remain
 * (PRD #16 §80, §218).
 */

export const ZERO = new Prisma.Decimal(0);

export function availableDays(balance: {
  entitledDays: Prisma.Decimal;
  usedDays: Prisma.Decimal;
  adjustmentDays: Prisma.Decimal;
}): Prisma.Decimal {
  return balance.entitledDays.plus(balance.adjustmentDays).minus(balance.usedDays);
}

/**
 * The balance row for one employee, type and year, created on first use.
 *
 * Created with a zero entitlement rather than a guessed one: V0.1 has no
 * statutory accrual engine, so HR sets the number (PRD #16 §81, §216).
 */
export async function ensureBalance(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    employeeProfileId: string;
    companyMemberId: string;
    leaveType: LeaveType;
    year: number;
  },
) {
  const existing = await tx.leaveBalance.findUnique({
    where: {
      employeeProfileId_leaveType_year: {
        employeeProfileId: input.employeeProfileId,
        leaveType: input.leaveType,
        year: input.year,
      },
    },
  });

  if (existing) return existing;

  return tx.leaveBalance.create({
    data: {
      companyId: input.companyId,
      employeeProfileId: input.employeeProfileId,
      companyMemberId: input.companyMemberId,
      leaveType: input.leaveType,
      year: input.year,
      entitledDays: ZERO,
      usedDays: ZERO,
      adjustmentDays: ZERO,
    },
  });
}

/**
 * Takes the row lock on a balance for the rest of the transaction.
 *
 * Read-check-write is not atomic on its own. PostgreSQL's default isolation
 * lets two approvals both read `usedDays = 0`, both decide there is room, and
 * both write the same new figure — so the second approval overwrites the first
 * instead of adding to it, and the entitlement is quietly exceeded
 * (PRD #16 §196, §280).
 *
 * `FOR UPDATE` makes the second transaction wait for the first to commit, and
 * then read what it actually wrote. Prisma cannot express a locking read, so
 * this is raw SQL — the parameter is still bound, never interpolated.
 */
export async function lockBalance(
  tx: Prisma.TransactionClient,
  balanceId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "leave_balances" WHERE id = ${balanceId} FOR UPDATE`;
}

/**
 * Moves `usedDays` by a signed amount, inside the caller's transaction.
 *
 * Never below zero: a balance that went negative would mean the arithmetic
 * somewhere else was wrong, and a negative "days taken" is not a thing.
 */
export async function adjustUsedDays(
  tx: Prisma.TransactionClient,
  balanceId: string,
  delta: Prisma.Decimal,
): Promise<void> {
  const balance = await tx.leaveBalance.findUniqueOrThrow({
    where: { id: balanceId },
    select: { usedDays: true },
  });

  const next = balance.usedDays.plus(delta);
  await tx.leaveBalance.update({
    where: { id: balanceId },
    data: { usedDays: next.lessThan(0) ? ZERO : next },
  });
}

export function toBalanceDTO(row: {
  leaveType: LeaveType;
  year: number;
  entitledDays: Prisma.Decimal;
  usedDays: Prisma.Decimal;
  adjustmentDays: Prisma.Decimal;
}): LeaveBalanceDTO {
  return {
    leaveType: row.leaveType,
    year: row.year,
    entitledDays: row.entitledDays.toFixed(2),
    usedDays: row.usedDays.toFixed(2),
    adjustmentDays: row.adjustmentDays.toFixed(2),
    availableDays: availableDays(row).toFixed(2),
    tracked: isBalanceTracked(row.leaveType),
  };
}

/** Every balance an employee holds for a year, newest type order first. */
export async function balancesFor(employeeProfileId: string, year: number) {
  return prisma.leaveBalance.findMany({
    where: { employeeProfileId, year },
    orderBy: { leaveType: "asc" },
  });
}
