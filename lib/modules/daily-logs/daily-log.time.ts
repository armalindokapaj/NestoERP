import type { Locale } from "@/lib/i18n/config";
import { dayText } from "@/lib/i18n/format";
import { addLocalDays, daysBetween, instantFromLocal, isLocalDate, localDate, localTime } from "@/lib/modules/calendar/calendar.time";

/**
 * Site-day arithmetic (PRD #43 §16-§19, §104-§106). Pure and client-safe.
 *
 * A work date is the project's calendar day in the company's zone, stored at
 * midday UTC so it is the same day everywhere; times of day on a log are the
 * site's wall clock on that date.
 */

export function businessInstant(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function dateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "14 Sep 2026" — spelled out, so server and browser agree. */
export function dateLabel(date: string, locale: Locale): string {
  return dayText(date, "d MMM yyyy", locale);
}

/** "Monday 14 Sep 2026". */
export function longDateLabel(date: string, locale: Locale): string {
  return dayText(date, "EEEE d MMM yyyy", locale);
}

export function shortDayLabel(date: string, locale: Locale): string {
  return dayText(date, "EEE d MMM", locale);
}

/** A wall-clock time on a work date, as an instant. */
export function timeOn(date: string, time: string | null, zone: string): Date | null {
  return time ? instantFromLocal(date, time, zone) : null;
}

/** "07:30" for an instant, in the company's zone. */
export function clockOf(instant: Date | null, zone: string): string | null {
  return instant ? localTime(instant, zone) : null;
}

/** The last working day strictly before `today`, looking back at most two weeks. */
export function previousWorkingDay(today: string, workingDays: readonly number[]): string | null {
  for (let offset = 1; offset <= 14; offset += 1) {
    const day = addLocalDays(today, -offset);
    if (workingDays.includes(isoWeekday(day))) return day;
  }
  return null;
}

/** 90 → "1h 30m"; in Albanian "1 orë 30 min". */
export function formatDuration(minutes: number, locale: Locale = "en"): string {
  const [h, m] = locale === "sq" ? [" orë", " min"] : ["h", "m"];
  if (minutes <= 0) return `0${m}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${m}`;
  return rest === 0 ? `${hours}${h}` : `${hours}${h} ${rest}${m}`;
}

export { addLocalDays, daysBetween, isLocalDate, localDate };
