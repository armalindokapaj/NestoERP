import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as notifications from "@/lib/core/notifications/notification.service";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { submissionDeadline } from "@/lib/modules/timesheets/timesheet.deadline";
import * as timesheetSettings from "@/lib/modules/timesheets/timesheet.settings";
import { businessInstant, weekStartOf } from "@/lib/modules/timesheets/timesheet.time";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `timesheets.reminders` (PRD #51 §10, §15-§19, §86-§88, §145, §190).
 *
 * The companies are given a Friday 17:00 deadline and the job a clock an hour
 * past last week's, so last week is the one being reminded. The weeks the job
 * creates, the reminders and claims it writes, and the settings changed here
 * are all put back after each test; seeded weeks are only read.
 */

const JOB = "timesheets.reminders";
const HOUR = 3_600_000;
const DEADLINE = { submitDay: 5, submitTime: "17:00" };
const week = addLocalDays(weekStartOf(localDate(new Date(), "Europe/Tirane"), 1), -7);
const periodStart = businessInstant(week);
const deadline = submissionDeadline(week, { ...DEADLINE, timezone: "Europe/Tirane" })!;
const hourAfterDeadline = new Date(deadline.instant.getTime() + HOUR);

let settingsBefore: Array<{ companyId: string; submitDay: number | null; submitTime: string | null }> = [];
let existingWeeks = new Set<string>();
let suspendedHadCompanySettings = false;

async function withDeadline(...companyIds: string[]) {
  for (const companyId of companyIds) {
    await prisma.timesheetSettings.upsert({ where: { companyId }, update: DEADLINE, create: { companyId, ...DEADLINE } });
  }
}

const weekOf = (companyId: string, memberId: string) => prisma.timesheet.findUnique({ where: { companyId_memberId_periodStart: { companyId, memberId, periodStart } }, select: { id: true, companyId: true } });

async function remindersFor(companyId: string, memberId: string) {
  const row = await weekOf(companyId, memberId);
  if (!row) return [];
  return prisma.notificationEventOutbox.findMany({ where: { eventType: "TIMESHEET_REMINDER", entityType: "timesheet", entityId: row.id }, select: { companyId: true, entityId: true } });
}

const claimed = (companyId: string, memberId: string) => prisma.jobIdempotencyKey.count({ where: { companyId, jobKey: JOB, key: `${memberId}:${week}` } });

beforeAll(async () => {
  settingsBefore = await prisma.timesheetSettings.findMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B, COMPANY_SUSPENDED] } }, select: { companyId: true, submitDay: true, submitTime: true } });
  existingWeeks = new Set((await prisma.timesheet.findMany({ where: { periodStart }, select: { id: true } })).map((row) => row.id));
  suspendedHadCompanySettings = (await prisma.companySettings.count({ where: { companyId: COMPANY_SUSPENDED } })) > 0;
});

afterEach(async () => {
  vi.restoreAllMocks();
  const weeks = (await prisma.timesheet.findMany({ where: { periodStart, workLogs: { none: {} } }, select: { id: true } })).map((row) => row.id).filter((id) => !existingWeeks.has(id));
  await prisma.attentionItem.deleteMany({ where: { entityType: "timesheet", entityId: { in: weeks } } });
  await prisma.notification.deleteMany({ where: { entityType: "timesheet", entityId: { in: weeks } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "timesheet", entityId: { in: weeks } } });
  await prisma.timesheet.deleteMany({ where: { id: { in: weeks } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { endsWith: `:${week}` } } });
  for (const companyId of [COMPANY_A, COMPANY_B, COMPANY_SUSPENDED]) {
    const before = settingsBefore.find((row) => row.companyId === companyId);
    if (before) await prisma.timesheetSettings.update({ where: { companyId }, data: { submitDay: before.submitDay, submitTime: before.submitTime } });
    else await prisma.timesheetSettings.deleteMany({ where: { companyId } });
  }
  if (!suspendedHadCompanySettings) await prisma.companySettings.deleteMany({ where: { companyId: COMPANY_SUSPENDED } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("timesheets.reminders", () => {
  describe("idempotency", () => {
    it("reminds each member once for the week, however many hourly runs fall in the window (§190)", async () => {
      await withDeadline(COMPANY_A);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(hourAfterDeadline.getTime() + HOUR) });
      const third = await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(hourAfterDeadline.getTime() + 2 * HOUR) });

      expect(first.processed).toBeGreaterThan(0);
      expect([second.processed, third.processed]).toEqual([0, 0]);
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(1);
      expect(await claimed(COMPANY_A, "member_hse")).toBe(1);
      const weeks = await prisma.timesheet.findMany({ where: { companyId: COMPANY_A, periodStart }, select: { id: true } });
      const reminders = await prisma.notificationEventOutbox.count({ where: { eventType: "TIMESHEET_REMINDER", entityId: { in: weeks.map((row) => row.id) } } });
      expect(reminders).toBe(first.processed);
    });

    it("does not remind again once the first reminder has left the outbox", async () => {
      await withDeadline(COMPANY_A);
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline });
      const hseWeek = (await weekOf(COMPANY_A, "member_hse"))!;
      await prisma.notificationEventOutbox.deleteMany({ where: { eventType: "TIMESHEET_REMINDER", entityId: hseWeek.id } });

      const again = await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(hourAfterDeadline.getTime() + HOUR) });

      expect(again.processed).toBe(0);
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("two runs at once remind each member once", async () => {
      await withDeadline(COMPANY_A);

      const results = await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline }), invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline })]);

      const weeks = await prisma.timesheet.findMany({ where: { companyId: COMPANY_A, periodStart }, select: { id: true } });
      const perWeek = await prisma.notificationEventOutbox.groupBy({ by: ["entityId"], where: { eventType: "TIMESHEET_REMINDER", entityId: { in: weeks.map((row) => row.id) } }, _count: { _all: true } });
      expect(perWeek.length).toBeGreaterThan(0);
      expect(perWeek.every((row) => row._count._all === 1)).toBe(true);
      expect(results[0].processed + results[1].processed).toBe(perWeek.length);
    });
  });

  describe("company isolation", () => {
    it("a run for company A creates and reminds only A's weeks, and B's carry B's id", async () => {
      await withDeadline(COMPANY_A, COMPANY_B);

      await invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline });
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(1);
      expect(await prisma.timesheet.count({ where: { companyId: COMPANY_B, periodStart } })).toBe(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B], now: hourAfterDeadline });
      const ownerB = (await weekOf(COMPANY_B, "member_owner_b"))!;
      expect(ownerB.companyId).toBe(COMPANY_B);
      expect(await remindersFor(COMPANY_B, "member_owner_b")).toEqual([{ companyId: COMPANY_B, entityId: ownerB.id }]);
      expect(await claimed(COMPANY_B, "member_owner_b")).toBe(1);
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(1);
    });
  });

  describe("suspended company", () => {
    it("creates and reminds nothing in a suspended company, and reminds its members once it is active again", async () => {
      await withDeadline(COMPANY_SUSPENDED);

      const skipped = await withCompanyStatus(COMPANY_SUSPENDED, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED], now: hourAfterDeadline }));
      expect(skipped).toMatchObject({ processed: 0, detail: { companies: 0 } });
      expect(await weekOf(COMPANY_SUSPENDED, "member_suspended_company")).toBeNull();

      const active = await withCompanyStatus(COMPANY_SUSPENDED, "ACTIVE", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED], now: hourAfterDeadline }));
      expect(active.processed).toBe(1);
      expect(await remindersFor(COMPANY_SUSPENDED, "member_suspended_company")).toHaveLength(1);
    });
  });

  describe("failure", () => {
    it("reminds the other members when one member's reminder fails, claims nothing for that member, and fails the run", async () => {
      await withDeadline(COMPANY_A);
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.payload.memberId === "member_hse") throw new Error("contract test: outbox unavailable for this member");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A], now: hourAfterDeadline })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await remindersFor(COMPANY_A, "member_pm")).toHaveLength(1);
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(0);
      expect(await claimed(COMPANY_A, "member_hse")).toBe(0);

      vi.restoreAllMocks();
      const retried = await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(hourAfterDeadline.getTime() + HOUR) });
      expect(retried.processed).toBe(1);
      expect(await remindersFor(COMPANY_A, "member_hse")).toHaveLength(1);
      expect(await remindersFor(COMPANY_A, "member_pm")).toHaveLength(1);
    });

    it("still reminds the companies after one whose run throws", async () => {
      await withDeadline(COMPANY_A, COMPANY_B);
      const resolve = timesheetSettings.resolveTimesheetSettings;
      vi.spyOn(timesheetSettings, "resolveTimesheetSettings").mockImplementation(async (companyId) => {
        if (companyId === COMPANY_A) throw new Error("contract test: company A's settings cannot be read");
        return resolve(companyId);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B], now: hourAfterDeadline })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await remindersFor(COMPANY_B, "member_owner_b")).toHaveLength(1);
      expect(await weekOf(COMPANY_A, "member_hse")).toBeNull();
    });
  });
});
