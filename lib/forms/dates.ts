/**
 * Date-only values (AUD-09 §4, FV-07).
 *
 * A due date, an issue date or a start date is a calendar fact, not an
 * instant: "the 30th" must stay the 30th for every reader and on the server,
 * whatever the time zones in between. So a date-only value travels as the
 * `YYYY-MM-DD` string an `<input type="date">` produces, is checked to be a
 * real day of the calendar (no 30 February quietly becoming 2 March), and is
 * turned into a `Date` only at UTC midnight — the value a Postgres `date`
 * column stores. Never through `new Date("2026-9-7")`, which is local time.
 *
 * "Today" is always somebody's today: `todayInTimeZone` asks for it in a named
 * time zone and takes the clock as a parameter, so a boundary test can fix it.
 *
 * Client-safe: no imports.
 */

export type DateOnlyErrorCode = "DATE_REQUIRED" | "DATE_MALFORMED" | "DATE_IMPOSSIBLE" | "DATE_OUT_OF_RANGE";

export type DateOnlyParse = { ok: true; value: string } | { ok: false; code: DateOnlyErrorCode; message: string };

export type DateOnlyRule = {
  /** The field's label, as the error sentence names it. */
  label?: string;
  /** Inclusive bounds, `YYYY-MM-DD`. Default: 1900-01-01 to 2199-12-31 — a typo such as 20266 is refused. */
  min?: string;
  max?: string;
};

export const DATE_ONLY_MIN = "1900-01-01";
export const DATE_ONLY_MAX = "2199-12-31";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether year/month/day name a day that exists (leap years included). */
export function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

/** Whether a string is a canonical, real `YYYY-MM-DD` date. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_ONLY.exec(value);
  return Boolean(match && isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])));
}

/** Reads a typed date-only value, or says why it is not one. Empty is refused; see `parseOptionalDateOnly`. */
export function parseDateOnly(input: string, rule: DateOnlyRule = {}): DateOnlyParse {
  const label = rule.label ?? "Date";
  const raw = String(input ?? "").trim();
  if (raw === "") return { ok: false, code: "DATE_REQUIRED", message: `Enter ${label.toLowerCase()}.` };
  const match = DATE_ONLY.exec(raw);
  if (!match) return { ok: false, code: "DATE_MALFORMED", message: `${label} must be a date like 2026-09-27.` };
  if (!isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return { ok: false, code: "DATE_IMPOSSIBLE", message: `${label} ${raw} is not a real date. Check the day and the month.` };
  }
  const min = rule.min ?? DATE_ONLY_MIN;
  const max = rule.max ?? DATE_ONLY_MAX;
  if (raw < min) return { ok: false, code: "DATE_OUT_OF_RANGE", message: `${label} must be on or after ${min}.` };
  if (raw > max) return { ok: false, code: "DATE_OUT_OF_RANGE", message: `${label} must be on or before ${max}.` };
  return { ok: true, value: raw };
}

/** As `parseDateOnly`, but empty (or null) is "no date" rather than an error. */
export function parseOptionalDateOnly(input: string | null | undefined, rule: DateOnlyRule = {}): { ok: true; value: string | null } | Extract<DateOnlyParse, { ok: false }> {
  if (input === null || input === undefined || String(input).trim() === "") return { ok: true, value: null };
  return parseDateOnly(String(input), rule);
}

/** The `Date` a Postgres `date` column stores for a calendar day: its UTC midnight. */
export function dateOnlyToUtc(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (!match || !isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new RangeError(`Not a calendar date: ${value}`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** The calendar day a stored date-only `Date` names (its UTC components), as `YYYY-MM-DD`. */
export function dateOnlyFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in a time zone (`Europe/Tirane`), at `now` — a parameter so tests fix the clock. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Orders two canonical date-only strings: -1, 0 or 1. */
export function compareDateOnly(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * The cross-field rule a schedule shares (a due date before its start, an end
 * before its beginning): the message to show beside the later field, or null.
 * Either side missing is not this rule's concern.
 */
export function dateOrderError(start: string | null | undefined, end: string | null | undefined, labels: { start: string; end: string } = { start: "the start date", end: "Due date" }): string | null {
  if (!start || !end || !isDateOnly(start) || !isDateOnly(end)) return null;
  // The Tasks schema's own sentence (PRD #11 §50), so client and server say the same.
  return compareDateOnly(end, start) < 0 ? `${labels.end} must be on or after ${labels.start}.` : null;
}
