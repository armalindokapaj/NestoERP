import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { expandRecurrence, parseRecurrence } from "./calendar.recurrence";
import { allDaySpan, businessDate } from "./calendar.time";
import type { ConflictDTO } from "./calendar.types";

/**
 * Free/busy (PRD #39 §86-§90).
 *
 * Availability answers one question — when is this person busy? — and nothing
 * else. It is built from the events and meetings a member is on (created, or
 * invited and not declined) and from their approved leave, and it returns intervals only: no
 * title, no project, no module, no leave type. Somebody planning a meeting
 * learns "busy 10:00–11:00", never why (PRD #39 §47, §88).
 */

export type BusyInterval = { startsAt: Date; endsAt: Date };

/** Busy intervals per member over a range, merged and sorted. */
export async function busyIntervals(
  companyId: string,
  memberIds: readonly string[],
  range: { from: Date; to: Date },
  options: { excludeEventId?: string; excludeMeetingId?: string; timezone: string },
): Promise<Map<string, BusyInterval[]>> {
  const result = new Map<string, BusyInterval[]>(memberIds.map((id) => [id, []]));
  if (memberIds.length === 0) return result;
  const members = [...memberIds];

  const events = await prisma.calendarEvent.findMany({
    where: {
      companyId,
      archivedAt: null,
      ...(options.excludeEventId ? { id: { not: options.excludeEventId } } : {}),
      // An all-day company holiday is not somebody being busy.
      NOT: { eventType: { in: ["COMPANY_HOLIDAY", "OFFICE_CLOSURE"] } },
      startsAt: { lt: range.to },
      OR: [
        { recurrenceRule: null, OR: [{ endsAt: { gt: range.from } }, { endsAt: null, startsAt: { gte: range.from } }] },
        { recurrenceRule: { not: null }, OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: range.from } }] },
      ],
      AND: [
        {
          OR: [
            { createdByMemberId: { in: members } },
            { participants: { some: { memberId: { in: members }, status: { not: "DECLINED" } } } },
          ],
        },
      ],
    },
    select: {
      startsAt: true,
      endsAt: true,
      allDay: true,
      timezone: true,
      recurrenceRule: true,
      createdByMemberId: true,
      participants: { where: { memberId: { in: members }, status: { not: "DECLINED" } }, select: { memberId: true } },
    },
    take: 2_000,
  });

  for (const event of events) {
    const who = new Set([event.createdByMemberId, ...event.participants.map((row) => row.memberId)].filter((id) => result.has(id)));
    const occurrences = event.recurrenceRule
      ? expandRecurrence(event, parseRecurrence(event.recurrenceRule), range, 200)
      : [{ startsAt: event.startsAt, endsAt: event.endsAt ?? new Date(event.startsAt.getTime() + 30 * 60_000) }];
    for (const memberId of who) result.get(memberId)!.push(...occurrences);
  }

  // A meeting keeps somebody busy unless they declined it (PRD #40 §27, §256).
  const meetings = await prisma.meeting.findMany({
    where: {
      companyId,
      archivedAt: null,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      ...(options.excludeMeetingId ? { id: { not: options.excludeMeetingId } } : {}),
      startsAt: { lt: range.to },
      endsAt: { gt: range.from },
      participants: { some: { memberId: { in: members }, response: { not: "DECLINED" } } },
    },
    select: {
      startsAt: true,
      endsAt: true,
      participants: { where: { memberId: { in: members }, response: { not: "DECLINED" } }, select: { memberId: true } },
    },
    take: 2_000,
  });
  for (const meeting of meetings) {
    for (const participant of meeting.participants) result.get(participant.memberId)?.push({ startsAt: meeting.startsAt, endsAt: meeting.endsAt });
  }

  const leave = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      companyMemberId: { in: members },
      status: "APPROVED",
      startDate: { lt: new Date(range.to.getTime() + 86_400_000) },
      endDate: { gt: new Date(range.from.getTime() - 86_400_000) },
    },
    select: { companyMemberId: true, startDate: true, endDate: true },
  });
  for (const row of leave) {
    const span = allDaySpan(businessDate(row.startDate), businessDate(row.endDate), options.timezone);
    result.get(row.companyMemberId)?.push(span);
  }

  for (const [memberId, intervals] of result) result.set(memberId, merge(intervals, range));
  return result;
}

function merge(intervals: BusyInterval[], range: { from: Date; to: Date }): BusyInterval[] {
  const clipped = intervals
    .filter((row) => row.endsAt > range.from && row.startsAt < range.to)
    .map((row) => ({
      startsAt: new Date(Math.max(row.startsAt.getTime(), range.from.getTime())),
      endsAt: new Date(Math.min(row.endsAt.getTime(), range.to.getTime())),
    }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const merged: BusyInterval[] = [];
  for (const row of clipped) {
    const last = merged.at(-1);
    if (last && row.startsAt <= last.endsAt) last.endsAt = new Date(Math.max(last.endsAt.getTime(), row.endsAt.getTime()));
    else merged.push({ ...row });
  }
  return merged;
}

async function sameCompanyMembers(companyId: string, memberIds: readonly string[]) {
  const rows = await prisma.companyMember.findMany({
    where: { companyId, id: { in: [...memberIds] }, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
}

/** GET /api/calendar/availability — intervals only (PRD #39 §87). */
export async function getAvailability(
  context: UserContext,
  input: { memberIds: string[]; from: Date; to: Date; excludeEventId?: string; excludeMeetingId?: string },
  timezone: string,
): Promise<ConflictDTO[]> {
  if (!canAccessModule(context, "calendar") || !can(context, "calendar.availability.view")) throw new AccessError("FORBIDDEN");
  const names = await sameCompanyMembers(context.companyId, input.memberIds);
  // A member of another company is simply absent from the answer.
  const known = input.memberIds.filter((id) => names.has(id));
  const busy = await busyIntervals(context.companyId, known, { from: input.from, to: input.to }, { excludeEventId: input.excludeEventId, excludeMeetingId: input.excludeMeetingId, timezone });
  return known.map((memberId) => ({
    memberId,
    fullName: names.get(memberId)!,
    busy: (busy.get(memberId) ?? []).map((row) => ({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
  }));
}

/** Who among these people is already busy during [startsAt, endsAt) — a warning, never a refusal (PRD #39 §89). */
export async function findConflicts(
  context: UserContext,
  memberIds: readonly string[],
  window: { startsAt: Date; endsAt: Date },
  options: { excludeEventId?: string; excludeMeetingId?: string; timezone: string },
): Promise<ConflictDTO[]> {
  if (memberIds.length === 0 || !can(context, "calendar.availability.view")) return [];
  if (window.endsAt <= window.startsAt) return [];
  const names = await sameCompanyMembers(context.companyId, memberIds);
  const busy = await busyIntervals(context.companyId, [...names.keys()], { from: window.startsAt, to: window.endsAt }, options);
  return [...busy.entries()]
    .filter(([, intervals]) => intervals.length > 0)
    .map(([memberId, intervals]) => ({
      memberId,
      fullName: names.get(memberId)!,
      busy: intervals.map((row) => ({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
    }));
}
