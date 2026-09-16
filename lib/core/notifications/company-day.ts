import { prisma } from "@/lib/database/prisma";

/** A calendar day as a company lives it: the local date, and the start of it as a stored business date compares. */
export type CompanyDay = { day: string; start: Date };

/**
 * Reads a company's timezone once and answers which day any instant falls on
 * there (PRD #51 §48).
 *
 * `start` is midnight UTC of that local date. Due dates are calendar facts
 * stored as the UTC day they name — midnight or midday UTC — so "due before
 * today" is `dueDate < start`, whatever the company's offset.
 */
export async function companyDays(companyId: string): Promise<(instant: Date) => CompanyDay> {
  const { isValidTimeZone, localDate } = await import("@/lib/modules/calendar/calendar.time");
  const settings = await prisma.companySettings.findUnique({ where: { companyId }, select: { timezone: true } });
  const zone = settings?.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : "UTC";
  return (instant) => {
    const day = localDate(instant, zone);
    return { day, start: new Date(`${day}T00:00:00.000Z`) };
  };
}
