"use client";

import * as React from "react";

import { formatClock } from "@/lib/modules/calendar/calendar.format";
import { instantFromLocal, localDate, localMinutes } from "@/lib/modules/calendar/calendar.time";
import type { CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { cn } from "@/lib/utils/cn";
import { eventsByDay, minutesFromTime, placeTimedEvents, visibleDays } from "./calendar-model";
import { categoryStyle, EventCard } from "./event-card";

/**
 * Week and Day (PRD #39 §25, §26, §83, §84, §91-§96, §151, §152).
 *
 * A time axis, sticky day headers, an all-day row, working-hours shading, a
 * current-time line and side-by-side overlaps. Calendar-owned events that the
 * reader may edit can be dragged and resized on a 15-minute snap; the move is
 * shown at once and rolled back if the server refuses it.
 */

const HOUR_HEIGHT = 48;
const MINUTE = HOUR_HEIGHT / 60;
const SNAP = 15;

type DragState = {
  event: CalendarEventDTO;
  mode: "move" | "resize";
  originY: number;
  originDay: string;
  startMinutes: number;
  durationMinutes: number;
  day: string;
  deltaMinutes: number;
  moved: boolean;
};

export function TimeGridView({
  view,
  date,
  zone,
  today,
  events,
  workingHours,
  onOpen,
  onCreate,
  onMove,
}: {
  view: "week" | "day";
  date: string;
  zone: string;
  today: string;
  events: CalendarEventDTO[];
  workingHours: { start: string; end: string; days: number[] };
  onOpen: (event: CalendarEventDTO) => void;
  onCreate?: (date: string, time: string) => void;
  onMove: (event: CalendarEventDTO, startsAt: Date, endsAt: Date) => void;
}) {
  const days = visibleDays(view, date, zone);
  const byDay = React.useMemo(() => eventsByDay(events, days, zone), [events, days, zone]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastPointer = React.useRef<string>("mouse");
  const [drag, setDrag] = React.useState<DragState | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const workStart = minutesFromTime(workingHours.start);
  const workEnd = minutesFromTime(workingHours.end);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Open at the start of the working day, not at midnight.
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (workStart - 60) * MINUTE);
  }, [workStart, view]);

  const allDayCount = Math.max(0, ...days.map((day) => (byDay.get(day) ?? []).filter((event) => event.allDay).length));

  const dayAtPoint = (x: number, y: number): string | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day-column]");
    return element?.dataset.dayColumn ?? null;
  };

  const beginDrag = (pointer: React.PointerEvent, event: CalendarEventDTO, day: string, mode: DragState["mode"]) => {
    if (!event.draggable || pointer.button !== 0) return;
    pointer.stopPropagation();
    (pointer.target as HTMLElement).setPointerCapture?.(pointer.pointerId);
    const start = new Date(event.startsAt);
    const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 30 * 60_000);
    setDrag({
      event,
      mode,
      originY: pointer.clientY,
      originDay: day,
      startMinutes: localDate(start, zone) === day ? localMinutes(start, zone) : 0,
      durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      day,
      deltaMinutes: 0,
      moved: false,
    });
  };

  const onPointerMove = (pointer: React.PointerEvent) => {
    if (!drag) return;
    const raw = (pointer.clientY - drag.originY) / MINUTE;
    const delta = Math.round(raw / SNAP) * SNAP;
    const day = drag.mode === "move" ? (dayAtPoint(pointer.clientX, pointer.clientY) ?? drag.day) : drag.day;
    if (delta !== drag.deltaMinutes || day !== drag.day) setDrag({ ...drag, deltaMinutes: delta, day, moved: true });
  };

  const preview = (state: DragState) => {
    if (state.mode === "resize") {
      const duration = Math.max(SNAP, state.durationMinutes + state.deltaMinutes);
      return { start: state.startMinutes, duration, day: state.day };
    }
    const start = Math.min(24 * 60 - SNAP, Math.max(0, state.startMinutes + state.deltaMinutes));
    return { start, duration: state.durationMinutes, day: state.day };
  };

  const endDrag = () => {
    if (!drag) return;
    const state = drag;
    setDrag(null);
    if (!state.moved) {
      onOpen(state.event);
      return;
    }
    const next = preview(state);
    const hh = String(Math.floor(next.start / 60)).padStart(2, "0");
    const mm = String(next.start % 60).padStart(2, "0");
    const startsAt = instantFromLocal(next.day, `${hh}:${mm}`, zone);
    onMove(state.event, startsAt, new Date(startsAt.getTime() + next.duration * 60_000));
  };

  const nowMinutes = localMinutes(now, zone);

  const createAt = (day: string, click: React.MouseEvent<HTMLElement>) => {
    if (!onCreate) return;
    const rect = click.currentTarget.getBoundingClientRect();
    const minutes = Math.floor((click.clientY - rect.top) / MINUTE / 30) * 30;
    onCreate(day, `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  };

  /*
   * A week on a phone keeps readable days: each day is at least 4.75rem and the
   * whole grid — headers, all-day row and hours together — pans sideways inside
   * a labelled region, while the hours still scroll vertically inside it
   * (AUD-04 §8, D-08-15, MW-17). From md, and for Day, the columns share the
   * width as before.
   */
  const phoneWeek = days.length > 1 ? "min-w-[calc(56px+7*4.75rem)] md:min-w-0" : "";

  return (
    <ScrollRegion label={days.length > 1 ? "Week" : "Day"} className="flex min-h-0 flex-1 flex-col">
    <div className={cn("flex min-h-0 flex-1 flex-col", phoneWeek)} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
      {/* Day headers and the all-day row stay put while hours scroll. */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((day) => {
          const noon = instantFromLocal(day, "12:00", zone);
          const isToday = day === today;
          return (
            <div key={day} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 border-l border-line px-2 py-2">
              <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-subtle">
                {new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short" }).format(noon)}
              </span>
              <span
                className={cn(
                  "grid h-7 min-w-7 place-items-center rounded-full px-1 text-[15px] tabular-nums",
                  isToday ? "bg-accent font-semibold text-accent-fg" : "text-fg",
                )}
              >
                {Number(day.slice(8))}
              </span>
            </div>
          );
        })}
      </div>
      {allDayCount > 0 ? (
        <div className="grid border-b border-line bg-surface-muted/40" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="px-2 py-1.5 text-right text-[11px] text-fg-subtle">All day</div>
          {days.map((day) => (
            <div key={day} className="flex min-w-0 flex-col gap-1 border-l border-line p-1">
              {(byDay.get(day) ?? [])
                .filter((event) => event.allDay)
                .slice(0, 4)
                .map((event) => (
                  <EventCard key={`${event.id}:${day}`} event={event} zone={zone} onOpen={onOpen} />
                ))}
              {(byDay.get(day) ?? []).filter((event) => event.allDay).length > 4 ? (
                <span className="px-1 text-[11px] text-fg-muted">+{(byDay.get(day) ?? []).filter((event) => event.allDay).length - 4} more</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="time-grid">
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_HEIGHT }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] text-fg-subtle tabular-nums" style={{ top: hour * HOUR_HEIGHT }}>
                {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((day) => {
            const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
            const working = workingHours.days.includes(weekday);
            const placed = placeTimedEvents(byDay.get(day) ?? [], day, zone, MINUTE);
            return (
              <div
                key={day}
                data-day-column={day}
                className={cn("relative border-l border-line", day === today && "bg-accent-soft/20", !working && "bg-surface-muted/50")}
                onPointerDown={(pointer) => {
                  lastPointer.current = pointer.pointerType;
                }}
                onDoubleClick={(click) => createAt(day, click)}
                onClick={(click) => {
                  // A finger has no double-click: a tap on an empty slot creates there
                  // (AUD-04 §8, D-08-16, MW-19). A mouse keeps double-click.
                  if (lastPointer.current === "touch" && click.target === click.currentTarget) createAt(day, click);
                }}
              >
                {/* Hour and half-hour rules, and the hours outside the working day. */}
                {working ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 bg-surface-muted/60" style={{ height: workStart * MINUTE }} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-surface-muted/60" style={{ top: workEnd * MINUTE }} />
                  </>
                ) : null}
                {Array.from({ length: 48 }, (_, slot) => (
                  <div
                    key={slot}
                    className={cn("pointer-events-none absolute inset-x-0 border-t", slot % 2 === 0 ? "border-line" : "border-line/40 border-dashed")}
                    style={{ top: slot * (HOUR_HEIGHT / 2) }}
                  />
                ))}

                {placed.map(({ event, top, height, column, columns }) => {
                  const dragging = drag?.event.id === event.id;
                  const width = `calc((100% - 6px) / ${columns})`;
                  return (
                    <div
                      key={`${event.id}:${day}`}
                      className={cn("absolute px-[1px]", dragging && drag?.moved && "opacity-40")}
                      style={{ top, height, left: `calc(3px + ${width} * ${column})`, width }}
                      onPointerDown={(pointer) => beginDrag(pointer, event, day, "move")}
                    >
                      <EventCard
                        event={event}
                        zone={zone}
                        variant="block"
                        onOpen={event.draggable ? () => undefined : onOpen}
                        className={cn(event.draggable && "cursor-grab active:cursor-grabbing")}
                        onKeyDown={(key) => {
                          if (event.draggable && key.key === "Enter") onOpen(event);
                        }}
                      />
                      {event.resizable ? (
                        <span
                          aria-hidden="true"
                          // Visible on touch, and it takes the drag instead of scrolling (AUD-04 §8, D-08-16).
                          className="absolute inset-x-2 bottom-0 h-2 cursor-ns-resize touch-none rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 touch:h-3 touch:bg-fg-subtle/40 touch:opacity-100"
                          onPointerDown={(pointer) => beginDrag(pointer, event, day, "resize")}
                        />
                      ) : null}
                    </div>
                  );
                })}

                {/* The drag ghost, snapped, with its live time. */}
                {drag?.moved && preview(drag).day === day ? (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-20 rounded-[9px] border border-dashed border-[var(--cal)] bg-[color-mix(in_oklab,var(--cal)_14%,var(--nesto-surface))] px-2 py-1 shadow-menu"
                    style={{ ...categoryStyle(drag.event), top: preview(drag).start * MINUTE, height: Math.max(18, preview(drag).duration * MINUTE) }}
                  >
                    <span className="text-[11px] font-medium tabular-nums text-fg">
                      {(() => {
                        const next = preview(drag);
                        const start = instantFromLocal(day, `${String(Math.floor(next.start / 60)).padStart(2, "0")}:${String(next.start % 60).padStart(2, "0")}`, zone);
                        return `${formatClock(start, zone)}–${formatClock(new Date(start.getTime() + next.duration * 60_000), zone)}`;
                      })()}
                    </span>
                  </div>
                ) : null}

                {day === today ? (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: nowMinutes * MINUTE }} aria-hidden="true">
                    <span className="-ml-[5px] size-2.5 rounded-full bg-accent" />
                    <span className="h-px flex-1 bg-accent" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {drag?.moved ? `Moving ${drag.event.title}` : ""}
      </p>
    </div>
    </ScrollRegion>
  );
}
