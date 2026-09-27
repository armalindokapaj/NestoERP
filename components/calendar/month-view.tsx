"use client";

import * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { instantFromLocal } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_META, dayHeading, eventsByDay, visibleDays, weekdayNames } from "./calendar-model";
import { useCalendarTranslations, useDayWords } from "./calendar-text";
import { EventCard } from "./event-card";

/**
 * Month (PRD #39 §24, §29, §98).
 *
 * Desktop: whole weeks, three events a day and "+N more" opening the day.
 * Phone: a compact matrix with category dots, and the chosen day's events
 * listed below it — never the desktop grid shrunk.
 */

const VISIBLE_PER_DAY = 3;

export function MonthView({
  date,
  zone,
  today,
  events,
  workingDays,
  selectedDate,
  onSelectDate,
  onOpen,
  onCreate,
}: {
  date: string;
  zone: string;
  today: string;
  events: CalendarEventDTO[];
  workingDays: number[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onOpen: (event: CalendarEventDTO) => void;
  onCreate?: (date: string) => void;
}) {
  const t = useCalendarTranslations();
  const words = useDayWords();
  const weekdays = weekdayNames(words.locale, "short");
  const narrow = weekdayNames(words.locale, "narrow");
  const days = visibleDays("month", date, zone);
  const byDay = React.useMemo(() => eventsByDay(events, days, zone), [events, days, zone]);
  const month = date.slice(0, 7);
  const [overflowDay, setOverflowDay] = React.useState<string | null>(null);

  return (
    <>
      {/* Desktop and tablet */}
      <div className="hidden min-h-0 flex-1 flex-col md:flex" role="grid" aria-label={t("month.label")}>
        <div className="grid grid-cols-7 border-b border-line" role="row">
          {weekdays.map((weekday, index) => (
            <div
              key={index}
              role="columnheader"
              className={cn("px-3 py-2 text-meta font-medium uppercase tracking-[0.08em] text-fg-subtle", !workingDays.includes(index + 1) && "text-fg-subtle/70")}
            >
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-fr grid-cols-7" role="rowgroup">
          {days.map((day, index) => {
            const list = byDay.get(day) ?? [];
            const weekday = (index % 7) + 1;
            const outside = day.slice(0, 7) !== month;
            const hidden = list.length - VISIBLE_PER_DAY;
            return (
              <div
                key={day}
                role="gridcell"
                aria-label={dayHeading(day, zone, today, words)}
                onDoubleClick={() => onCreate?.(day)}
                className={cn(
                  "group relative flex min-h-[112px] min-w-0 flex-col gap-1 border-b border-r border-line p-1.5",
                  index % 7 === 6 && "border-r-0",
                  !workingDays.includes(weekday) && "bg-surface-muted/50",
                  outside && "bg-surface-muted/40",
                  day === today && "bg-accent-soft/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectDate(day)}
                  aria-label={t("month.open", { day: dayHeading(day, zone, today, words) })}
                  className={cn(
                    "grid size-7 place-items-center self-start rounded-full text-table tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    outside ? "text-fg-subtle" : "text-fg",
                    day === today ? "bg-accent font-semibold text-accent-fg" : "hover:bg-hover",
                  )}
                >
                  {Number(day.slice(8))}
                </button>
                <div className="flex min-w-0 flex-col gap-1">
                  {list.slice(0, VISIBLE_PER_DAY).map((event) => (
                    <EventCard key={`${event.id}:${day}`} event={event} zone={zone} onOpen={onOpen} />
                  ))}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOverflowDay(day)}
                      className="self-start rounded-md px-1.5 py-0.5 text-meta font-medium text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("more", { count: hidden })}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Phone: compact matrix, then the chosen day */}
      <div className="flex flex-col gap-4 md:hidden">
        {/* Seven shrinkable columns: 7 × 40px no longer overflows a 320px phone (AUD-04 §8, D-08-13, MW-17). */}
        <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-y-1 rounded-xl border border-line bg-surface p-1 min-[360px]:p-2" role="grid" aria-label={t("month.label")}>
          {narrow.map((weekday, index) => (
            <div key={index} className="py-1 text-center text-micro font-medium text-fg-subtle">
              {weekday}
            </div>
          ))}
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            const categories = [...new Set(list.map((event) => event.category))].slice(0, 3);
            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDate(day)}
                aria-pressed={day === selectedDate}
                aria-label={t("month.dayEvents", { day: dayHeading(day, zone, today, words), count: list.length })}
                className={cn(
                  "mx-auto flex h-11 w-full max-w-11 flex-col items-center justify-center gap-0.5 rounded-lg text-table tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  day.slice(0, 7) !== month ? "text-fg-subtle" : "text-fg",
                  day === selectedDate ? "bg-primary text-primary-fg" : day === today ? "bg-accent-soft font-semibold text-accent-strong" : "",
                )}
              >
                {Number(day.slice(8))}
                <span className="flex h-1 gap-0.5" aria-hidden="true">
                  {categories.map((category) => (
                    <span key={category} className="size-1 rounded-full" style={{ background: CATEGORY_META[category].token }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <section aria-label={dayHeading(selectedDate, zone, today, words)}>
          <h2 className="mb-2 text-meta font-semibold uppercase tracking-[0.08em] text-fg-subtle">{dayHeading(selectedDate, zone, today, words)}</h2>
          <div className="flex flex-col gap-2">
            {(byDay.get(selectedDate) ?? []).length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-table text-fg-muted">{t("nothingScheduled")}</p>
            ) : (
              (byDay.get(selectedDate) ?? []).map((event) => <EventCard key={event.id} event={event} zone={zone} variant="row" onOpen={onOpen} />)
            )}
          </div>
        </section>
      </div>

      <Dialog open={overflowDay !== null} onOpenChange={(open) => (open ? null : setOverflowDay(null))}>
        <DialogContent className="max-w-md">
          <DialogTitle>{overflowDay ? dayHeading(overflowDay, zone, today, words) : ""}</DialogTitle>
          <DialogDescription>
            {overflowDay
              ? new Intl.DateTimeFormat(words.locale, { timeZone: zone, dateStyle: "full" }).format(instantFromLocal(overflowDay, "12:00", zone))
              : ""}
          </DialogDescription>
          <div className="mt-4 flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
            {(overflowDay ? byDay.get(overflowDay) ?? [] : []).map((event) => (
              <EventCard
                key={event.id}
                event={event}
                zone={zone}
                variant="row"
                onOpen={(selected) => {
                  setOverflowDay(null);
                  onOpen(selected);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
