import { prisma } from "@/lib/database/prisma";
import { instantFromLocal, isValidTimeZone, localDate, localTime } from "@/lib/core/time/zoned-time";

/**
 * Wall-clock times on HSE forms — when an incident happened, when a permit
 * opens and closes (AUD-09 §4, FV-07).
 *
 * A `<input type="datetime-local">` sends `2026-09-27T08:30` with no zone. The
 * schemas used to hand that to `new Date()`, which reads it in the server's
 * zone — UTC in production — so a permit typed as 08:30 in Tirana opened at
 * 10:30, and an incident "just now" was refused as in the future. The form's
 * value is the company's wall clock; it becomes an instant here, in the
 * company's configured zone, before any schema sees it.
 *
 * Policy for the hour the clocks change: a time that does not exist (spring
 * forward) is refused on its field; a time that happens twice (fall back) is
 * the first of the two.
 */

const LOCAL_MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

export async function companyZone(companyId: string): Promise<string> {
  const settings = await prisma.companySettings.findUnique({ where: { companyId }, select: { timezone: true } });
  return settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : "UTC";
}

export type LocalTimeResult = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * A form's zone-less value as an ISO instant in `zone`; anything else (empty,
 * already an instant, malformed) is passed on for the schema to judge.
 */
export function wallClockToInstant(value: unknown, zone: string): LocalTimeResult {
  if (typeof value !== "string") return { ok: true, value };
  const match = LOCAL_MINUTE.exec(value.trim());
  if (!match) return { ok: true, value };
  const [, day, time] = match;
  const instant = instantFromLocal(day!, time!, zone);
  if (Number.isNaN(instant.getTime())) return { ok: true, value };
  // The clocks went forward over this minute: it never happened here.
  if (localDate(instant, zone) !== day || localTime(instant, zone) !== time) {
    return { ok: false, message: "That time does not exist on this date: the clocks go forward. Choose a time an hour later." };
  }
  return { ok: true, value: instant.toISOString() };
}

/** A stored instant as the company's wall clock, for a `datetime-local` input. */
export function instantToWallClock(instant: string | Date, zone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "";
  return `${localDate(date, zone)}T${localTime(date, zone)}`;
}
