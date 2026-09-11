import { Prisma } from "@prisma/client";

import { countWorkingDays } from "./hr.calendar";

/**
 * Leave days as a stored quantity (PRD #16 §77, §78).
 *
 * The calendar arithmetic itself lives in `hr.calendar.ts`, which carries no
 * Prisma import so the leave form can count the same way. This module is the
 * one place that turns that count into what the database holds.
 */

/**
 * Working days between two dates, inclusive of both.
 *
 * Returns a `Decimal` because leave is recorded to two places: a half day is a
 * real thing, even though V0.1 only ever calculates whole ones (PRD #16 §78).
 */
export function calculateLeaveDays(startDate: Date, endDate: Date): Prisma.Decimal {
  return new Prisma.Decimal(countWorkingDays(startDate, endDate));
}

export {
  businessDateString,
  countWorkingDays,
  isWorkingDay,
  leaveYearOf,
  rangesOverlap,
  toBusinessDate,
  today,
  workedMinutesBetween,
  workingDaysBetween,
} from "./hr.calendar";
