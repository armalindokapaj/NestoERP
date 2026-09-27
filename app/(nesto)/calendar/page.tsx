import type { Metadata } from "next";
import { Suspense } from "react";

import { CalendarShell } from "@/components/calendar/calendar-shell";
import { isView, rangeFor, todayIn } from "@/components/calendar/calendar-model";
import { can } from "@/lib/access/can";
import { requireModule } from "@/lib/context/current-user";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { calendarSettings } from "@/lib/modules/calendar/calendar.service";
import { isLocalDate } from "@/lib/modules/calendar/calendar.time";
import { redirect } from "next/navigation";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("calendar"))("title") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * /calendar (PRD #39 §6, §127).
 *
 * The first range is read on the server — through the same aggregator the API
 * uses — so the calendar paints with its events rather than a skeleton. Every
 * later period is fetched by the client from /api/calendar/events.
 */
export default async function CalendarPage({ searchParams }: Params) {
  const context = await requireModule("calendar");
  if (!can(context, "calendar.view")) redirect("/access-denied");

  const params = await searchParams;
  const settings = await calendarSettings(context.companyId);
  const requestedView = typeof params.view === "string" ? params.view : null;
  const view = isView(requestedView) ? requestedView : isView(settings.defaultView) ? settings.defaultView : "week";
  const date = typeof params.date === "string" && isLocalDate(params.date) ? params.date : todayIn(settings.timezone);
  const openEventId = typeof params.event === "string" && params.event.length <= 64 ? params.event : null;

  const initial = await getCalendar(context, rangeFor(view, date, settings.timezone), {});

  return (
    <Suspense>
      <CalendarShell initial={initial} initialView={view} initialDate={date} explicitView={isView(requestedView)} openEventId={openEventId} />
    </Suspense>
  );
}
