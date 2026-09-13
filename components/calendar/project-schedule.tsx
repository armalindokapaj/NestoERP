"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { CalendarEventDTO, CalendarResponse } from "@/lib/modules/calendar/calendar.types";
import { AgendaView } from "./agenda-view";
import { todayIn } from "./calendar-model";
import { EventDrawer } from "./event-drawer";

/**
 * The project calendar tab: the agenda over the next eight weeks, with the
 * same drawer as /calendar (PRD #39 §159). Editing happens on /calendar.
 */
export function ProjectSchedule({ calendar, startDate }: { calendar: CalendarResponse; startDate: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<CalendarEventDTO | null>(null);
  const zone = calendar.timezone;
  const today = todayIn(zone);

  // The agenda helper shows 14 days from a start; the tab shows the loaded range day by day.
  const [start, setStart] = React.useState(startDate < today ? today : startDate);

  return (
    <section className="nesto-card px-3 md:px-5" aria-label="Project schedule">
      {calendar.meta.partialFailureProviders?.length ? (
        <p role="status" className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-table text-warning-strong">
          Some calendar items could not be loaded.
        </p>
      ) : null}
      <AgendaView date={start} zone={zone} today={today} events={calendar.events} onOpen={setOpen} />
      <div className="flex justify-between border-t border-line py-3">
        <button type="button" className="text-table font-medium text-fg-muted hover:text-fg" onClick={() => setStart(today)}>
          From today
        </button>
        <button
          type="button"
          className="text-table font-medium text-accent-strong hover:underline"
          onClick={() => setStart((value) => {
            const [y, m, d] = value.split("-").map(Number);
            return new Date(Date.UTC(y, m - 1, d + 14)).toISOString().slice(0, 10);
          })}
        >
          Next two weeks
        </button>
      </div>
      <EventDrawer
        event={open}
        zone={zone}
        onOpenChange={(value) => (value ? null : setOpen(null))}
        onEdit={(detail) => router.push(`/calendar?event=${detail.id}`)}
        onChanged={() => router.refresh()}
      />
    </section>
  );
}
