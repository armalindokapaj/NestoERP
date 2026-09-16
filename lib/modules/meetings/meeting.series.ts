import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { parseRecurrence, RecurrenceError } from "@/lib/modules/calendar/calendar.recurrence";
import { SERIES_OCCURRENCES_MAX } from "./meeting.schema";
import { planOccurrences, SERIES_HORIZON_DAYS } from "./meeting.service";
import { copyMeetingReminders } from "@/lib/modules/calendar/calendar.service";

/**
 * The meeting series job (PRD #40 §226, §229, §230).
 *
 * Keeps every open series populated SERIES_HORIZON_DAYS ahead — never further,
 * never infinitely. Each new occurrence copies the people, agenda and reminders
 * of the latest one, so a participant added "for this and later meetings"
 * carries on. Nobody is notified: they were invited to the series already.
 *
 * Idempotent: occurrences are numbered from the series start and keyed by
 * (series, number), so a rerun or an overlapping run creates nothing twice.
 */

const DAY_MS = 86_400_000;
/** A series is topped up once its generated horizon is this close. */
const REFILL_WITHIN_DAYS = 14;
const BATCH = 50;

export type SeriesRunResult = { series: number; created: number };

export async function extendMeetingSeries(now: Date = new Date()): Promise<SeriesRunResult> {
  const horizon = new Date(now.getTime() + SERIES_HORIZON_DAYS * DAY_MS);
  const candidates = await prisma.meetingSeries.findMany({
    where: {
      cancelledAt: null,
      generatedUntil: { lt: new Date(now.getTime() + (SERIES_HORIZON_DAYS - REFILL_WITHIN_DAYS) * DAY_MS) },
      OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: now } }],
      company: { status: "ACTIVE" },
    },
    orderBy: { generatedUntil: "asc" },
    take: BATCH,
  });

  let created = 0;
  for (const series of candidates) {
    try {
      created += await extendOne(series, horizon);
    } catch (error) {
      logger.error("meetings.series.failed", {
        companyId: series.companyId,
        seriesId: series.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (!(error instanceof RecurrenceError)) throw error;
    }
  }
  if (created > 0) incrementCounter(Metric.MEETING_SERIES_GENERATED, {}, created);
  return { series: candidates.length, created };
}

async function extendOne(
  series: Awaited<ReturnType<typeof prisma.meetingSeries.findMany>>[number],
  horizon: Date,
): Promise<number> {
  const rule = parseRecurrence(series.recurrenceRule);
  const latest = await prisma.meeting.findFirst({
    where: { seriesId: series.id },
    orderBy: { occurrenceIndex: "desc" },
    include: {
      participants: true,
      agendaItems: { orderBy: { sortOrder: "asc" } },
      reminders: { select: { memberId: true, minutesBefore: true, channel: true } },
    },
  });
  if (!latest || latest.occurrenceIndex === null) {
    await prisma.meetingSeries.update({ where: { id: series.id }, data: { generatedUntil: horizon } });
    return 0;
  }

  const first = { startsAt: series.firstStartsAt, endsAt: new Date(series.firstStartsAt.getTime() + series.durationMinutes * 60_000), timezone: series.timezone };
  const upcoming = planOccurrences(first, rule, horizon)
    .filter((occurrence) => occurrence.occurrenceIndex > latest.occurrenceIndex!)
    .slice(0, SERIES_OCCURRENCES_MAX);

  // The people on the series now: nobody whose membership has since ended.
  const active = new Set(
    (
      await prisma.companyMember.findMany({
        where: { id: { in: latest.participants.map((row) => row.memberId) }, companyId: series.companyId, status: "ACTIVE" },
        select: { id: true },
      })
    ).map((row) => row.id),
  );
  const organizerMemberId = active.has(latest.organizerMemberId) ? latest.organizerMemberId : null;

  const count = await prisma.$transaction(
    async (tx) => {
      if (upcoming.length === 0 || !organizerMemberId) {
        await tx.meetingSeries.update({ where: { id: series.id }, data: { generatedUntil: horizon } });
        return 0;
      }
      const meetings = await tx.meeting.createManyAndReturn({
        data: upcoming.map((occurrence) => ({
          companyId: series.companyId,
          projectId: series.projectId,
          departmentId: series.departmentId,
          createdByMemberId: series.createdByMemberId,
          organizerMemberId,
          title: series.title,
          description: series.description,
          meetingType: series.meetingType,
          status: "SCHEDULED" as const,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          timezone: series.timezone,
          locationType: series.locationType,
          locationText: series.locationText,
          onlineUrl: series.onlineUrl,
          visibility: series.visibility,
          seriesId: series.id,
          occurrenceIndex: occurrence.occurrenceIndex,
        })),
        skipDuplicates: true,
        select: { id: true },
      });
      const ids = meetings.map((meeting) => meeting.id);
      if (ids.length > 0) {
        const now = new Date();
        await tx.meetingParticipant.createMany({
          data: ids.flatMap((meetingId) =>
            latest.participants
              .filter((row) => active.has(row.memberId))
              .map((row) => ({
                meetingId,
                memberId: row.memberId,
                companyId: series.companyId,
                role: row.role,
                required: row.required,
                displayName: row.displayName,
                response: row.role === "ORGANIZER" ? ("ACCEPTED" as const) : ("PENDING" as const),
                invitedAt: now,
                respondedAt: row.role === "ORGANIZER" ? now : null,
              })),
          ),
          skipDuplicates: true,
        });
        if (latest.agendaItems.length > 0) {
          await tx.meetingAgendaItem.createMany({
            data: ids.flatMap((meetingId) =>
              latest.agendaItems.map((item, index) => ({
                companyId: series.companyId,
                meetingId,
                sortOrder: index,
                title: item.title,
                description: item.description,
                presenterMemberId: item.presenterMemberId && active.has(item.presenterMemberId) ? item.presenterMemberId : null,
                plannedMinutes: item.plannedMinutes,
              })),
            ),
          });
        }
        const reminders = latest.reminders.filter((row) => active.has(row.memberId));
        if (reminders.length > 0) {
          await copyMeetingReminders(tx, series.companyId, { meetingIds: ids, reminders });
        }
      }
      await tx.meetingSeries.update({
        where: { id: series.id },
        data: { generatedUntil: upcoming.length >= SERIES_OCCURRENCES_MAX ? upcoming.at(-1)!.startsAt : horizon },
      });
      return ids.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  return count;
}
