import type { UserContext } from "@/lib/context/types";
import { meetingCalendarProvider } from "@/lib/modules/meetings/meeting.calendar-provider";
import { timesheetDeadlineCalendarProvider } from "@/lib/modules/timesheets/timesheet.deadline";
import type { CalendarProvider } from "./calendar.types";
import { calendarOwnedProvider } from "./providers/calendar-owned.provider";
import { documentProvider } from "./providers/document.provider";
import { financeProvider } from "./providers/finance.provider";
import { hrProvider } from "./providers/hr.provider";
import { hseProvider } from "./providers/hse.provider";
import { legalProvider } from "./providers/legal.provider";
import { procurementProvider } from "./providers/procurement.provider";
import { qaqcProvider } from "./providers/qaqc.provider";
import { taskProvider } from "./providers/task.provider";

/**
 * The calendar provider registry (PRD #39 §12, §202).
 *
 * Code-defined: a provider is a module's own read of its own dates, registered
 * here at build time, never configuration loaded from the database. A module
 * keeps its provider in its own folder — meetings (#40) in
 * `lib/modules/meetings` — and is listed below, so registration never depends
 * on some other import having run first.
 */
class CalendarProviderRegistry {
  private readonly providers = new Map<string, CalendarProvider>();

  register(provider: CalendarProvider): void {
    if (this.providers.has(provider.key)) throw new Error(`Duplicate calendar provider: ${provider.key}`);
    this.providers.set(provider.key, provider);
  }

  all(): CalendarProvider[] {
    return [...this.providers.values()];
  }

  get(key: string): CalendarProvider | undefined {
    return this.providers.get(key);
  }

  /** Providers this reader can see anything from: module on, permission held (PRD #39 §177). */
  getEnabledProviders(context: UserContext): CalendarProvider[] {
    return this.all().filter((provider) => provider.enabled(context));
  }
}

export const calendarProviders = new CalendarProviderRegistry();

for (const provider of [
  calendarOwnedProvider,
  taskProvider,
  hrProvider,
  financeProvider,
  legalProvider,
  procurementProvider,
  qaqcProvider,
  hseProvider,
  documentProvider,
  meetingCalendarProvider,
  timesheetDeadlineCalendarProvider,
]) {
  calendarProviders.register(provider);
}

export function registerCalendarProvider(provider: CalendarProvider): void {
  calendarProviders.register(provider);
}
