import { localDate } from "./calendar.time";

/**
 * Human wording for calendar times, in the company zone (PRD #39 §73).
 * Isomorphic — the server writes notification text with it, the browser renders with it.
 */

export function formatDay(instant: Date, zone: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", ...options }).format(instant);
}

export function formatClock(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/** "Mon 14 Sep, 09:00–10:00", "Mon 14 Sep (all day)", "24–26 Dec (all day)". */
export function describeWhen(startsAt: Date, endsAt: Date | null, allDay: boolean, zone: string): string {
  if (allDay) {
    const lastDay = endsAt ? new Date(endsAt.getTime() - 1) : startsAt;
    if (localDate(lastDay, zone) === localDate(startsAt, zone)) return `${formatDay(startsAt, zone)} (all day)`;
    return `${formatDay(startsAt, zone)} – ${formatDay(lastDay, zone)} (all day)`;
  }
  if (!endsAt) return `${formatDay(startsAt, zone)}, ${formatClock(startsAt, zone)}`;
  if (localDate(endsAt, zone) === localDate(startsAt, zone)) {
    return `${formatDay(startsAt, zone)}, ${formatClock(startsAt, zone)}–${formatClock(endsAt, zone)}`;
  }
  return `${formatDay(startsAt, zone)} ${formatClock(startsAt, zone)} – ${formatDay(endsAt, zone)} ${formatClock(endsAt, zone)}`;
}
