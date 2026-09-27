"use client";

import * as React from "react";
import { CalendarPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/modules/calendar/calendar.format";
import { localDate } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_META, dayHeading, eventDays, eventsByDay, visibleDays } from "./calendar-model";
import { categoryStyle } from "./event-card";

/**
 * Agenda (PRD #39 §27): the phone's first view and the desktop's list. Days are
 * headed TODAY, TOMORROW, then by name; a day with nothing on it is left out,
 * except today, which always says where you are.
 */
export function AgendaView({
  date,
  zone,
  today,
  events,
  onOpen,
  onCreate,
}: {
  date: string;
  zone: string;
  today: string;
  events: CalendarEventDTO[];
  onOpen: (event: CalendarEventDTO) => void;
  onCreate?: () => void;
}) {
  const days = visibleDays("agenda", date, zone);
  const byDay = React.useMemo(() => {
    // A multi-day all-day item is listed once, on its first day in view, with
    // how long it lasts — not repeated down the whole agenda.
    const map = eventsByDay(events, days, zone);
    const seen = new Set<string>();
    for (const day of days) {
      map.set(
        day,
        (map.get(day) ?? []).filter((event) => {
          if (!event.allDay || eventDays(event, zone).length <= 1) return true;
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        }),
      );
    }
    return map;
  }, [events, days, zone]);
  const shown = days.filter((day) => (byDay.get(day) ?? []).length > 0 || day === today);

  if (shown.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center" data-testid="calendar-empty">
        <p className="text-card font-medium text-fg">Nothing scheduled for this period.</p>
        {onCreate ? (
          <Button variant="secondary" size="sm" onClick={onCreate}>
            <CalendarPlus aria-hidden="true" />
            Create event
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-6" data-testid="agenda">
      {shown.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <section key={day} aria-label={dayHeading(day, zone, today)} className="border-b border-line py-4 last:border-b-0">
            {/* The page heading is the h1; day sections follow it directly (AUD-11 §3). */}
            <h2 className={cn("mb-2 px-2 text-meta font-semibold uppercase tracking-[0.1em]", day === today ? "text-accent-strong" : "text-fg-subtle")}>
              {dayHeading(day, zone, today)}
            </h2>
            {list.length === 0 ? (
              <p className="px-2 text-table text-fg-muted">Nothing scheduled.</p>
            ) : (
              <ul className="flex flex-col">
                {list.map((event) => {
                  const Icon = event.privacyMode === "BUSY_ONLY" ? null : CATEGORY_META[event.category].icon;
                  const start = new Date(event.startsAt);
                  const continues = !event.allDay && localDate(start, zone) !== day;
                  return (
                    <li key={`${event.id}:${day}`}>
                      <button
                        type="button"
                        data-testid="calendar-event"
                        data-source={event.sourceType}
                        onClick={() => onOpen(event)}
                        style={categoryStyle(event)}
                        className="group grid w-full grid-cols-[76px_minmax(0,1fr)] items-start gap-3 rounded-lg px-2 py-2.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[96px_minmax(0,1fr)]"
                      >
                        <span className="pt-0.5 text-meta leading-5 text-fg-muted tabular-nums">
                          {event.allDay && eventDays(event, zone).length > 1
                            ? `Until ${new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(new Date(new Date(event.endsAt ?? event.startsAt).getTime() - 1))}`
                            : event.allDay || continues
                              ? "All day"
                              : formatClock(start, zone)}
                          {!event.allDay && !continues && event.endsAt ? (
                            <span className="block text-fg-subtle">{formatClock(new Date(event.endsAt), zone)}</span>
                          ) : null}
                        </span>
                        <span className="relative flex min-w-0 flex-col gap-0.5 border-l-[3px] border-[var(--cal-rail)] pl-3">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0 text-[var(--cal)]" /> : null}
                            <span className="truncate text-body font-medium text-fg">{event.title}</span>
                            {event.status === "OVERDUE" ? (
                              <Badge tone="warning" className="shrink-0 px-1.5 py-0">Overdue</Badge>
                            ) : null}
                            {event.severity === "critical" ? (
                              <Badge tone="danger" className="shrink-0 px-1.5 py-0">Critical</Badge>
                            ) : null}
                          </span>
                          {event.privacyMode !== "BUSY_ONLY" ? (
                            <span className="truncate text-meta text-fg-muted">
                              {[event.project ? event.project.name : event.subtitle, event.participants?.[0]?.name, event.location]
                                .filter(Boolean)
                                .join(" · ") || CATEGORY_META[event.category].label}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
