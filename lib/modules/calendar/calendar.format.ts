import { localDate } from "./calendar.time";

/**
 * Human wording for calendar times, in the company zone (PRD #39 §73).
 * Isomorphic — the server writes notification text with it, the browser renders with it.
 */

export function formatDay(instant: Date, zone: string, options: Intl.DateTimeFormatOptions = {}, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", day: "numeric", month: "short", ...options }).format(instant);
}

export function formatClock(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/**
 * "Mon 14 Sep, 09:00–10:00", "Mon 14 Sep (all day)", "24–26 Dec (all day)".
 * `words` lets the browser write it in the reader's language; the default is
 * the English the server's notification text uses.
 */
export function describeWhen(
  startsAt: Date,
  endsAt: Date | null,
  allDay: boolean,
  zone: string,
  words: { locale: string; allDay: string } = { locale: "en-GB", allDay: "all day" },
): string {
  const day = (instant: Date) => formatDay(instant, zone, {}, words.locale);
  if (allDay) {
    const lastDay = endsAt ? new Date(endsAt.getTime() - 1) : startsAt;
    if (localDate(lastDay, zone) === localDate(startsAt, zone)) return `${day(startsAt)} (${words.allDay})`;
    return `${day(startsAt)} – ${day(lastDay)} (${words.allDay})`;
  }
  if (!endsAt) return `${day(startsAt)}, ${formatClock(startsAt, zone)}`;
  if (localDate(endsAt, zone) === localDate(startsAt, zone)) {
    return `${day(startsAt)}, ${formatClock(startsAt, zone)}–${formatClock(endsAt, zone)}`;
  }
  return `${day(startsAt)} ${formatClock(startsAt, zone)} – ${day(endsAt)} ${formatClock(endsAt, zone)}`;
}
