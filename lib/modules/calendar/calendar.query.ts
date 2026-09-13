import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { calendarProviders } from "./calendar.providers";
import { RANGE_MAX_DAYS } from "./calendar.schema";
import { calendarSettings } from "./calendar.service";
import type { CalendarCategory, CalendarEventDTO, CalendarFilters, CalendarRange, CalendarResponse } from "./calendar.types";

/**
 * The calendar aggregator (PRD #39 §14, §118-§120).
 *
 * Resolves the providers this reader can see, runs them a few at a time, and
 * merges what comes back. Every provider filters in its own query, so nothing
 * unrestricted is ever fetched and trimmed here (PRD #39 §14). A provider that
 * fails for an ordinary reason is named in the response and the rest still
 * render; one that fails because access was refused is not swallowed.
 */

const CONCURRENCY = 5;
const PROVIDER_TIMEOUT_MS = 2_500;
const MAX_EVENTS = 2_000;

class ProviderTimeout extends Error {}

/** Busy-only absences count as HR or personal for filtering: they are shown with either. */
function wanted(filters: CalendarFilters, category: CalendarCategory): boolean {
  if (!filters.categories?.length) return true;
  if (category === "HR") return filters.categories.includes("HR") || filters.categories.includes("PERSONAL");
  return filters.categories.includes(category);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeout("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getCalendar(context: UserContext, range: CalendarRange, filters: CalendarFilters): Promise<CalendarResponse> {
  assertModule(context, "calendar");
  assertPermission(context, "calendar.view");
  if (range.to.getTime() - range.from.getTime() > RANGE_MAX_DAYS * 86_400_000 || range.to <= range.from) {
    throw new AccessError("VALIDATION_ERROR", `Ask for at most ${RANGE_MAX_DAYS} days at a time.`);
  }

  const started = Date.now();
  const settings = await calendarSettings(context.companyId);

  // memberIds narrows to people only for readers allowed to plan around others.
  const safeFilters: CalendarFilters = {
    ...filters,
    memberIds: filters.memberIds?.length && can(context, "calendar.availability.view") ? filters.memberIds : undefined,
  };

  const providers = calendarProviders
    .getEnabledProviders(context)
    .filter((provider) => !safeFilters.providers?.length || safeFilters.providers.includes(provider.key))
    .filter((provider) => !safeFilters.categories?.length || provider.categories.some((category) => wanted(safeFilters, category)));

  const events: CalendarEventDTO[] = [];
  const providerCounts: Record<string, number> = {};
  const failed: string[] = [];

  for (let index = 0; index < providers.length; index += CONCURRENCY) {
    const batch = providers.slice(index, index + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (provider) => {
        const providerStarted = Date.now();
        try {
          const rows = await withTimeout(
            provider.getEvents({ context, range, filters: safeFilters, timezone: settings.timezone }),
            PROVIDER_TIMEOUT_MS,
          );
          return { provider, rows };
        } catch (error) {
          if (error instanceof AccessError && (error.code === "FORBIDDEN" || error.code === "UNAUTHENTICATED")) throw error;
          failed.push(provider.key);
          incrementCounter(Metric.CALENDAR_PROVIDER_FAILURE, { provider: provider.key });
          logger.warn("calendar.provider.failed", {
            providerKey: provider.key,
            companyId: context.companyId,
            memberId: context.membershipId,
            range: `${range.from.toISOString()}/${range.to.toISOString()}`,
            error: error instanceof Error ? error.message : "unknown",
          });
          return { provider, rows: [] as CalendarEventDTO[] };
        } finally {
          incrementCounter(Metric.CALENDAR_PROVIDER_DURATION_MS, { provider: provider.key }, Date.now() - providerStarted);
        }
      }),
    );
    for (const { provider, rows } of settled) {
      // Final safety net: only the categories asked for, and only what each provider claims to own.
      const kept = rows.filter(
        (row) =>
          wanted(safeFilters, row.privacyMode === "BUSY_ONLY" ? "HR" : row.category) &&
          (row.providerKey === provider.key || row.privacyMode === "BUSY_ONLY"),
      );
      providerCounts[provider.key] = kept.length;
      events.push(...kept);
    }
  }

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
  const truncated = events.length > MAX_EVENTS;

  incrementCounter(Metric.CALENDAR_QUERY);
  incrementCounter(Metric.CALENDAR_QUERY_DURATION_MS, {}, Date.now() - started);
  incrementCounter(Metric.CALENDAR_EVENTS_RETURNED, {}, Math.min(events.length, MAX_EVENTS));

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    timezone: settings.timezone,
    events: truncated ? events.slice(0, MAX_EVENTS) : events,
    meta: {
      providerCounts,
      ...(failed.length > 0 ? { partialFailureProviders: failed } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
    capabilities: {
      canCreate: canAccessModule(context, "calendar") && can(context, "calendar.event.create"),
      canCreateCompanyEvent: can(context, "calendar.company_event.manage"),
      canViewAvailability: can(context, "calendar.availability.view"),
    },
    workingHours: { start: settings.workingDayStart, end: settings.workingDayEnd, days: settings.workingDays },
  };
}
