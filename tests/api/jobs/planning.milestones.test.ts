import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger } from "@/lib/core/observability/logger";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

vi.mock("@/lib/core/notifications/notification.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/notifications/notification.service")>();
  return { ...actual, enqueueNotificationEvent: vi.fn(actual.enqueueNotificationEvent) };
});

/**
 * Job `planning.milestones` (PRD #51 §91, §92, §173-§181, §192): a milestone
 * is reminded about once before and once after its target date — whichever of
 * forecast, planned or baseline sets it — for every milestone a company has,
 * and nothing about the milestone itself changes.
 */

const JOB = "planning.milestones";
const EVENTS = ["MILESTONE_DUE_SOON", "MILESTONE_OVERDUE"];
const RUN = `t51pm${Date.now().toString(36)}`;
/** An active project in each company, with a manager. */
const SITE: Record<string, string> = { [COMPANY_A]: "project_b", [COMPANY_B]: "project_b_one" };
const MANAGER: Record<string, string> = { [COMPANY_A]: "member_pm", [COMPANY_B]: "member_owner_b" };
const OWNER: Record<string, string> = { [COMPANY_A]: "member_qaqc", [COMPANY_B]: "member_multicompany_b" };

type Dates = { baseline?: number; planned?: number; forecast?: number };

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
const zones = new Map<string, string>();
const milestones: string[] = [];
let serial = 0;
let restoreTrail: () => Promise<void>;

function day(companyId: string, offset: number): string {
  return addLocalDays(localDate(new Date(), zones.get(companyId)!), offset);
}
const dateOn = (companyId: string, offset: number | undefined) => (offset === undefined ? null : new Date(`${day(companyId, offset)}T12:00:00.000Z`));

function milestoneData(companyId: string, dates: Dates, status: "NOT_STARTED" | "COMPLETED" = "NOT_STARTED") {
  serial += 1;
  const id = `${RUN}_m${String(serial).padStart(4, "0")}`;
  milestones.push(id);
  return {
    id, companyId, projectId: SITE[companyId], name: `Contract test ${id}`, status, sortOrder: 9000 + serial, ownerMemberId: OWNER[companyId], createdByMemberId: MANAGER[companyId],
    baselineDate: dateOn(companyId, dates.baseline), plannedDate: dateOn(companyId, dates.planned), forecastDate: dateOn(companyId, dates.forecast),
  };
}

async function milestone(companyId: string, dates: Dates, status?: "NOT_STARTED" | "COMPLETED"): Promise<string> {
  const data = milestoneData(companyId, dates, status);
  await prisma.projectMilestone.create({ data });
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

const events = (entityId: string, eventType: string) => prisma.notificationEventOutbox.findMany({ where: { entityId, eventType }, orderBy: { createdAt: "asc" } });
const targets = async (entityId: string, eventType: string) => (await events(entityId, eventType)).map((event) => (event.payloadJson as { targetDate: string }).targetDate);
const claimed = (entityId: string) => prisma.jobIdempotencyKey.findMany({ where: { jobKey: JOB, key: { startsWith: `${entityId}:` } }, select: { companyId: true } });

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
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: milestones } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { startsWith: RUN } } });
  await prisma.projectMilestone.deleteMany({ where: { id: { in: milestones } } });
  milestones.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("planning.milestones", () => {
  describe("idempotency", () => {
    it("reminds about a milestone due soon and one overdue once each, however often it runs, and changes neither (§92, §192)", async () => {
      const soon = await milestone(COMPANY_A, { planned: 2 });
      const late = await milestone(COMPANY_A, { baseline: -10, planned: -3 });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await targets(soon, "MILESTONE_DUE_SOON")).toEqual([day(COMPANY_A, 2)]);
      expect(await targets(late, "MILESTONE_OVERDUE")).toEqual([day(COMPANY_A, -3)]);
      expect(await events(soon, "MILESTONE_OVERDUE")).toHaveLength(0);
      expect(first.detail).toMatchObject({ dueSoon: expect.any(Number), overdue: expect.any(Number) });
      expect(first.processed).toBeGreaterThanOrEqual(2);
      expect(second.processed).toBe(0);
      const rows = await prisma.projectMilestone.findMany({ where: { id: { in: [soon, late] } }, select: { status: true, version: true, statusChangedAt: true } });
      expect(rows).toEqual([{ status: "NOT_STARTED", version: 1, statusChangedAt: null }, { status: "NOT_STARTED", version: 1, statusChangedAt: null }]);
    });

    it("reminds about a milestone that has only a baseline, before and after its date", async () => {
      const soon = await milestone(COMPANY_A, { baseline: 1 });
      const late = await milestone(COMPANY_A, { baseline: -1 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await targets(soon, "MILESTONE_DUE_SOON")).toEqual([day(COMPANY_A, 1)]);
      expect(await targets(late, "MILESTONE_OVERDUE")).toEqual([day(COMPANY_A, -1)]);
    });

    it("reminds again when a new forecast moves the target date, and leaves completed milestones alone (§91)", async () => {
      const moved = await milestone(COMPANY_A, { planned: -4 });
      const done = await milestone(COMPANY_A, { planned: -4 }, "COMPLETED");
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      await prisma.projectMilestone.update({ where: { id: moved }, data: { forecastDate: dateOn(COMPANY_A, -1) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await targets(moved, "MILESTONE_OVERDUE")).toEqual([day(COMPANY_A, -4), day(COMPANY_A, -1)]);
      expect(await events(done, "MILESTONE_OVERDUE")).toHaveLength(0);
    });

    it("sends one reminder when a second run reaches the milestone while the first is still sending it (§18)", async () => {
      const id = await milestone(COMPANY_A, { forecast: -2 });
      const second = overlapWhileNoticeAbout(id);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await events(id, "MILESTONE_OVERDUE")).toHaveLength(1);
    });

    it("counts only the reminders it sent, and claims none it had nobody to send to", async () => {
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const nobody = milestoneData(COMPANY_A, { planned: -2 });
      await prisma.projectMilestone.create({ data: { ...nobody, projectId: "project_c", ownerMemberId: null } });
      await prisma.project.update({ where: { id: "project_c" }, data: { projectManagerMemberId: null } });
      try {
        const run = await invokeJob(JOB, { companyIds: [COMPANY_A] });
        expect(run.detail).toEqual({ dueSoon: 0, overdue: 0 });
        expect(await claimed(nobody.id)).toEqual([]);
      } finally {
        await prisma.project.update({ where: { id: "project_c" }, data: { projectManagerMemberId: "member_owner" } });
      }
      // With a manager again, the next run tells them.
      expect((await invokeJob(JOB, { companyIds: [COMPANY_A] })).detail).toEqual({ dueSoon: 0, overdue: 1 });
    });

    it("reaches every milestone in a company past any one batch, whichever date it is due by (§133-§138)", async () => {
      const data = Array.from({ length: 130 }, (_, index) => milestoneData(COMPANY_B, index % 3 === 0 ? { forecast: -2 } : index % 3 === 1 ? { planned: -2 } : { baseline: -2 }));
      await prisma.projectMilestone.createMany({ data });

      await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(await prisma.notificationEventOutbox.count({ where: { eventType: "MILESTONE_OVERDUE", entityId: { in: data.map((row) => row.id) } } })).toBe(130);
    });
  });

  describe("company isolation", () => {
    it("runs one company without touching another, and reminds each company's people only about their own milestones (§180)", async () => {
      const inA = await milestone(COMPANY_A, { planned: -2 });
      const inB = await milestone(COMPANY_B, { planned: -2 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(inA, "MILESTONE_OVERDUE")).toHaveLength(1);
      expect(await events(inB, "MILESTONE_OVERDUE")).toHaveLength(0);
      expect(await claimed(inB)).toEqual([]);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      const [eventA] = await events(inA, "MILESTONE_OVERDUE");
      const [eventB] = await events(inB, "MILESTONE_OVERDUE");
      expect(eventA).toMatchObject({ companyId: COMPANY_A, projectId: SITE[COMPANY_A] });
      expect(eventB).toMatchObject({ companyId: COMPANY_B, projectId: SITE[COMPANY_B] });
      expect((eventB.payloadJson as { memberIds: string[] }).memberIds.sort()).toEqual([MANAGER[COMPANY_B], OWNER[COMPANY_B]].sort());
      expect(await claimed(inB)).toEqual([{ companyId: COMPANY_B }]);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company while the others run, and catches up once it is active again (§145, §181)", async () => {
      const inA = await milestone(COMPANY_A, { planned: -2 });
      const inB = await milestone(COMPANY_B, { planned: 3 });

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB));
      expect(await events(inA, "MILESTONE_OVERDUE")).toHaveLength(1);
      expect(await events(inB, "MILESTONE_DUE_SOON")).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(inB, "MILESTONE_DUE_SOON")).toHaveLength(1);
    });

    it("skips a company that has switched projects off (§26)", async () => {
      const inB = await milestone(COMPANY_B, { planned: -2 });

      await withModule(COMPANY_B, "projects", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));

      expect(await events(inB, "MILESTONE_OVERDUE")).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("sends every other reminder when one fails, leaves the failed one unclaimed, fails the run, and sends it next time (§30-§36)", async () => {
      const failing = await milestone(COMPANY_B, { planned: -2 });
      const after = await milestone(COMPANY_B, { planned: -2 });
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });
      const errors = vi.spyOn(logger, "error");

      await expect(invokeJob(JOB, { companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await events(after, "MILESTONE_OVERDUE")).toHaveLength(1);
      expect(await events(failing, "MILESTONE_OVERDUE")).toHaveLength(0);
      expect(await claimed(failing)).toEqual([]);
      expect(errors).toHaveBeenCalledWith(`${JOB}.item_failed`, expect.objectContaining({ companyId: COMPANY_B, milestoneId: failing, eventType: "MILESTONE_OVERDUE" }));

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(failing, "MILESTONE_OVERDUE")).toHaveLength(1);
      expect(await events(after, "MILESTONE_OVERDUE")).toHaveLength(1);
    });
  });
});
