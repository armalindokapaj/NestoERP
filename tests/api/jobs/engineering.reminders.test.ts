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
 * Job `engineering.reminders` (PRD #51 §82-§85, §173-§181, §188, §189): RFIs
 * and submittal reviews are reminded about once per record per due date, every
 * one of them however many a company has, and only the reminders that went
 * are counted.
 */

const JOB = "engineering.reminders";
const EVENTS = ["RFI_DUE_SOON", "RFI_OVERDUE", "SUBMITTAL_DUE_SOON", "SUBMITTAL_OVERDUE"];
const RUN = `t51er${Date.now().toString(36)}`;
/** A live project in each company with a manager, and one in A without (a draft nobody manages yet). */
const SITE: Record<string, string> = { [COMPANY_A]: "project_a", [COMPANY_B]: "project_b_one" };
const UNMANAGED = "project_e";
const PEOPLE: Record<string, { assignee: string; author: string }> = {
  [COMPANY_A]: { assignee: "member_architect", author: "member_engineer" },
  [COMPANY_B]: { assignee: "member_multicompany_b", author: "member_owner_b" },
};

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
const zones = new Map<string, string>();
const rfis: string[] = [];
const submittals: string[] = [];
let serial = 0;
let restoreTrail: () => Promise<void>;

function day(companyId: string, offset: number): string {
  return addLocalDays(localDate(new Date(), zones.get(companyId)!), offset);
}
const dueOn = (companyId: string, offset: number) => new Date(`${day(companyId, offset)}T12:00:00.000Z`);
const nextId = (kind: string) => `${RUN}_${kind}${String((serial += 1)).padStart(4, "0")}`;

function rfiData(companyId: string, dueIn: number, overrides: { projectId?: string; assignedToMemberId?: string | null } = {}) {
  const id = nextId("r");
  rfis.push(id);
  return {
    id, companyId, projectId: overrides.projectId ?? SITE[companyId], rfiNumber: id, subject: `Contract test ${id}`, question: "?", status: "OPEN" as const,
    assignedToMemberId: overrides.assignedToMemberId === undefined ? PEOPLE[companyId].assignee : overrides.assignedToMemberId, createdByMemberId: PEOPLE[companyId].author, dueAt: dueOn(companyId, dueIn), openedAt: new Date(),
  };
}

async function rfi(companyId: string, dueIn: number, overrides: { projectId?: string; assignedToMemberId?: string | null } = {}): Promise<string> {
  const data = rfiData(companyId, dueIn, overrides);
  await prisma.rfi.create({ data });
  return data.id;
}

async function submittal(companyId: string, dueIn: number): Promise<string> {
  const id = nextId("s");
  await prisma.technicalSubmittal.create({
    data: { id, companyId, projectId: SITE[companyId], submittalNumber: id, title: `Contract test ${id}`, submittalType: "MATERIAL_SUBMITTAL", status: "SUBMITTED", assignedReviewerMemberId: PEOPLE[companyId].assignee, dueAt: dueOn(companyId, dueIn), createdByMemberId: PEOPLE[companyId].author },
  });
  submittals.push(id);
  return id;
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
const dueDates = async (entityId: string, eventType: string) => (await events(entityId, eventType)).map((event) => (event.payloadJson as { dueDate: string }).dueDate);
const memberIdsOf = (event: { payloadJson: unknown }) => (event.payloadJson as { memberIds: string[] }).memberIds;
const claimed = (entityId: string) => prisma.jobIdempotencyKey.findMany({ where: { jobKey: JOB, key: { startsWith: `${entityId}:` } }, select: { companyId: true, key: true } });

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
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: [...rfis, ...submittals] } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { startsWith: RUN } } });
  await prisma.rfi.deleteMany({ where: { id: { in: rfis } } });
  await prisma.technicalSubmittal.deleteMany({ where: { id: { in: submittals } } });
  rfis.length = 0;
  submittals.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("engineering.reminders", () => {
  describe("idempotency", () => {
    it("reminds about an overdue RFI and a submittal review due soon once each, however often it runs (§188, §189)", async () => {
      const late = await rfi(COMPANY_A, -2);
      const soon = await submittal(COMPANY_A, 1);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await dueDates(late, "RFI_OVERDUE")).toEqual([day(COMPANY_A, -2)]);
      expect(await dueDates(soon, "SUBMITTAL_DUE_SOON")).toEqual([day(COMPANY_A, 1)]);
      expect((first.detail as { rfiOverdue: number }).rfiOverdue).toBeGreaterThanOrEqual(1);
      expect((first.detail as { submittalDueSoon: number }).submittalDueSoon).toBeGreaterThanOrEqual(1);
      expect(second.processed).toBe(0);
      // Reminding is all it does: the RFI's lifecycle is the engineering service's (§83).
      expect(await prisma.rfi.findUniqueOrThrow({ where: { id: late }, select: { status: true, version: true } })).toEqual({ status: "OPEN", version: 1 });
    });

    it("reminds again when the due date moves, and only then", async () => {
      const id = await rfi(COMPANY_A, -3);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      await prisma.rfi.update({ where: { id }, data: { dueAt: dueOn(COMPANY_A, -1) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await dueDates(id, "RFI_OVERDUE")).toEqual([day(COMPANY_A, -3), day(COMPANY_A, -1)]);
    });

    it("sends one reminder when a second run reaches the RFI while the first is still sending it (§18)", async () => {
      const id = await rfi(COMPANY_A, -2);
      const second = overlapWhileNoticeAbout(id);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await events(id, "RFI_OVERDUE")).toHaveLength(1);
    });

    it("counts only the reminders it sent, and claims none it had nobody to send to", async () => {
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const nobody = await rfi(COMPANY_A, 1, { projectId: UNMANAGED, assignedToMemberId: null });
      const somebody = await rfi(COMPANY_A, 1);

      const run = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(run.detail).toEqual({ rfiDueSoon: 1, rfiOverdue: 0, submittalDueSoon: 0, submittalOverdue: 0 });
      expect(await events(somebody, "RFI_DUE_SOON")).toHaveLength(1);
      expect(await events(nobody, "RFI_DUE_SOON")).toHaveLength(0);
      expect(await claimed(nobody)).toEqual([]);

      // Assigned before the next run: now it is reminded.
      await prisma.rfi.update({ where: { id: nobody }, data: { assignedToMemberId: PEOPLE[COMPANY_A].assignee } });
      expect((await invokeJob(JOB, { companyIds: [COMPANY_A] })).detail).toMatchObject({ rfiDueSoon: 1 });
      expect(await events(nobody, "RFI_DUE_SOON")).toHaveLength(1);
    });

    it("reaches every overdue RFI in a company, past any one batch (§133-§138)", async () => {
      const data = Array.from({ length: 130 }, () => rfiData(COMPANY_B, -4));
      await prisma.rfi.createMany({ data });

      const run = await invokeJob(JOB, { companyIds: [COMPANY_B] });

      expect(run.detail).toMatchObject({ rfiOverdue: 130 });
      expect(await prisma.notificationEventOutbox.count({ where: { eventType: "RFI_OVERDUE", entityId: { in: data.map((row) => row.id) } } })).toBe(130);
    });
  });

  describe("company isolation", () => {
    it("runs one company without touching another, and reminds each company's people only about their own records (§180)", async () => {
      const inA = await rfi(COMPANY_A, -2);
      const inB = await rfi(COMPANY_B, -2);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(inA, "RFI_OVERDUE")).toHaveLength(1);
      expect(await events(inB, "RFI_OVERDUE")).toHaveLength(0);
      expect(await claimed(inB)).toEqual([]);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      const [eventA] = await events(inA, "RFI_OVERDUE");
      const [eventB] = await events(inB, "RFI_OVERDUE");
      expect(eventA).toMatchObject({ companyId: COMPANY_A, projectId: SITE[COMPANY_A] });
      expect(eventB).toMatchObject({ companyId: COMPANY_B, projectId: SITE[COMPANY_B] });
      expect(memberIdsOf(eventB).sort()).toEqual([PEOPLE[COMPANY_B].assignee, PEOPLE[COMPANY_B].author].sort());
      expect((await claimed(inB)).map((row) => row.companyId)).toEqual([COMPANY_B]);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company while the others run, and catches up once it is active again (§145, §181)", async () => {
      const inA = await rfi(COMPANY_A, -2);
      const inB = await submittal(COMPANY_B, -2);

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB));
      expect(await events(inA, "RFI_OVERDUE")).toHaveLength(1);
      expect(await events(inB, "SUBMITTAL_OVERDUE")).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(inB, "SUBMITTAL_OVERDUE")).toHaveLength(1);
    });

    it("skips a company that has switched engineering off (§26)", async () => {
      const inB = await rfi(COMPANY_B, -2);

      await withModule(COMPANY_B, "engineering", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));

      expect(await events(inB, "RFI_OVERDUE")).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("sends every other reminder when one fails, leaves the failed one unclaimed, fails the run, and sends it next time (§30-§36)", async () => {
      const failing = await rfi(COMPANY_B, -2);
      const after = await rfi(COMPANY_B, -2);
      const review = await submittal(COMPANY_B, -2);
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });
      const errors = vi.spyOn(logger, "error");

      await expect(invokeJob(JOB, { companyIds: [COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await events(after, "RFI_OVERDUE")).toHaveLength(1);
      expect(await events(review, "SUBMITTAL_OVERDUE")).toHaveLength(1);
      expect(await events(failing, "RFI_OVERDUE")).toHaveLength(0);
      expect(await claimed(failing)).toEqual([]);
      expect(errors).toHaveBeenCalledWith(`${JOB}.item_failed`, expect.objectContaining({ companyId: COMPANY_B, entityType: "rfi", entityId: failing, eventType: "RFI_OVERDUE" }));

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(failing, "RFI_OVERDUE")).toHaveLength(1);
      expect(await events(after, "RFI_OVERDUE")).toHaveLength(1);
    });
  });
});
