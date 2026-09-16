import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { runWithinJob } from "@/lib/core/jobs/job.context";
import * as calendar from "@/lib/modules/calendar/calendar.service";
import { addLocalDays, instantFromLocal, localDate, localTime } from "@/lib/modules/calendar/calendar.time";
import { createMeetingSchema, updateMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { extendMeetingSeries, SERIES_BATCH } from "@/lib/modules/meetings/meeting.series";
import { cancelMeeting, createMeeting, getMeeting, SERIES_HORIZON_DAYS, updateMeeting } from "@/lib/modules/meetings/meeting.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";

/**
 * `meetings.series` — the job's contract (PRD #51 §71-§75, §173-§185, §277; PRD #40 §226-§230).
 *
 * Most series are written straight to the tables with one meeting and nothing
 * generated after it, so the job has a known window to fill; the edit and
 * cancel cases go through the meeting service, because what they prove is how
 * the job and a person's "this and later" change meet.
 */

const JOB = "meetings.series";
const TAG = `JOBSERIES-${process.pid}-${Date.now().toString(36)}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORGANIZER: Record<string, string> = { [COMPANY_A]: "member_pm", [COMPANY_B]: "member_owner_b" };
const GUEST: Record<string, string> = { [COMPANY_A]: "member_engineer", [COMPANY_B]: "member_viewer_b" };

const seriesIds = new Set<string>();
let counter = 0;

afterEach(async () => {
  vi.restoreAllMocks();
  const meetingIds = (await prisma.meeting.findMany({ where: { seriesId: { in: [...seriesIds] } }, select: { id: true } })).map((row) => row.id);
  const reminders = await prisma.calendarReminder.findMany({ where: { meetingId: { in: meetingIds } }, select: { id: true } });
  await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: meetingIds } } });
  await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: meetingIds } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: meetingIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: meetingIds } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: meetingIds } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: meetingIds } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: meetingIds } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: meetingIds } } });
  await prisma.meeting.deleteMany({ where: { id: { in: meetingIds } } });
  await prisma.meetingSeries.deleteMany({ where: { id: { in: [...seriesIds] } } });
  seriesIds.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/** A series with its first meeting — people, agenda, reminders — and nothing generated after it. */
async function seriesFixture(companyId: string, input: { firstStartsAt: Date; rule?: string; timezone?: string; organizerMemberId?: string }) {
  counter += 1;
  const organizer = input.organizerMemberId ?? ORGANIZER[companyId];
  const guest = GUEST[companyId];
  const timezone = input.timezone ?? "Europe/Tirane";
  const series = await prisma.meetingSeries.create({
    data: {
      companyId,
      createdByMemberId: organizer,
      title: `${TAG} series ${counter}`,
      meetingType: "INTERNAL",
      visibility: "PARTICIPANTS",
      firstStartsAt: input.firstStartsAt,
      durationMinutes: 30,
      timezone,
      recurrenceRule: input.rule ?? "FREQ=WEEKLY;INTERVAL=1",
      generatedUntil: input.firstStartsAt,
    },
  });
  seriesIds.add(series.id);
  const first = await prisma.meeting.create({
    data: {
      companyId,
      createdByMemberId: organizer,
      organizerMemberId: organizer,
      title: series.title,
      meetingType: "INTERNAL",
      status: "SCHEDULED",
      startsAt: input.firstStartsAt,
      endsAt: new Date(input.firstStartsAt.getTime() + 30 * 60_000),
      timezone,
      visibility: "PARTICIPANTS",
      seriesId: series.id,
      occurrenceIndex: 0,
    },
  });
  await prisma.meetingParticipant.createMany({
    data: [
      { meetingId: first.id, companyId, memberId: organizer, role: "ORGANIZER", response: "ACCEPTED", displayName: "Organizer" },
      { meetingId: first.id, companyId, memberId: guest, role: "ATTENDEE", displayName: "Guest" },
    ],
  });
  await prisma.meetingAgendaItem.create({ data: { companyId, meetingId: first.id, sortOrder: 0, title: "Progress" } });
  await prisma.calendarReminder.createMany({
    data: [organizer, guest].map((memberId) => ({ companyId, meetingId: first.id, memberId, minutesBefore: 30 })),
  });
  return series;
}

const occurrences = (seriesId: string) => prisma.meeting.findMany({ where: { seriesId }, orderBy: { occurrenceIndex: "asc" } });
const seriesRow = (seriesId: string) => prisma.meetingSeries.findUniqueOrThrow({ where: { id: seriesId } });
const creationAudit = async (seriesId: string) =>
  prisma.auditEvent.findMany({ where: { actionKey: "MEETING_CREATED", entityId: { in: (await occurrences(seriesId)).map((row) => row.id) } } });

/** Runs the job's function inside a job run for one company, with a batch size a test can overflow. */
function runInBatches(now: Date, companyId: string, batchSize: number) {
  return runWithinJob(
    { jobKey: JOB, runId: TAG, correlationId: TAG, workerId: TAG, signal: new AbortController().signal, companyIds: [companyId], dryRun: false },
    () => extendMeetingSeries(now, { batchSize }),
  );
}

/** The first local day whose 09:00 is a different UTC offset from the day before's. */
function nextClockChange(zone: string): string {
  const offset = (date: string) => instantFromLocal(date, "09:00", zone).getTime() - Date.parse(`${date}T09:00:00Z`);
  let day = localDate(new Date(), zone);
  for (let step = 0; step < 400; step += 1) {
    const next = addLocalDays(day, 1);
    if (offset(next) !== offset(day)) return next;
    day = next;
  }
  throw new Error(`${zone} does not change its clocks within a year`);
}

/**
 * A weekly series made the way a person makes one, cut back to its first four
 * meetings as though the horizon had been reached a month ago.
 */
async function servicedSeries(pm: UserContext, engineer: UserContext) {
  const zone = "Europe/Tirane";
  const { meeting } = await createMeeting(
    pm,
    createMeetingSchema.parse({
      title: `${TAG} weekly ${(counter += 1)}`,
      meetingType: "INTERNAL",
      visibility: "PARTICIPANTS",
      date: addLocalDays(localDate(new Date(), zone), 1),
      startTime: "10:00",
      endTime: "11:00",
      participants: [{ memberId: engineer.membershipId, role: "ATTENDEE" }],
      recurrence: { frequency: "WEEKLY", interval: 1 },
    }),
  );
  const seriesId = meeting.series!.id;
  seriesIds.add(seriesId);
  const tail = (await prisma.meeting.findMany({ where: { seriesId, occurrenceIndex: { gt: 3 } }, select: { id: true } })).map((row) => row.id);
  await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: tail } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: tail } } });
  await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: tail } } });
  await prisma.meeting.deleteMany({ where: { id: { in: tail } } });
  const kept = await occurrences(seriesId);
  await prisma.meetingSeries.update({ where: { id: seriesId }, data: { generatedUntil: kept.at(-1)!.startsAt } });
  return { seriesId, kept, zone };
}

function editInput(meeting: Awaited<ReturnType<typeof getMeeting>>, zone: string, overrides: Record<string, unknown>) {
  return updateMeetingSchema.parse({
    title: meeting.title,
    meetingType: meeting.meetingType,
    visibility: meeting.visibility,
    date: localDate(new Date(meeting.startsAt), zone),
    startTime: localTime(new Date(meeting.startsAt), zone),
    endTime: localTime(new Date(meeting.endsAt), zone),
    projectId: meeting.project?.id ?? null,
    version: meeting.version,
    ...overrides,
  });
}

describe("meetings.series", () => {
  describe("idempotency", () => {
    it("fills a series' window once, however often the job runs (§72, §185)", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      const first = await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      const generated = await occurrences(series.id);
      expect(generated.length).toBeGreaterThanOrEqual(12);
      expect(generated.map((row) => row.occurrenceIndex)).toEqual(generated.map((_, index) => index));
      expect(generated.at(-1)!.startsAt.getTime()).toBeLessThanOrEqual(now.getTime() + SERIES_HORIZON_DAYS * DAY);
      expect(first.processed).toBe(generated.length - 1);

      const second = await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect(second.processed).toBe(0);
      // Due again as far as its row says, and still nothing twice.
      await prisma.meetingSeries.update({ where: { id: series.id }, data: { generatedUntil: series.firstStartsAt } });
      const third = await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect(third.processed).toBe(0);
      expect(await occurrences(series.id)).toHaveLength(generated.length);

      // Each new meeting carries the people, agenda and reminders of the one before.
      const newest = await prisma.meeting.findFirstOrThrow({
        where: { seriesId: series.id },
        orderBy: { occurrenceIndex: "desc" },
        include: { participants: true, agendaItems: true, reminders: true },
      });
      expect(newest.participants.map((row) => row.memberId).sort()).toEqual([ORGANIZER[COMPANY_B], GUEST[COMPANY_B]].sort());
      expect(newest.agendaItems.map((row) => row.title)).toEqual(["Progress"]);
      expect(newest.reminders).toHaveLength(2);
    });

    it("audits a generated batch once, as the job (§13, §149, §182)", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });

      const audit = await creationAudit(series.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_B, actorType: "SYSTEM", actorMemberId: null, actorDisplayNameSnapshot: `System (${JOB})` });
      expect(audit[0].metadataJson).toMatchObject({ seriesId: series.id, occurrences: (await occurrences(series.id)).length - 1, status: "SCHEDULED" });
    });

    it("catches up a missed window from now on, never scheduling a meeting already past (§51, §74)", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() - 30 * DAY) });

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });

      const [first, ...generated] = await occurrences(series.id);
      expect(first.occurrenceIndex).toBe(0);
      expect(generated.length).toBeGreaterThanOrEqual(12);
      expect(generated.every((row) => row.startsAt.getTime() >= now.getTime())).toBe(true);
      // The weeks in between keep their numbers unused.
      expect(generated[0].occurrenceIndex).toBeGreaterThan(1);
    });
  });

  describe("concurrency", () => {
    it("two runs at once generate each occurrence once, and count it once", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      const [left, right] = await Promise.all([invokeJob(JOB, { now, companyIds: [COMPANY_B] }), invokeJob(JOB, { now, companyIds: [COMPANY_B] })]);

      const generated = await occurrences(series.id);
      expect(new Set(generated.map((row) => row.occurrenceIndex)).size).toBe(generated.length);
      expect(left.processed + right.processed).toBe(generated.length - 1);
      expect(await creationAudit(series.id)).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("extends only the companies it runs for, and keeps every row it writes inside the series' company (§180)", async () => {
      const now = new Date();
      const inA = await seriesFixture(COMPANY_A, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });
      const inB = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect(await occurrences(inA.id)).toHaveLength(1);
      expect((await occurrences(inB.id)).length).toBeGreaterThan(1);

      await invokeJob(JOB, { now, companyIds: [COMPANY_A, COMPANY_B] });
      for (const [series, companyId] of [
        [inA, COMPANY_A],
        [inB, COMPANY_B],
      ] as const) {
        const ids = (await occurrences(series.id)).map((row) => row.id);
        expect(ids.length).toBeGreaterThan(1);
        expect(await prisma.meeting.count({ where: { id: { in: ids }, companyId: { not: companyId } } })).toBe(0);
        expect(await prisma.meetingParticipant.count({ where: { meetingId: { in: ids }, companyId: { not: companyId } } })).toBe(0);
        expect(await prisma.meetingAgendaItem.count({ where: { meetingId: { in: ids }, companyId: { not: companyId } } })).toBe(0);
        expect(await prisma.calendarReminder.count({ where: { meetingId: { in: ids }, companyId: { not: companyId } } })).toBe(0);
        expect(await prisma.auditEvent.count({ where: { entityId: { in: ids }, companyId: { not: companyId } } })).toBe(0);
      }
    });
  });

  describe("suspended company", () => {
    it("leaves a suspended company's series alone, and extends it once the company is active (§145, §181)", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { now, companyIds: [COMPANY_B] }));
      expect(await occurrences(series.id)).toHaveLength(1);
      expect((await seriesRow(series.id)).generatedUntil).toEqual(series.generatedUntil);

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect((await occurrences(series.id)).length).toBeGreaterThan(1);
    });
  });

  describe("meetings module switched off", () => {
    it("generates nothing for a company that does not use meetings", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      await withModule(COMPANY_B, "meetings", false, () => invokeJob(JOB, { now, companyIds: [COMPANY_B] }));

      expect(await occurrences(series.id)).toHaveLength(1);
    });
  });

  describe("failure", () => {
    it("passes over a series whose rule no longer parses, extends the ones after it, and fails the run (§30-§36)", async () => {
      const now = new Date();
      const broken = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR), rule: "FREQ=HOURLY;INTERVAL=1" });
      const healthy = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      await expect(invokeJob(JOB, { now, companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await occurrences(broken.id)).toHaveLength(1);
      expect((await seriesRow(broken.id)).generatedUntil).toEqual(broken.generatedUntil);
      expect((await occurrences(healthy.id)).length).toBeGreaterThan(1);
    });

    it("walks past a whole batch of failing series to the ones behind it (§135, §143)", async () => {
      const now = new Date();
      for (let index = 0; index < 3; index += 1) {
        await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR), rule: "FREQ=HOURLY;INTERVAL=1" });
      }
      const behind = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });

      expect(SERIES_BATCH).toBeGreaterThan(2);
      await expect(runInBatches(now, COMPANY_B, 2)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect((await occurrences(behind.id)).length).toBeGreaterThan(1);
    });

    it("rolls a series back whole when one of its writes fails, and extends it on the next run", async () => {
      const now = new Date();
      const failing = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });
      const other = await seriesFixture(COMPANY_B, { firstStartsAt: new Date(now.getTime() + 2 * HOUR) });
      // The first series in the walk is the older one; its reminders cannot be copied.
      vi.spyOn(calendar, "copyMeetingReminders").mockRejectedValueOnce(new Error("reminder write failed"));

      await expect(invokeJob(JOB, { now, companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await occurrences(failing.id)).toHaveLength(1);
      expect((await seriesRow(failing.id)).generatedUntil).toEqual(failing.generatedUntil);
      expect(await creationAudit(failing.id)).toHaveLength(0);
      expect((await occurrences(other.id)).length).toBeGreaterThan(1);

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect((await occurrences(failing.id)).length).toBe((await occurrences(other.id)).length);
    });
  });

  describe("organizer no longer active", () => {
    it("does not move the series on as if it had been filled, and says so", async () => {
      const now = new Date();
      const series = await seriesFixture(COMPANY_A, { firstStartsAt: new Date(now.getTime() + 2 * HOUR), organizerMemberId: "member_membership_inactive" });

      const result = await invokeJob(JOB, { now, companyIds: [COMPANY_A] });

      expect(await occurrences(series.id)).toHaveLength(1);
      expect((await seriesRow(series.id)).generatedUntil).toEqual(series.generatedUntil);
      expect(result.detail).toMatchObject({ stalled: expect.any(Number) });
      expect((result.detail as { stalled: number }).stalled).toBeGreaterThanOrEqual(1);
    });
  });

  describe("edit and cancel", () => {
    it("does not bring back the meetings a 'this and later' cancel stopped (§277)", async () => {
      const [pm, engineer] = [await loginAs("PROJECT_MANAGER"), await loginAs("ENGINEER")];
      const { seriesId, kept } = await servicedSeries(pm, engineer);

      await cancelMeeting(pm, kept[2].id, { reason: null, scope: "FUTURE" });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const rows = await occurrences(seriesId);
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => row.status)).toEqual(["SCHEDULED", "SCHEDULED", "CANCELLED", "CANCELLED"]);
    });

    it("generates later meetings at the time a 'this and later' edit set, each once (§75, §277)", async () => {
      const [pm, engineer] = [await loginAs("PROJECT_MANAGER"), await loginAs("ENGINEER")];
      const { seriesId, kept, zone } = await servicedSeries(pm, engineer);

      const second = await getMeeting(pm, kept[1].id);
      await updateMeeting(pm, second.id, editInput(second, zone, { startTime: "15:00", endTime: "15:45", scope: "FUTURE" }));
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const rows = await occurrences(seriesId);
      expect(rows.length).toBeGreaterThan(4);
      expect(new Set(rows.map((row) => row.occurrenceIndex)).size).toBe(rows.length);
      expect(rows.map((row) => localTime(row.startsAt, zone))).toEqual(["10:00", ...rows.slice(1).map(() => "15:00")]);
      expect(rows.slice(1).every((row) => row.endsAt.getTime() - row.startsAt.getTime() === 45 * 60_000)).toBe(true);
    });

    it("never leaves a meeting scheduled after a 'this and later' cancel that raced the job (§148, §277)", async () => {
      const [pm, engineer] = [await loginAs("PROJECT_MANAGER"), await loginAs("ENGINEER")];
      const { seriesId, kept } = await servicedSeries(pm, engineer);

      await Promise.all([cancelMeeting(pm, kept[2].id, { reason: null, scope: "FUTURE" }), invokeJob(JOB, { companyIds: [COMPANY_A] })]);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const later = (await occurrences(seriesId)).filter((row) => row.occurrenceIndex! >= 2);
      expect(later.length).toBeGreaterThanOrEqual(2);
      expect(later.filter((row) => row.status !== "CANCELLED")).toEqual([]);
      expect((await seriesRow(seriesId)).cancelledAt).not.toBeNull();
    });
  });

  describe("daylight saving", () => {
    it("keeps a weekly 09:00 series at 09:00 local time across the clock change (§50, §277)", async () => {
      const zone = "Europe/Berlin";
      const change = nextClockChange(zone);
      const firstStartsAt = instantFromLocal(addLocalDays(change, -14), "09:00", zone);
      const series = await seriesFixture(COMPANY_B, { firstStartsAt, timezone: zone });

      await invokeJob(JOB, { now: new Date(firstStartsAt.getTime() - HOUR), companyIds: [COMPANY_B] });

      const rows = await occurrences(series.id);
      const before = rows.filter((row) => localDate(row.startsAt, zone) < change);
      const after = rows.filter((row) => localDate(row.startsAt, zone) >= change);
      expect(before.length).toBeGreaterThanOrEqual(2);
      expect(after.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((row) => localTime(row.startsAt, zone) === "09:00")).toBe(true);
      expect(after[0].startsAt.getUTCHours()).not.toBe(before[0].startsAt.getUTCHours());
    });
  });
});
