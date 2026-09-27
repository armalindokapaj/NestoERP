import * as React from "react";
import type { MeetingResponseStatus, MeetingStatus } from "@prisma/client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MEETING_STATUS_LABELS, RESPONSE_LABELS, type MeetingPersonDTO } from "@/lib/modules/meetings/meeting.types";
import { cn } from "@/lib/utils/cn";
import { MeetingsLabel } from "./meetings-text";

/**
 * Meeting presentation pieces shared by the list, the workspace and the print
 * view (PRD #40 §129-§131). Quiet: a status is a word first and a tint second.
 */

const STATUS_TONE: Record<MeetingStatus, "default" | "neutral" | "info" | "success"> = {
  DRAFT: "default",
  SCHEDULED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "default",
};

export function MeetingStatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={cn(status === "CANCELLED" && "line-through decoration-fg-subtle/60", className)} data-testid="meeting-status">
      {status === "IN_PROGRESS" ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-info-strong" /> : null}
      <MeetingsLabel group="status" value={status} fallback={MEETING_STATUS_LABELS[status]} />
    </Badge>
  );
}

const RESPONSE_TONE: Record<MeetingResponseStatus, "default" | "success" | "warning"> = {
  PENDING: "default",
  ACCEPTED: "success",
  DECLINED: "default",
  TENTATIVE: "warning",
};

export function ResponseBadge({ response }: { response: MeetingResponseStatus }) {
  return <Badge tone={RESPONSE_TONE[response]}><MeetingsLabel group="response" value={response} fallback={RESPONSE_LABELS[response]} /></Badge>;
}

function split(fullName: string): { firstName: string; lastName: string } {
  const [firstName = "", ...rest] = fullName.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

export function PersonAvatar({ person, size = "sm", className }: { person: Pick<MeetingPersonDTO, "fullName" | "avatarUrl">; size?: "sm" | "md"; className?: string }) {
  return <Avatar {...split(person.fullName)} src={person.avatarUrl} size={size} className={className} />;
}

/** First few faces and a count (PRD #40 §131). */
/** `label` is the count in the reader's language ("3 people"); English when not given. */
export function AvatarStack({ people, total, max = 4, label }: { people: Array<Pick<MeetingPersonDTO, "memberId" | "fullName" | "avatarUrl">>; total: number; max?: number; label?: string }) {
  const shown = people.slice(0, max);
  const more = total - shown.length;
  return (
    <span className="flex items-center" role="img" aria-label={label ?? `${total} ${total === 1 ? "person" : "people"}`}>
      {shown.map((person, index) => (
        <span key={person.memberId} className={cn("relative rounded-full ring-2 ring-surface", index > 0 && "-ml-1.5")} style={{ zIndex: shown.length - index }} title={person.fullName}>
          <PersonAvatar person={person} />
        </span>
      ))}
      {more > 0 ? <span className="-ml-1.5 inline-flex size-7 items-center justify-center rounded-full border border-line bg-surface-muted text-micro font-medium text-fg-muted ring-2 ring-surface">+{more}</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Time, always in the meeting's zone (PRD #40 §206)                            */
/* -------------------------------------------------------------------------- */

export function meetingDay(iso: string, zone: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options }).format(new Date(iso));
}

export function meetingClock(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function meetingDate(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** The zone's short name at that moment ("CEST", "GMT+2"), so a time can say which clock it is on. */
export function meetingZoneLabel(iso: string, zone: string): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((entry) => entry.type === "timeZoneName");
  return part?.value ?? zone;
}

/** "Wed 16 Sep · 10:00–11:00" */
export function meetingWhen(startsAt: string, endsAt: string, zone: string): string {
  return `${meetingDay(startsAt, zone, { weekday: "short", day: "numeric", month: "short" })} · ${meetingClock(startsAt, zone)}–${meetingClock(endsAt, zone)}`;
}

export function durationLabel(startsAt: string, endsAt: string): string {
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Plain text with paragraphs kept — rendered as text nodes, never HTML (PRD #40 §237). */
export function PlainText({ text, className }: { text: string; className?: string }) {
  return <p className={cn("whitespace-pre-wrap break-words", className)}>{text}</p>;
}
