import { can, canAccessModule } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { addLocalDays, businessDate, overlaps, startOfLocalDay, widenedBusinessRange } from "../calendar.time";
import type { CalendarCategory, CalendarEventDTO, CalendarProviderContext } from "../calendar.types";

/**
 * Shared pieces for source providers (PRD #39 §13).
 *
 * A source date is a business date (midday UTC), so a provider asks the
 * database for a range widened by a day and then keeps only the dates whose
 * local day really overlaps what was asked for.
 */

export function moduleOpen(context: UserContext, moduleKey: ModuleKey, permission: Permission): boolean {
  return canAccessModule(context, moduleKey) && can(context, permission);
}

export function dateWindow(input: CalendarProviderContext) {
  return widenedBusinessRange(input.range);
}

/** An all-day DTO on a business date, or null when that day is outside the range. */
export function onBusinessDate(
  input: CalendarProviderContext,
  date: Date,
  event: Omit<CalendarEventDTO, "startsAt" | "endsAt" | "allDay" | "editable" | "draggable" | "resizable">,
  lastDate?: Date,
): CalendarEventDTO | null {
  if (input.filters.includeAllDay === false) return null;
  const first = businessDate(date);
  const last = lastDate ? businessDate(lastDate) : first;
  const startsAt = startOfLocalDay(first, input.timezone);
  const endsAt = startOfLocalDay(addLocalDays(last, 1), input.timezone);
  if (!overlaps(startsAt, endsAt, input.range)) return null;
  return {
    ...event,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    allDay: true,
    // Source-owned: the calendar never moves a module's record (PRD #39 §82).
    editable: false,
    draggable: false,
    resizable: false,
  };
}

export function projectRef(project: { id: string; name: string; code: string } | null | undefined) {
  return project ? { id: project.id, name: project.name, code: project.code } : undefined;
}

export const PROJECT_SELECT = { select: { id: true, name: true, code: true } } as const;

/** `projectIds` filter as a where-clause fragment for any project-linked model. */
export function projectFilter(input: CalendarProviderContext): { projectId?: { in: string[] } } {
  return input.filters.projectIds?.length ? { projectId: { in: input.filters.projectIds } } : {};
}

/** Before today in the company zone. */
export function isPastDue(date: Date, input: CalendarProviderContext): boolean {
  return businessDate(date) < todayIn(input.timezone);
}

export function todayIn(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function wants(input: CalendarProviderContext, category: CalendarCategory): boolean {
  return !input.filters.categories?.length || input.filters.categories.includes(category);
}

export function compact<T>(values: Array<T | null>): T[] {
  return values.filter((value): value is T => value !== null);
}

export const SOURCE_LIMIT = 500;

/**
 * One bounded source read. A read that comes back at SOURCE_LIMIT may have
 * left events in the range unread, so it is reported to the aggregator, which
 * marks the response truncated rather than silently showing a partial range
 * (AUD-08 §4, DT-05).
 */
export async function sourceRows<T>(input: Pick<CalendarProviderContext, "reportCapped">, read: Promise<T[]>): Promise<T[]> {
  const rows = await read;
  if (rows.length >= SOURCE_LIMIT) input.reportCapped?.();
  return rows;
}
