import Link from "@/components/navigation/nav-link";
import { Presentation, Repeat, Video } from "lucide-react";

import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { MEETING_TYPE_LABELS, type MeetingListItemDTO } from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";
import { AvatarStack, meetingClock, meetingDate, meetingDay, meetingZoneLabel, MeetingStatusBadge, ResponseBadge } from "./meeting-ui";

/**
 * The meeting list (PRD #40 §90-§92): grouped by day, each row the time, the
 * title, its type and project, the organizer, who is coming and its status —
 * and, for a meeting the reader is on, their own reply.
 *
 * In the Group workspace a row also names its company and opens through it
 * (Workspace Context §34, §45). Times stay in each meeting's own zone; where
 * that is not the reader's reference zone the row says so instead of converting
 * silently.
 */
export function MeetingList({ meetings, zone, today, showProject = true }: { meetings: MeetingListItemDTO[]; zone: string; today: string; showProject?: boolean }) {
  const groups = new Map<string, MeetingListItemDTO[]>();
  for (const meeting of meetings) {
    const day = meetingDate(meeting.startsAt, meeting.timezone || zone);
    groups.set(day, [...(groups.get(day) ?? []), meeting]);
  }

  return (
    <div className="space-y-6" data-testid="meeting-list">
      {[...groups.entries()].map(([day, rows]) => (
        <section key={day} aria-label={meetingDay(rows[0].startsAt, rows[0].timezone || zone)}>
          <h2 className={cn("mb-2 px-1 text-meta font-semibold uppercase tracking-[0.1em]", day === today ? "text-accent-strong" : "text-fg-subtle")}>
            {day === today ? "Today · " : ""}
            {meetingDay(rows[0].startsAt, rows[0].timezone || zone)}
          </h2>
          <ul className="nesto-card divide-y divide-line overflow-hidden">
            {rows.map((meeting) => {
              const rowClass =
                "group grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3.5 outline-none transition-colors hover:bg-hover focus-visible:bg-hover sm:grid-cols-[84px_minmax(0,1fr)_auto] sm:px-5";
              // Only a group row compares zones: a company's own list is all in its own zone.
              const otherZone = Boolean(meeting.company) && meeting.timezone !== zone;
              const body = (
                <>
                  <span className="pt-0.5 text-table tabular-nums text-fg">
                    {meetingClock(meeting.startsAt, meeting.timezone)}
                    <span className="block text-meta text-fg-subtle">{meetingClock(meeting.endsAt, meeting.timezone)}</span>
                    {otherZone ? (
                      <span
                        className="mt-0.5 block text-micro font-medium text-fg-subtle"
                        title={`Shown in ${meeting.timezone} time, this meeting's own time zone. Your home company's zone is ${zone}.`}
                        data-testid="meeting-zone-note"
                      >
                        {meetingZoneLabel(meeting.startsAt, meeting.timezone)}
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("truncate text-body font-medium text-fg group-hover:text-accent-strong", meeting.status === "CANCELLED" && "text-fg-muted line-through")}>{meeting.title}</span>
                      {meeting.recurring ? <Repeat aria-label="Repeating" className="size-3.5 shrink-0 text-fg-subtle" /> : null}
                      {meeting.locationType === "ONLINE" || meeting.locationType === "HYBRID" ? <Video aria-label="Online" className="size-3.5 shrink-0 text-fg-subtle" /> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-fg-muted">
                      {[MEETING_TYPE_LABELS[meeting.meetingType], showProject ? meeting.project?.name : null, meeting.locationText, `Organized by ${meeting.organizer.fullName}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:justify-end">
                    {meeting.company ? <CompanyTag name={meeting.company.name} /> : null}
                    <AvatarStack people={meeting.participantsPreview} total={meeting.participantCount} />
                    {meeting.myResponse && meeting.myRole !== "ORGANIZER" && meeting.status === "SCHEDULED" ? <ResponseBadge response={meeting.myResponse} /> : null}
                    {meeting.status !== "SCHEDULED" ? <MeetingStatusBadge status={meeting.status} /> : null}
                    {meeting.openActionCount > 0 ? <span className="text-meta text-fg-subtle">{meeting.openActionCount} open {meeting.openActionCount === 1 ? "action" : "actions"}</span> : null}
                  </span>
                </>
              );
              return (
                <li key={meeting.id}>
                  {meeting.company ? (
                    <CompanyRecordLink companyId={meeting.company.id} companyName={meeting.company.name} href={meeting.href} data-testid="meeting-row" className={rowClass}>
                      {body}
                    </CompanyRecordLink>
                  ) : (
                    <Link href={meeting.href} data-testid="meeting-row" className={rowClass}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MeetingEmptyIcon() {
  return <Presentation />;
}
