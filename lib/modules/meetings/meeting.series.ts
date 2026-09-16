import type { Prisma } from "@prisma/client";

import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { parseRecurrence } from "@/lib/modules/calendar/calendar.recurrence";
import { copyMeetingReminders } from "@/lib/modules/calendar/calendar.service";
import { ENTITY, MODULE } from "./meeting.repository";
import { SERIES_OCCURRENCES_MAX } from "./meeting.schema";
import { lockSeries, planOccurrences, SERIES_HORIZON_DAYS } from "./meeting.service";

/**
 * The meeting series job (PRD #40 §226, §229, §230; PRD #51 §71-§75).
 *
 * Keeps every open series populated SERIES_HORIZON_DAYS ahead — never further,
 * never infinitely. Each new occurrence copies the people, agenda and reminders
 * of the latest one, so a participant added "for this and later meetings"
 * carries on. Nobody is notified: they were invited to the series already.
 *
 * Company by company, and only where the meetings module is on; each series in
 * its own transaction, walked by id so that one which cannot be extended — a
 * stored rule that no longer parses, a failed write — is logged and passed
 * over rather than read again first, run after run, ahead of everyone else's.
 * The run then ends as a partial failure (PRD #51 §30-§36, §133-§138).
 *
 * Idempotent: occurrences are numbered from the series start and keyed by
 * (series, number), so a rerun or an overlapping run creates nothing twice
 * (§72, §185). A missed run is caught up by the next, which fills every
 * number from now up to the horizon (§74).
 */

const JOB = "meetings.series";
const DAY_MS = 86_400_000;
/** A series is topped up once its generated horizon is this close. */
const REFILL_WITHIN_DAYS = 14;
/** Series read per query (PRD #51 §134). */
export const SERIES_BATCH = 50;

export type SeriesRunResult = {
  /** Series that were due and looked at. */
  series: number;
  created: number;
  /** Series left where they were because nobody active organizes them. */
  stalled: number;
  failed: number;
};

export async function extendMeetingSeries(now: Date = new Date(), options: { batchSize?: number } = {}): Promise<SeriesRunResult> {
  const batchSize = options.batchSize ?? SERIES_BATCH;
  const result: SeriesRunResult = { series: 0, created: 0, stalled: 0, failed: 0 };
  // A company that switched meetings off gets no new meetings, and a suspended one none either (PRD #51 §145).
  const report = await forEachCompany(JOB, (system) => extendCompanySeries(system.companyId, now, batchSize, result), { moduleKey: MODULE });
  if (result.created > 0) incrementCounter(Metric.MEETING_SERIES_GENERATED, {}, result.created);
  assertEveryCompanySucceeded(JOB, report);
  return result;
}

function dueSeries(companyId: string, now: Date): Prisma.MeetingSeriesWhereInput {
  return {
    companyId,
    cancelledAt: null,
    generatedUntil: { lt: new Date(now.getTime() + (SERIES_HORIZON_DAYS - REFILL_WITHIN_DAYS) * DAY_MS) },
    OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: now } }],
  };
}

async function extendCompanySeries(companyId: string, now: Date, batchSize: number, result: SeriesRunResult): Promise<void> {
  let after = "";
  let failed = 0;
  while (!jobStopRequested()) {
    const batch = await prisma.meetingSeries.findMany({
      where: { ...dueSeries(companyId, now), id: { gt: after } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true },
    });
    for (const { id } of batch) {
      if (jobStopRequested()) break;
      try {
        const outcome = await extendOne(companyId, id, now);
        if (!outcome) continue;
        result.series += 1;
        result.created += outcome.created;
        if (outcome.stalled) result.stalled += 1;
      } catch (error) {
        failed += 1;
        result.failed += 1;
        logger.error("meetings.series.item_failed", { companyId, seriesId: id, ...serialiseError(error) });
      }
    }
    if (batch.length < batchSize) break;
    after = batch.at(-1)!.id;
  }
  if (failed > 0) throw new JobError("PARTIAL_FAILURE", `${failed} meeting series could not be extended`);
}

/** Null when the series stopped being due between the page read and the lock. */
async function extendOne(companyId: string, seriesId: string, now: Date): Promise<{ created: number; stalled: boolean } | null> {
  const horizon = new Date(now.getTime() + SERIES_HORIZON_DAYS * DAY_MS);

  return prisma.$transaction(
    async (tx) => {
      // Everything below reads the series as it is under the lock: a "this and
      // later" cancel or edit that committed first is seen, and one that comes
      // after waits and then sees the meetings made here (PRD #40 §228, PRD #51 §75).
      await lockSeries(tx, seriesId);
      const series = await tx.meetingSeries.findFirst({ where: { ...dueSeries(companyId, now), id: seriesId } });
      if (!series) return null;

      const rule = parseRecurrence(series.recurrenceRule);
      const latest = await tx.meeting.findFirst({
        where: { seriesId: series.id, companyId },
        orderBy: { occurrenceIndex: "desc" },
        include: {
          participants: true,
          agendaItems: { orderBy: { sortOrder: "asc" } },
          reminders: { select: { memberId: true, minutesBefore: true, channel: true } },
        },
      });
      if (!latest || latest.occurrenceIndex === null) {
        await tx.meetingSeries.update({ where: { id: series.id }, data: { generatedUntil: horizon } });
        return { created: 0, stalled: false };
      }

      const first = { startsAt: series.firstStartsAt, endsAt: new Date(series.firstStartsAt.getTime() + series.durationMinutes * 60_000), timezone: series.timezone };
      // After a long outage the numbers in between belong to meetings that
      // never happened: they stay unused rather than appear as scheduled in
      // the past (PRD #51 §74).
      const upcoming = planOccurrences(first, rule, horizon)
        .filter((occurrence) => occurrence.occurrenceIndex > latest.occurrenceIndex! && occurrence.startsAt >= now)
        .slice(0, SERIES_OCCURRENCES_MAX);
      if (upcoming.length === 0) {
        await tx.meetingSeries.update({ where: { id: series.id }, data: { generatedUntil: horizon } });
        return { created: 0, stalled: false };
      }

      // The people on the series now: nobody whose membership has since ended.
      const active = new Set(
        (
          await tx.companyMember.findMany({
            where: { id: { in: latest.participants.map((row) => row.memberId) }, companyId, status: "ACTIVE" },
            select: { id: true },
          })
        ).map((row) => row.id),
      );
      if (!active.has(latest.organizerMemberId)) {
        // A meeting needs an organizer. The series waits where it is, and picks
        // up by itself once the latest meeting is handed to somebody active —
        // rather than being moved to the horizon as if it had been filled.
        logger.warn("meetings.series.organizer_inactive", { companyId, seriesId: series.id, meetingId: latest.id });
        return { created: 0, stalled: true };
      }

      const meetings = await tx.meeting.createManyAndReturn({
        data: upcoming.map((occurrence) => ({
          companyId,
          projectId: series.projectId,
          departmentId: series.departmentId,
          createdByMemberId: series.createdByMemberId,
          organizerMemberId: latest.organizerMemberId,
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
        select: { id: true, startsAt: true },
      });
      const ids = meetings.map((meeting) => meeting.id);
      if (ids.length > 0) {
        const invitedAt = new Date();
        const participants = latest.participants.filter((row) => active.has(row.memberId));
        await tx.meetingParticipant.createMany({
          data: ids.flatMap((meetingId) =>
            participants.map((row) => ({
              meetingId,
              memberId: row.memberId,
              companyId,
              role: row.role,
              required: row.required,
              displayName: row.displayName,
              response: row.role === "ORGANIZER" ? ("ACCEPTED" as const) : ("PENDING" as const),
              invitedAt,
              respondedAt: row.role === "ORGANIZER" ? invitedAt : null,
            })),
          ),
          skipDuplicates: true,
        });
        if (latest.agendaItems.length > 0) {
          await tx.meetingAgendaItem.createMany({
            data: ids.flatMap((meetingId) =>
              latest.agendaItems.map((item, index) => ({
                companyId,
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
          await copyMeetingReminders(tx, companyId, { meetingIds: ids, reminders });
        }

        // The same evidence a person creating these meetings leaves, one entry
        // per batch as `createMeeting` writes one per series, attributed to
        // the job (PRD #51 §13, §149).
        const head = meetings.reduce((earliest, meeting) => (meeting.startsAt < earliest.startsAt ? meeting : earliest));
        await recordSystemAction(
          companyId,
          {
            actionKey: AuditAction.MEETING_CREATED,
            entity: { type: ENTITY, id: head.id, label: series.visibility === "PARTICIPANTS" ? undefined : series.title },
            projectId: series.projectId,
            metadata: {
              meetingType: series.meetingType,
              visibility: series.visibility,
              status: "SCHEDULED",
              projectId: series.projectId,
              departmentId: series.departmentId,
              participantCount: participants.filter((row) => row.role !== "ORGANIZER").length,
              seriesId: series.id,
              occurrences: ids.length,
            },
          },
          { tx },
        );
      }
      // Under the lock taken above, so the row is the one read.
      await tx.meetingSeries.update({
        where: { id: series.id },
        data: { generatedUntil: upcoming.length >= SERIES_OCCURRENCES_MAX ? upcoming.at(-1)!.startsAt : horizon },
      });
      return { created: ids.length, stalled: false };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
