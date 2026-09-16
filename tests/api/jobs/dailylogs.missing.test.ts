import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger } from "@/lib/core/observability/logger";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { isoWeekday } from "@/lib/modules/daily-logs/daily-log.time";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

vi.mock("@/lib/core/notifications/notification.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/notifications/notification.service")>();
  return { ...actual, enqueueNotificationEvent: vi.fn(actual.enqueueNotificationEvent) };
});

/**
 * Job `dailylogs.missing` (PRD #51 §89, §90, §173-§181, §191): a project that
 * requires logs and has none for its last working day is reminded about once
 * for that day — every such project, however many a company has — and no log
 * is ever made up for it.
 */

const JOB = "dailylogs.missing";
const EVENTS = ["DAILY_LOG_MISSING_REMINDER"];
const RUN = `t51dl${Date.now().toString(36)}`;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const MANAGER: Record<string, string> = { [COMPANY_A]: "member_owner", [COMPANY_B]: "member_owner_b" };
const SITE_MEMBER: Record<string, string> = { [COMPANY_A]: "member_engineer", [COMPANY_B]: "member_viewer_b" };

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
const zones = new Map<string, string>();
const projects: string[] = [];
let serial = 0;
let restoreTrail: () => Promise<void>;

function day(companyId: string, offset: number): string {
  return addLocalDays(localDate(new Date(), zones.get(companyId)!), offset);
}

function projectData(companyId: string) {
  serial += 1;
  const id = `${RUN}_p${String(serial).padStart(4, "0")}`;
  projects.push(id);
  return { id, companyId, code: id, name: `Contract test ${id}`, status: "ACTIVE" as const, projectManagerMemberId: MANAGER[companyId], createdBy: "test" };
}

/** An active project with its own daily log rules and one site member. */
async function project(companyId: string, rules: { logsRequired?: boolean; workingDays?: number[] } = {}): Promise<string> {
  const data = projectData(companyId);
  await prisma.project.create({ data });
  await prisma.projectDailyLogSettings.create({ data: { companyId, projectId: data.id, logsRequired: rules.logsRequired ?? true, workingDays: rules.workingDays ?? EVERY_DAY } });
  await prisma.projectMember.create({ data: { companyId, projectId: data.id, companyMemberId: SITE_MEMBER[companyId] } });
  return data.id;
}

/** Runs `first` inside the job's transaction, just before the reminder about `entityId` is enqueued. */
function beforeNoticeAbout(entityId: string, first: () => Promise<void>) {
  enqueue.mockImplementation(async (tx, input) => {
    if (input.entityId === entityId) await first();
    return realEnqueue(tx, input);
  });
}

/**
 * Starts a second run of the job at the moment the first, inside its
 * transaction, is about to enqueue the notice about `entityId` — its claim
 * written and not yet committed — and holds the first there long enough for
 * the second to reach the same record. Returns a wait for the second run.
 */
function overlapWhileNoticeAbout(entityId: string): () => Promise<unknown> {
  let second: Promise<unknown> | undefined;
  beforeNoticeAbout(entityId, async () => {
    if (second) return;
    second = invokeJob(JOB, { companyIds: [COMPANY_A] });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  return async () => second;
}

const events = (projectId: string) => prisma.notificationEventOutbox.findMany({ where: { entityType: "project", entityId: projectId, eventType: "DAILY_LOG_MISSING_REMINDER" }, orderBy: { createdAt: "asc" } });
const workDates = async (projectId: string) => (await events(projectId)).map((event) => (event.payloadJson as { workDate: string }).workDate);
const claimed = (projectId: string) => prisma.jobIdempotencyKey.findMany({ where: { jobKey: JOB, key: { startsWith: `${projectId}:` } }, select: { companyId: true, key: true } });

beforeAll(async () => {
  realEnqueue = enqueue.getMockImplementation()!;
  for (const companyId of [COMPANY_A, COMPANY_B]) {
    zones.set(companyId, (await prisma.companySettings.findUniqueOrThrow({ where: { companyId }, select: { timezone: true } })).timezone);
  }
});

beforeEach(async () => {
  restoreTrail = await rememberTrail(JOB, EVENTS);
});

afterEach(async () => {
  vi.restoreAllMocks();
  enqueue.mockImplementation(realEnqueue);
  await restoreTrail();
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: projects } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { startsWith: RUN } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: { in: projects } } });
  await prisma.project.deleteMany({ where: { id: { in: projects } } });
  projects.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("dailylogs.missing", () => {
  describe("idempotency", () => {
    it("reminds a required project's people once about its last working day, however often it runs, and makes up no log (§90, §191)", async () => {
      const id = await project(COMPANY_A);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const sent = await events(id);
      expect(sent).toHaveLength(1);
      expect(sent[0].payloadJson).toMatchObject({ workDate: day(COMPANY_A, -1) });
      expect((sent[0].payloadJson as { memberIds: string[] }).memberIds.sort()).toEqual([MANAGER[COMPANY_A], SITE_MEMBER[COMPANY_A]].sort());
      expect(await claimed(id)).toEqual([{ companyId: COMPANY_A, key: `${id}:${day(COMPANY_A, -1)}` }]);
      expect(first.processed).toBeGreaterThanOrEqual(1);
      expect(second.processed).toBe(0);
      expect(await prisma.dailyLog.count({ where: { projectId: id } })).toBe(0);
    });

    it("keeps to each project's own working days and requirement", async () => {
      const yesterday = isoWeekday(day(COMPANY_A, -1));
      const offYesterday = await project(COMPANY_A, { workingDays: EVERY_DAY.filter((weekday) => weekday !== yesterday) });
      const notRequired = await project(COMPANY_A, { logsRequired: false });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await workDates(offYesterday)).toEqual([day(COMPANY_A, -2)]);
      expect(await events(notRequired)).toHaveLength(0);
    });

    it("sends one reminder when a second run reaches the project while the first is still sending it (§18)", async () => {
      const id = await project(COMPANY_A);
      const second = overlapWhileNoticeAbout(id);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await events(id)).toHaveLength(1);
    });

    it("reaches every required project in a company, past any one batch (§133-§138)", async () => {
      const data = Array.from({ length: 130 }, () => projectData(COMPANY_B));
      await prisma.project.createMany({ data });
      await prisma.projectDailyLogSettings.createMany({ data: data.map((row) => ({ companyId: COMPANY_B, projectId: row.id, logsRequired: true, workingDays: EVERY_DAY })) });

      await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(await prisma.notificationEventOutbox.count({ where: { eventType: "DAILY_LOG_MISSING_REMINDER", entityId: { in: data.map((row) => row.id) } } })).toBe(130);
    });
  });

  describe("company isolation", () => {
    it("runs one company without touching another, and reminds each company's people only about their own projects (§180)", async () => {
      const inA = await project(COMPANY_A);
      const inB = await project(COMPANY_B);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(inA)).toHaveLength(1);
      expect(await events(inB)).toHaveLength(0);
      expect(await claimed(inB)).toEqual([]);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      const [eventA] = await events(inA);
      const [eventB] = await events(inB);
      expect(eventA).toMatchObject({ companyId: COMPANY_A, projectId: inA });
      expect(eventB).toMatchObject({ companyId: COMPANY_B, projectId: inB });
      expect((eventB.payloadJson as { memberIds: string[] }).memberIds.sort()).toEqual([MANAGER[COMPANY_B], SITE_MEMBER[COMPANY_B]].sort());
      // Each company's own calendar decides which day was missed.
      expect(await claimed(inB)).toEqual([{ companyId: COMPANY_B, key: `${inB}:${day(COMPANY_B, -1)}` }]);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company while the others run, and catches up once it is active again (§145, §181)", async () => {
      const inA = await project(COMPANY_A);
      const inB = await project(COMPANY_B);

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB));
      expect(await events(inA)).toHaveLength(1);
      expect(await events(inB)).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(inB)).toHaveLength(1);
    });

    it("skips a company that has switched daily logs off (§26)", async () => {
      const inB = await project(COMPANY_B);

      await withModule(COMPANY_B, "dailyLogs", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));

      expect(await events(inB)).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("reminds every other project when one fails, leaves the failed one unclaimed, fails the run, and reminds it next time (§30-§36)", async () => {
      const failing = await project(COMPANY_B);
      const after = await project(COMPANY_B);
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });
      const errors = vi.spyOn(logger, "error");

      await expect(invokeJob(JOB, { companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await events(after)).toHaveLength(1);
      expect(await events(failing)).toHaveLength(0);
      expect(await claimed(failing)).toEqual([]);
      expect(errors).toHaveBeenCalledWith(`${JOB}.item_failed`, expect.objectContaining({ companyId: COMPANY_B, projectId: failing, workDate: day(COMPANY_B, -1) }));

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(failing)).toHaveLength(1);
      expect(await events(after)).toHaveLength(1);
    });
  });
});
