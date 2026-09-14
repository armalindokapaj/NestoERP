import { addLocalDays, daysBetween, isLocalDate } from "@/lib/modules/calendar/calendar.time";

/**
 * Time arithmetic for timesheets (PRD #42 §11, §16-§19, §47, §205).
 *
 * Pure and client-safe. Days are local calendar dates ("2026-09-07") in the
 * company's zone; durations are whole minutes and never floats. Storage keeps a
 * business date at midday UTC, so it is the same day in every zone.
 */

export const MINUTES_PER_DAY = 1440;
export const MIN_ENTRY_MINUTES = 5;

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The first day of the week containing `date`, for a week starting on `weekStartsOn`. */
export function weekStartOf(date: string, weekStartsOn = 1): string {
  const offset = (isoWeekday(date) - weekStartsOn + 7) % 7;
  return addLocalDays(date, -offset);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addLocalDays(start, index));
}

export function weekEndOf(start: string): string {
  return addLocalDays(start, 6);
}

/** The stored form of a local date. */
export function businessInstant(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function dateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function isWeekStart(date: string, weekStartsOn: number): boolean {
  return isLocalDate(date) && isoWeekday(date) === weekStartsOn;
}

export { addLocalDays, daysBetween, isLocalDate };

/**
 * Reads what somebody typed into a duration field (§47, §205):
 * `2` hours, `2.5` hours, `2,5`, `2:30`, `150m`, `1h 30m`, `1h30`, `45min`.
 * Returns whole minutes, or null when it cannot be read. Nothing is rounded
 * silently: `2.33` hours is 139.8 minutes, which is not whole, so it is refused.
 */
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase().replace(",", ".");
  if (!value) return null;

  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  const minutesOnly = /^(\d{1,4})\s*(m|min|mins|minutes)$/.exec(value);
  if (minutesOnly) return Number(minutesOnly[1]);

  const hoursAndMinutes = /^(\d{1,2}(?:\.\d{1,2})?)\s*h(?:ours?|rs?)?\s*(?:(\d{1,2})\s*(?:m|min|mins|minutes)?)?$/.exec(value);
  if (hoursAndMinutes) {
    const minutes = Number(hoursAndMinutes[1]) * 60 + (hoursAndMinutes[2] ? Number(hoursAndMinutes[2]) : 0);
    return Number.isInteger(Math.round(minutes * 1000) / 1000) ? Math.round(minutes) : null;
  }

  const hours = /^(\d{1,2}(?:\.\d{1,3})?)$/.exec(value);
  if (hours) {
    const minutes = Number(hours[1]) * 60;
    const rounded = Math.round(minutes);
    return Math.abs(minutes - rounded) < 1e-9 ? rounded : null;
  }
  return null;
}

/** "1h 30m", "45m", "8h". */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0h";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "7.5h" — the compact form for a grid cell. */
export function formatHoursCompact(minutes: number): string {
  if (minutes <= 0) return "";
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))}h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Spelled out here rather than through Intl, so the server and every browser
// render the same label (ICU data differs: "Sep" or "Sept").
function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month: MONTHS[month - 1], day };
}

/** "7–13 Sep 2026", or across months "28 Sep – 4 Oct 2026". */
export function weekLabel(start: string): string {
  const a = parts(start);
  const b = parts(weekEndOf(start));
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${b.month} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
}

export function dayLabel(date: string): { weekday: string; day: string } {
  const { month, day } = parts(date);
  return { weekday: WEEKDAYS[isoWeekday(date) - 1], day: `${day} ${month}` };
}
