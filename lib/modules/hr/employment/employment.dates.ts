/**
 * Employment history dates (E-03 §30, §158, §159).
 *
 * A history date is a business date with no time: `YYYY-MM-DD`, stored in a
 * `date` column. Periods are inclusive at both ends, so the day before a change
 * is the last day of what came before it. Business dates are UTC dates, as every
 * HR date is (`hr.calendar.ts`); the server's own zone plays no part. No Prisma
 * import: forms and pages read these too.
 */

export type Day = string;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The business date of any stored date — a `date` column or a midday-UTC HR timestamp. */
export function dayOf(value: Date): Day {
  return value.toISOString().slice(0, 10);
}

/** For a `date` column. */
export function dbDay(day: Day): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** For the employment's own midday-UTC timestamps (`startDate`, `endDate`, PRD #16 §212). */
export function businessTimestamp(day: Day): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

export function addDays(day: Day, days: number): Day {
  const date = dbDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

export function todayDay(now: Date = new Date()): Day {
  return dayOf(now);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((dbDay(to).getTime() - dbDay(from).getTime()) / 86_400_000);
}

/** Whether a period [from, to] (inclusive, `to` null = open) contains a day. */
export function periodContains(period: { from: Day; to: Day | null }, day: Day): boolean {
  return period.from <= day && (period.to === null || day <= period.to);
}
