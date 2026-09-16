import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { runWithinJob } from "@/lib/core/jobs/job.context";
import * as notifications from "@/lib/core/notifications/notification.service";
import { REMINDER_BATCH, runCalendarReminders } from "@/lib/modules/calendar/calendar.reminders";
import { addLocalDays, instantFromLocal, localDate, localTime } from "@/lib/modules/calendar/calendar.time";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";

/**
 * `calendar.reminders` — the job's contract (PRD #51 §173-§183, §277; PRD #39 §109-§111; PRD #40 §74).
 *
 * Fixtures are written straight to the tables: the job reads rows, and what it
 * promises about them should not hang on the event form's validation. Every
 * run is given its `now`, so whether a reminder is due never depends on how
 * long the test took.
 */

const JOB = "calendar.reminders";
const TAG = `JOBCAL-${process.pid}-${Date.now().toString(36)}`;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MEMBER: Record<string, string> = { [COMPANY_A]: "member_engineer", [COMPANY_B]: "member_owner_b" };

const events = new Set<string>();
const meetings = new Set<string>();
let counter = 0;

afterEach(async () => {
  vi.restoreAllMocks();
  const reminders = await prisma.calendarReminder.findMany({
    where: { OR: [{ eventId: { in: [...events] } }, { meetingId: { in: [...meetings] } }] },
    select: { id: true },
  });
  await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await prisma.calendarReminder.deleteMany({ where: { id: { in: reminders.map((row) => row.id) } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: [...events, ...meetings] } } });
  await prisma.calendarEvent.deleteMany({ where: { id: { in: [...events] } } });
  await prisma.meeting.deleteMany({ where: { id: { in: [...meetings] } } });
  events.clear();
  meetings.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

type ReminderInput = { startsAt: Date; minutesBefore: number; recurrenceRule?: string; timezone?: string; memberId?: string; eventCompanyId?: string };

async function eventReminder(companyId: string, input: ReminderInput) {
  counter += 1;
  const eventCompanyId = input.eventCompanyId ?? companyId;
  const event = await prisma.calendarEvent.create({
    data: {
      companyId: eventCompanyId,
      createdByMemberId: MEMBER[eventCompanyId],
      title: `${TAG} event ${counter}`,
      eventType: "PERSONAL_EVENT",
      visibility: "PRIVATE",
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 30 * MINUTE),
      timezone: input.timezone ?? "Europe/Tirane",
      recurrenceRule: input.recurrenceRule ?? null,
    },
  });
  events.add(event.id);
  const reminder = await prisma.calendarReminder.create({
    data: { companyId, eventId: event.id, memberId: input.memberId ?? MEMBER[companyId], minutesBefore: input.minutesBefore },
  });
  return { event, reminder };
}

async function meetingReminder(companyId: string, input: ReminderInput) {
  counter += 1;
  const memberId = MEMBER[companyId];
  const meeting = await prisma.meeting.create({
    data: {
      companyId,
      createdByMemberId: memberId,
      organizerMemberId: memberId,
      title: `${TAG} meeting ${counter}`,
      meetingType: "INTERNAL",
      status: "SCHEDULED",
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 30 * MINUTE),
      timezone: input.timezone ?? "Europe/Tirane",
      visibility: "PARTICIPANTS",
    },
  });
  meetings.add(meeting.id);
  const reminder = await prisma.calendarReminder.create({ data: { companyId, meetingId: meeting.id, memberId, minutesBefore: input.minutesBefore } });
  return { meeting, reminder };
}

/** Starts in twenty minutes with a half-hour reminder: due ten minutes before `now`. */
const dueAt = (now: Date): ReminderInput => ({ startsAt: new Date(now.getTime() + 20 * MINUTE), minutesBefore: 30 });
/** A series of a week ago whose stored rule the parser refuses. */
const unparseable = (now: Date): ReminderInput => ({ ...dueAt(new Date(now.getTime() - 7 * DAY)), recurrenceRule: "FREQ=HOURLY;INTERVAL=1" });

const deliveries = (reminderId: string) => prisma.calendarReminderDelivery.findMany({ where: { reminderId } });
const outbox = (entityId: string) => prisma.notificationEventOutbox.findMany({ where: { entityId } });

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

/** Runs the job's function inside a job run for one company, with a batch size a test can overflow. */
function runInBatches(now: Date, companyId: string, batchSize: number) {
  return runWithinJob(
    { jobKey: JOB, runId: TAG, correlationId: TAG, workerId: TAG, signal: new AbortController().signal, companyIds: [companyId], dryRun: false },
    () => runCalendarReminders(now, { batchSize }),
  );
}

describe("calendar.reminders", () => {
  describe("idempotency", () => {
    it("sends a due event reminder and a due meeting reminder once, however often the job runs (§18, §183)", async () => {
      const now = new Date();
      const event = await eventReminder(COMPANY_A, dueAt(now));
      const meeting = await meetingReminder(COMPANY_A, dueAt(now));

      const first = await invokeJob(JOB, { now, companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { now, companyIds: [COMPANY_A] });

      expect(first.processed).toBeGreaterThanOrEqual(2);
      expect(second.processed).toBe(0);
      expect(await deliveries(event.reminder.id)).toHaveLength(1);
      expect((await outbox(event.event.id)).map((row) => row.eventType)).toEqual(["CALENDAR_REMINDER"]);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(1);
      expect((await outbox(meeting.meeting.id)).map((row) => row.eventType)).toEqual(["MEETING_REMINDER"]);
    });

    it("sends each occurrence of a repeating event once, and next week's occurrence again", async () => {
      const zone = "Europe/Tirane";
      const now = new Date();
      // Weekly in local time, from the same weekday and minute two weeks ago.
      const soon = new Date(now.getTime() + 20 * MINUTE);
      const [day, clock] = [localDate(soon, zone), localTime(soon, zone)];
      const thisWeek = instantFromLocal(day, clock, zone);
      const nextWeek = instantFromLocal(addLocalDays(day, 7), clock, zone);
      const { event, reminder } = await eventReminder(COMPANY_B, {
        startsAt: instantFromLocal(addLocalDays(day, -14), clock, zone),
        minutesBefore: 30,
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
        timezone: zone,
      });

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect((await deliveries(reminder.id)).map((row) => row.occurrenceStartsAt.toISOString())).toEqual([thisWeek.toISOString()]);

      const nextRun = new Date(nextWeek.getTime() - 15 * MINUTE);
      await invokeJob(JOB, { now: nextRun, companyIds: [COMPANY_B] });
      await invokeJob(JOB, { now: nextRun, companyIds: [COMPANY_B] });
      const sent = (await deliveries(reminder.id)).map((row) => row.occurrenceStartsAt.toISOString()).sort();
      expect(sent).toEqual([thisWeek.toISOString(), nextWeek.toISOString()]);
      expect(await outbox(event.id)).toHaveLength(2);
    });

    it("walks every due reminder however many there are, a batch at a time (§133-§135)", async () => {
      const now = new Date();
      const due = [];
      for (let index = 0; index < 5; index += 1) due.push(await eventReminder(COMPANY_B, dueAt(now)));

      const result = await runInBatches(now, COMPANY_B, 2);

      expect(REMINDER_BATCH).toBeGreaterThan(2);
      expect(result.fired).toBeGreaterThanOrEqual(5);
      for (const { reminder } of due) expect(await deliveries(reminder.id)).toHaveLength(1);
    });
  });

  describe("concurrency", () => {
    it("two runs at once send one reminder per occurrence, and between them count each once (§175)", async () => {
      const now = new Date();
      const event = await eventReminder(COMPANY_A, dueAt(now));
      const meeting = await meetingReminder(COMPANY_A, dueAt(now));
      const before = new Set((await prisma.calendarReminderDelivery.findMany({ where: { companyId: COMPANY_A }, select: { id: true } })).map((row) => row.id));

      const [left, right] = await Promise.all([invokeJob(JOB, { now, companyIds: [COMPANY_A] }), invokeJob(JOB, { now, companyIds: [COMPANY_A] })]);

      expect(await deliveries(event.reminder.id)).toHaveLength(1);
      expect(await outbox(event.event.id)).toHaveLength(1);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(1);
      expect(await outbox(meeting.meeting.id)).toHaveLength(1);
      const created = (await prisma.calendarReminderDelivery.findMany({ where: { companyId: COMPANY_A }, select: { id: true } })).filter((row) => !before.has(row.id));
      expect(left.processed + right.processed).toBe(created.length);
    });
  });

  describe("company isolation", () => {
    it("reminds only the companies it runs for, and writes each reminder into its own company (§180)", async () => {
      const now = new Date();
      const a = await eventReminder(COMPANY_A, dueAt(now));
      const b = await eventReminder(COMPANY_B, dueAt(now));
      const bMeeting = await meetingReminder(COMPANY_B, dueAt(now));

      await invokeJob(JOB, { now, companyIds: [COMPANY_A] });
      expect(await deliveries(a.reminder.id)).toHaveLength(1);
      expect(await deliveries(b.reminder.id)).toHaveLength(0);
      expect(await deliveries(bMeeting.reminder.id)).toHaveLength(0);
      expect(await outbox(b.event.id)).toHaveLength(0);

      await invokeJob(JOB, { now, companyIds: [COMPANY_A, COMPANY_B] });
      for (const [fixture, companyId, entityId] of [
        [a.reminder, COMPANY_A, a.event.id],
        [b.reminder, COMPANY_B, b.event.id],
        [bMeeting.reminder, COMPANY_B, bMeeting.meeting.id],
      ] as const) {
        expect((await deliveries(fixture.id)).map((row) => row.companyId)).toEqual([companyId]);
        const [event] = await outbox(entityId);
        expect(event.companyId).toBe(companyId);
        expect(event.payloadJson).toMatchObject({ memberId: MEMBER[companyId], reminderId: fixture.id });
      }
    });

    it("never sends a company's reminder about another company's event", async () => {
      const now = new Date();
      const crossed = await eventReminder(COMPANY_A, { ...dueAt(now), eventCompanyId: COMPANY_B });

      await invokeJob(JOB, { now, companyIds: [COMPANY_A, COMPANY_B] });

      expect(await deliveries(crossed.reminder.id)).toHaveLength(0);
      expect(await outbox(crossed.event.id)).toHaveLength(0);
    });
  });

  describe("suspended company", () => {
    it("reminds nobody in a suspended company, and does once it is active again (§145, §181)", async () => {
      const now = new Date();
      const event = await eventReminder(COMPANY_B, dueAt(now));
      const meeting = await meetingReminder(COMPANY_B, dueAt(now));

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { now, companyIds: [COMPANY_B] }));
      expect(await deliveries(event.reminder.id)).toHaveLength(0);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(0);
      expect(await outbox(event.event.id)).toHaveLength(0);

      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect(await deliveries(event.reminder.id)).toHaveLength(1);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(1);
    });
  });

  describe("meetings module switched off", () => {
    it("still sends event reminders, and no meeting reminders", async () => {
      const now = new Date();
      const event = await eventReminder(COMPANY_B, dueAt(now));
      const meeting = await meetingReminder(COMPANY_B, dueAt(now));

      await withModule(COMPANY_B, "meetings", false, () => invokeJob(JOB, { now, companyIds: [COMPANY_B] }));

      expect(await deliveries(event.reminder.id)).toHaveLength(1);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(0);
      expect(await outbox(meeting.meeting.id)).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("passes over a reminder whose stored rule no longer parses, sends the ones after it, and fails the run (§30-§36)", async () => {
      const now = new Date();
      const broken = await eventReminder(COMPANY_B, unparseable(now));
      const event = await eventReminder(COMPANY_B, dueAt(now));
      const meeting = await meetingReminder(COMPANY_B, dueAt(now));

      await expect(invokeJob(JOB, { now, companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await deliveries(broken.reminder.id)).toHaveLength(0);
      expect(await deliveries(event.reminder.id)).toHaveLength(1);
      expect(await deliveries(meeting.reminder.id)).toHaveLength(1);
    });

    it("walks past a whole batch of failing reminders to the ones behind it (§135, §143)", async () => {
      const now = new Date();
      for (let index = 0; index < 3; index += 1) await eventReminder(COMPANY_B, unparseable(now));
      const behind = await eventReminder(COMPANY_B, dueAt(now));

      await expect(runInBatches(now, COMPANY_B, 2)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await deliveries(behind.reminder.id)).toHaveLength(1);
    });

    it("leaves no delivery behind when its notification cannot be written, so the next run sends it", async () => {
      const now = new Date();
      const failing = await eventReminder(COMPANY_B, dueAt(now));
      const other = await eventReminder(COMPANY_B, dueAt(now));
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.payload.reminderId === failing.reminder.id) throw new Error("outbox write failed");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { now, companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await deliveries(failing.reminder.id)).toHaveLength(0);
      expect(await outbox(failing.event.id)).toHaveLength(0);
      expect(await deliveries(other.reminder.id)).toHaveLength(1);

      vi.restoreAllMocks();
      await invokeJob(JOB, { now, companyIds: [COMPANY_B] });
      expect(await deliveries(failing.reminder.id)).toHaveLength(1);
      expect(await outbox(failing.event.id)).toHaveLength(1);
    });
  });

  describe("daylight saving", () => {
    it("reminds about a weekly 09:00 event at 09:00 local time after the clocks change (§50, §277)", async () => {
      const zone = "Europe/Berlin";
      const change = nextClockChange(zone);
      const firstStart = instantFromLocal(addLocalDays(change, -14), "09:00", zone);
      const afterChange = instantFromLocal(change, "09:00", zone);
      // The clocks really do move between the two: two weeks is not 336 hours here.
      expect(afterChange.getTime() - firstStart.getTime()).not.toBe(14 * DAY);

      const { reminder } = await eventReminder(COMPANY_B, { startsAt: firstStart, minutesBefore: 10, recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", timezone: zone });
      await invokeJob(JOB, { now: new Date(afterChange.getTime() - 8 * MINUTE), companyIds: [COMPANY_B] });

      expect((await deliveries(reminder.id)).map((row) => row.occurrenceStartsAt.toISOString())).toEqual([afterChange.toISOString()]);
    });
  });
});
