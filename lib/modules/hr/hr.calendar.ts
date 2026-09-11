/**
 * Working-day arithmetic (PRD #16 §77, §213–§215).
 *
 * One implementation, because a working day counted differently in two places
 * is how a balance stops adding up. V0.1's work week is Monday to Friday and
 * public holidays are not modelled — the calculation excludes weekends and
 * nothing else, which is stated here rather than assumed at four call sites
 * (PRD #16 §214, §215).
 *
 * Deliberately free of Prisma, so the leave form can count the days it is about
 * to request with the same function the server will use to store them. The
 * browser's figure is a courtesy; the server counts again either way.
 */

/** Days of the week that count as working days. 0 is Sunday. */
const WORKING_DAYS = new Set([1, 2, 3, 4, 5]);

export function isWorkingDay(date: Date): boolean {
  return WORKING_DAYS.has(date.getUTCDay());
}

/** Working days between two dates, inclusive of both. */
export function countWorkingDays(startDate: Date, endDate: Date): number {
  if (endDate.getTime() < startDate.getTime()) return 0;

  let days = 0;
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()),
  );
  const last = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());

  while (cursor.getTime() <= last) {
    if (isWorkingDay(cursor)) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/** Every working day in a range, for writing attendance against leave. */
export function workingDaysBetween(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 12),
  );
  const last = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
    12,
  );

  while (cursor.getTime() <= last) {
    if (isWorkingDay(cursor)) dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

/**
 * A business date at midday UTC (PRD #16 §212).
 *
 * Employment dates are calendar facts, not instants. Storing them at midday
 * means no timezone can shift one onto the previous day for a reader west of
 * the server.
 */
export function toBusinessDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0, 0),
  );
}

export function businessDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function today(): Date {
  return toBusinessDate(new Date());
}

/** Minutes between check-in and check-out, or null when either is missing. */
export function workedMinutesBetween(
  checkIn: Date | null | undefined,
  checkOut: Date | null | undefined,
): number | null {
  if (!checkIn || !checkOut) return null;
  const minutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000);
  return minutes >= 0 ? minutes : null;
}

/** Whether two date ranges share at least one day (PRD #16 §83). */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
}

/** The leave year a request falls in. V0.1 uses the calendar year. */
export function leaveYearOf(date: Date): number {
  return date.getUTCFullYear();
}
