"use client";

import * as React from "react";
import { Repeat } from "lucide-react";

import { formatClock } from "@/lib/modules/calendar/calendar.format";
import type { CalendarEventDTO } from "@/lib/modules/calendar/calendar.types";
import { cn } from "@/lib/utils/cn";
import { CATEGORY_META } from "./calendar-model";

/**
 * One event, in the Quiet Luxury card (PRD #39 §19, §99, §153-§155).
 *
 * A 1px neutral border, a light tint of the category mixed into the surface,
 * a 3px category rail and the category icon — so colour is never the only
 * signal (PRD #39 §123). Severity alone earns warning or danger.
 */

type Variant = "chip" | "block" | "row";

export function categoryStyle(event: CalendarEventDTO): React.CSSProperties {
  const token = event.privacyMode === "BUSY_ONLY" ? "var(--nesto-cal-project)" : CATEGORY_META[event.category].token;
  const rail = event.severity === "critical" ? "var(--nesto-danger)" : event.severity === "warning" ? "var(--nesto-warning)" : token;
  return { ["--cal" as string]: token, ["--cal-rail" as string]: rail } as React.CSSProperties;
}

export function eventAccessibleLabel(event: CalendarEventDTO, zone: string): string {
  const time = event.allDay ? "all day" : `${formatClock(new Date(event.startsAt), zone)}${event.endsAt ? ` to ${formatClock(new Date(event.endsAt), zone)}` : ""}`;
  const kind = event.privacyMode === "BUSY_ONLY" ? "" : `${CATEGORY_META[event.category].label}: `;
  const extra = [event.status === "OVERDUE" ? "overdue" : null, event.severity === "critical" ? "critical" : null].filter(Boolean).join(", ");
  return `${kind}${event.title}, ${time}${extra ? `, ${extra}` : ""}`;
}

export const EventCard = React.forwardRef<
  HTMLButtonElement,
  {
    event: CalendarEventDTO;
    zone: string;
    variant?: Variant;
    selected?: boolean;
    showTime?: boolean;
    onOpen: (event: CalendarEventDTO) => void;
  } & Omit<React.ComponentProps<"button">, "onClick">
>(function EventCard({ event, zone, variant = "chip", selected, showTime = true, onOpen, className, style, ...props }, ref) {
  const Icon = event.privacyMode === "BUSY_ONLY" ? null : CATEGORY_META[event.category].icon;
  const busy = event.privacyMode === "BUSY_ONLY";
  const time = !event.allDay && showTime ? formatClock(new Date(event.startsAt), zone) : null;

  return (
    <button
      ref={ref}
      type="button"
      data-testid="calendar-event"
      data-source={event.sourceType}
      aria-label={eventAccessibleLabel(event, zone)}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onOpen(event);
      }}
      style={{ ...categoryStyle(event), ...style }}
      className={cn(
        "group relative flex w-full min-w-0 items-start gap-1.5 overflow-hidden rounded-[9px] border text-left outline-none",
        "border-line bg-[color-mix(in_oklab,var(--cal)_7%,var(--nesto-surface))] text-fg",
        "transition-[box-shadow,border-color,transform] duration-150 ease-nesto hover:border-line-strong hover:shadow-card",
        "focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--cal-rail)]",
        busy && "bg-[repeating-linear-gradient(135deg,var(--nesto-surface-muted)_0_6px,var(--nesto-surface)_6px_12px)] text-fg-muted",
        selected && "border-[var(--cal)] shadow-card",
        variant === "chip" && "h-[22px] items-center py-0 pl-2.5 pr-1.5",
        variant === "block" && "h-full flex-col gap-0 py-1 pl-2.5 pr-1.5",
        variant === "row" && "items-center py-2 pl-3 pr-2",
        className,
      )}
      {...props}
    >
      {variant === "block" ? (
        <>
          <span className="flex w-full min-w-0 items-center gap-1 text-[12px] font-medium leading-4">
            {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0 text-[var(--cal)]" /> : null}
            <span className="truncate">{event.title}</span>
            {event.occurrence?.recurring ? <Repeat aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" /> : null}
          </span>
          {time ? (
            <span className="truncate text-[11px] leading-4 text-fg-muted tabular-nums">
              {time}
              {event.endsAt ? `–${formatClock(new Date(event.endsAt), zone)}` : ""}
              {event.location ? ` · ${event.location}` : ""}
            </span>
          ) : null}
        </>
      ) : (
        <>
          {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0 text-[var(--cal)]" /> : null}
          {time ? <span className="shrink-0 text-[11px] text-fg-muted tabular-nums">{time}</span> : null}
          <span className={cn("min-w-0 truncate", variant === "row" ? "text-table font-medium" : "text-[12px] leading-4")}>{event.title}</span>
          {event.status === "OVERDUE" ? (
            <span className="ml-auto shrink-0 rounded-full bg-warning-soft px-1.5 text-[10px] font-medium text-warning-strong">Overdue</span>
          ) : event.severity === "critical" ? (
            <span className="ml-auto shrink-0 rounded-full bg-danger-soft px-1.5 text-[10px] font-medium text-danger-strong">Critical</span>
          ) : null}
        </>
      )}
    </button>
  );
});
