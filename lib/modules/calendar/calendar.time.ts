import { TZDate } from "@date-fns/tz";

/**
 * Calendar time (PRD #39 §72-§75).
 *
 * Instants are stored in UTC and read in the company's IANA zone. Every
 * conversion here goes through `@date-fns/tz`, which knows the zone's rules:
 * a wall-clock time that does not exist (the hour skipped in spring) moves
 * forward to the first valid instant, and one that happens twice (the hour
 * repeated in autumn) resolves to its first occurrence. Nothing in the
 * calendar does its own offset arithmetic.
 *
 * Isomorphic: the browser renders with these same functions.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function isLocalDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isLocalTime(value: string): boolean {
  return TIME.test(value);
}

/** The instant a local wall-clock time names in `zone`. */
export function instantFromLocal(date: string, time: string, zone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, 0, zone).getTime());
}

/** Local midnight, as an instant. */
export function startOfLocalDay(date: string, zone: string): Date {
  return instantFromLocal(date, "00:00", zone);
}

/** The calendar date an instant falls on in `zone`. */
export function localDate(instant: Date, zone: string): string {
  const local = new TZDate(instant.getTime(), zone);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

export function localTime(instant: Date, zone: string): string {
  const local = new TZDate(instant.getTime(), zone);
  return `${pad(local.getHours())}:${pad(local.getMinutes())}`;
}

/** Minutes past local midnight — for placing an event on a day grid. */
export function localMinutes(instant: Date, zone: string): number {
  const local = new TZDate(instant.getTime(), zone);
  return local.getHours() * 60 + local.getMinutes();
}

/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in `zone`. */
export function localWeekday(instant: Date, zone: string): number {
  const day = new TZDate(instant.getTime(), zone).getDay();
  return day === 0 ? 7 : day;
}

/** `date` plus `days` calendar days, as a local date string. */
export function addLocalDays(date: string, days: number): string {
  // Pure date arithmetic on the UTC calendar: no zone, so no machine zone either.
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both local dates). */
export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The local day a stored business date stands for. Business dates are kept at
 * midday UTC (finance.fields.ts), so the UTC date is the calendar fact.
 */
export function businessDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The all-day span of local dates [first, last] as instants [start of first, start of day after last). */
export function allDaySpan(first: string, last: string, zone: string): { startsAt: Date; endsAt: Date } {
  return { startsAt: startOfLocalDay(first, zone), endsAt: startOfLocalDay(addLocalDays(last, 1), zone) };
}

/**
 * Widens a range so a query on business dates (midday UTC) or local days
 * catches everything that could fall inside it in any zone.
 */
export function widenedBusinessRange(range: { from: Date; to: Date }): { gte: Date; lt: Date } {
  return { gte: new Date(range.from.getTime() - 86_400_000), lt: new Date(range.to.getTime() + 86_400_000) };
}

export function overlaps(startsAt: Date, endsAt: Date, range: { from: Date; to: Date }): boolean {
  return startsAt.getTime() < range.to.getTime() && endsAt.getTime() > range.from.getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
