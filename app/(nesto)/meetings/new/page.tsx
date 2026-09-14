import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MeetingForm } from "@/components/meetings/meeting-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { requireModule } from "@/lib/context/current-user";
import { isLocalDate, isLocalTime } from "@/lib/modules/calendar/calendar.time";
import { meetingFormOptions } from "@/lib/modules/meetings/meeting.options";
import { canCreateMeeting } from "@/lib/modules/meetings/meeting.permissions";

export const metadata: Metadata = { title: "New meeting" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;

/** Schedule a meeting (PRD #40 §87-§89). `?projectId=` and `?date=` prefill from a project or the calendar. */
export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireModule("meetings");
  if (!canCreateMeeting(context)) redirect("/access-denied");
  const params = await searchParams;
  const options = await meetingFormOptions(context);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: options.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = one(params.date);
  const time = one(params.time);

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Meetings", href: "/meetings" }, { label: "New meeting" }]} />
      <div>
        <h1 className="text-page font-semibold text-fg">New meeting</h1>
        <p className="mt-1.5 text-body text-fg-muted">Who, when and why — the agenda, minutes and actions follow on the meeting itself.</p>
      </div>
      <MeetingForm
        mode="create"
        options={options}
        defaults={{ date: date && isLocalDate(date) ? date : today, startTime: time && isLocalTime(time) ? time : undefined, projectId: one(params.projectId) }}
      />
    </div>
  );
}
