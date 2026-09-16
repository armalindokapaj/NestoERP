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
 * Job `contractors.compliance` (PRD #51 §79-§81, §173-§181, §187): compliance
 * items move to EXPIRING and EXPIRED by their own company's calendar, and the
 * people responsible hear once per status per expiry date — however often the
 * job runs, and whether or not two runs overlap.
 */

const JOB = "contractors.compliance";
const EVENTS = ["CONTRACTOR_COMPLIANCE_EXPIRING", "CONTRACTOR_COMPLIANCE_EXPIRED"];
const RUN = `t51cc${Date.now().toString(36)}`;
const AUTHOR: Record<string, string> = { [COMPANY_A]: "member_legal", [COMPANY_B]: "member_owner_b" };

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
const zones = new Map<string, string>();
const contractors: string[] = [];
const items: string[] = [];
let serial = 0;
let restoreTrail: () => Promise<void>;

/** A business date `offset` days from the company's today, stored at midday as the service stores them. */
function day(companyId: string, offset: number): string {
  return addLocalDays(localDate(new Date(), zones.get(companyId)!), offset);
}

async function contractor(companyId: string, status: "ACTIVE" | "OFFBOARDED" = "ACTIVE"): Promise<string> {
  serial += 1;
  const id = `${RUN}_k${String(serial).padStart(3, "0")}`;
  await prisma.contractorProfile.create({ data: { id, companyId, legalName: `Contract test ${id}`, status, createdByMemberId: AUTHOR[companyId] } });
  contractors.push(id);
  return id;
}

async function item(companyId: string, input: { expiresIn: number; status?: "VALID" | "EXPIRING"; contractorId?: string }): Promise<string> {
  const contractorId = input.contractorId ?? (await contractor(companyId));
  serial += 1;
  const id = `${RUN}_i${String(serial).padStart(3, "0")}`;
  await prisma.contractorComplianceItem.create({
    data: { id, companyId, contractorId, type: "INSURANCE", title: `Cover ${id}`, status: input.status ?? "VALID", expiresAt: new Date(`${day(companyId, input.expiresIn)}T12:00:00.000Z`), createdByMemberId: AUTHOR[companyId] },
  });
  items.push(id);
  return id;
}

/** Runs `first` inside the job's transaction, just before the notice about `entityId` is enqueued. */
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

const statusOf = async (id: string) => (await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const events = (id: string, eventType = "CONTRACTOR_COMPLIANCE_EXPIRED") => prisma.notificationEventOutbox.findMany({ where: { entityType: "contractor_compliance", entityId: id, eventType }, orderBy: { createdAt: "asc" } });
const memberIdsOf = (event: { payloadJson: unknown }) => (event.payloadJson as { memberIds: string[] }).memberIds;
const membersOf = async (companyId: string) => new Set((await prisma.companyMember.findMany({ where: { companyId }, select: { id: true } })).map((row) => row.id));

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
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: items } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { startsWith: RUN } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: items } } });
  await prisma.contractorComplianceItem.deleteMany({ where: { id: { in: items } } });
  await prisma.contractorProfile.deleteMany({ where: { id: { in: contractors } } });
  items.length = 0;
  contractors.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("contractors.compliance", () => {
  describe("idempotency", () => {
    it("moves an item past its expiry to EXPIRED once, audits it as the system, and tells people once however often it runs (§187)", async () => {
      const id = await item(COMPANY_A, { expiresIn: -2 });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await statusOf(id)).toBe("EXPIRED");
      expect(first.processed).toBeGreaterThanOrEqual(1);
      expect(second).toMatchObject({ processed: 0, detail: { moved: 0 } });
      const sent = await events(id);
      expect(sent).toHaveLength(1);
      expect(sent[0].payloadJson).toMatchObject({ expiresAt: day(COMPANY_A, -2) });
      expect(await prisma.jobIdempotencyKey.count({ where: { companyId: COMPANY_A, jobKey: JOB, key: `${id}:EXPIRED:${day(COMPANY_A, -2)}` } })).toBe(1);
      const audit = await prisma.auditEvent.findMany({ where: { entityId: id, actionKey: "CONTRACTOR_COMPLIANCE_EXPIRED" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM", actorDisplayNameSnapshot: `System (${JOB})` });
    });

    it("tells people once about an item inside its reminder window, and again only when its expiry date moves", async () => {
      const id = await item(COMPANY_A, { expiresIn: 10, status: "EXPIRING" });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(id, "CONTRACTOR_COMPLIANCE_EXPIRING")).toHaveLength(1);

      await prisma.contractorComplianceItem.update({ where: { id }, data: { expiresAt: new Date(`${day(COMPANY_A, 12)}T12:00:00.000Z`) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const sent = await events(id, "CONTRACTOR_COMPLIANCE_EXPIRING");
      expect(sent.map((event) => (event.payloadJson as { expiresAt: string }).expiresAt)).toEqual([day(COMPANY_A, 10), day(COMPANY_A, 12)]);
    });

    it("moves, audits and tells once when a second run reaches the item while the first is still moving it (§18)", async () => {
      const id = await item(COMPANY_A, { expiresIn: -1 });
      const second = overlapWhileNoticeAbout(id);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await statusOf(id)).toBe("EXPIRED");
      expect(await events(id)).toHaveLength(1);
      expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "CONTRACTOR_COMPLIANCE_EXPIRED" } })).toBe(1);
    });

    it("tells once when a second run reaches an expiring item while the first is still telling people about it (§18)", async () => {
      const id = await item(COMPANY_A, { expiresIn: 10, status: "EXPIRING" });
      const second = overlapWhileNoticeAbout(id);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await events(id, "CONTRACTOR_COMPLIANCE_EXPIRING")).toHaveLength(1);
    });

    it("leaves the paperwork of an offboarded contractor alone, as attention does", async () => {
      const id = await item(COMPANY_A, { expiresIn: -2, contractorId: await contractor(COMPANY_A, "OFFBOARDED") });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await statusOf(id)).toBe("VALID");
      expect(await events(id)).toHaveLength(0);
    });
  });

  describe("renewal race", () => {
    it("never overwrites a renewal saved after the job read the item (§80)", async () => {
      const first = await item(COMPANY_A, { expiresIn: -3 });
      const renewed = await item(COMPANY_A, { expiresIn: -3 });
      const nextYear = new Date(`${day(COMPANY_A, 365)}T12:00:00.000Z`);
      // While the job tells people about the first item, a person renews the second, which the job has already read as expired.
      beforeNoticeAbout(first, async () => {
        await prisma.contractorComplianceItem.update({ where: { id: renewed }, data: { status: "VALID", expiresAt: nextYear } });
      });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await statusOf(first)).toBe("EXPIRED");
      expect(await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: renewed }, select: { status: true, expiresAt: true } })).toEqual({ status: "VALID", expiresAt: nextYear });
      expect(await events(renewed)).toHaveLength(0);
      expect(await prisma.auditEvent.count({ where: { entityId: renewed } })).toBe(0);
    });
  });

  describe("company isolation", () => {
    it("runs one company without touching another, and tells each company's people only about their own items (§180)", async () => {
      const inA = await item(COMPANY_A, { expiresIn: -2 });
      const inB = await item(COMPANY_B, { expiresIn: -2 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOf(inA)).toBe("EXPIRED");
      expect(await statusOf(inB)).toBe("VALID");
      expect(await events(inB)).toHaveLength(0);
      expect(await prisma.jobIdempotencyKey.count({ where: { key: { startsWith: `${inB}:` } } })).toBe(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await statusOf(inB)).toBe("EXPIRED");
      const [eventA] = await events(inA);
      const [eventB] = await events(inB);
      expect(eventA.companyId).toBe(COMPANY_A);
      expect(eventB.companyId).toBe(COMPANY_B);
      const [membersA, membersB] = await Promise.all([membersOf(COMPANY_A), membersOf(COMPANY_B)]);
      expect(memberIdsOf(eventA).length).toBeGreaterThan(0);
      expect(memberIdsOf(eventA).every((id) => membersA.has(id))).toBe(true);
      expect(memberIdsOf(eventB).length).toBeGreaterThan(0);
      expect(memberIdsOf(eventB).every((id) => membersB.has(id))).toBe(true);
      expect(await prisma.jobIdempotencyKey.findMany({ where: { jobKey: JOB, key: { startsWith: `${inB}:` } }, select: { companyId: true } })).toEqual([{ companyId: COMPANY_B }]);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company while the others run, and catches up once it is active again (§145, §181)", async () => {
      const inA = await item(COMPANY_A, { expiresIn: -2 });
      const inB = await item(COMPANY_B, { expiresIn: -2 });

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB));
      expect(await statusOf(inA)).toBe("EXPIRED");
      expect(await statusOf(inB)).toBe("VALID");
      expect(await events(inB)).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await statusOf(inB)).toBe("EXPIRED");
      expect(await events(inB)).toHaveLength(1);
    });

    it("skips a company that has switched contractors off (§26)", async () => {
      const inB = await item(COMPANY_B, { expiresIn: -2 });

      await withModule(COMPANY_B, "contractors", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));

      expect(await statusOf(inB)).toBe("VALID");
      expect(await events(inB)).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("settles every other item when one fails, rolls the failed one back whole, fails the run, and picks it up next time (§30-§36)", async () => {
      const failing = await item(COMPANY_A, { expiresIn: -2 });
      const after = await item(COMPANY_A, { expiresIn: -2 });
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });
      const errors = vi.spyOn(logger, "error");

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await statusOf(after)).toBe("EXPIRED");
      expect(await events(after)).toHaveLength(1);
      // The move, its audit and the ledger claim went with the notice that failed.
      expect(await statusOf(failing)).toBe("VALID");
      expect(await prisma.auditEvent.count({ where: { entityId: failing } })).toBe(0);
      expect(await prisma.jobIdempotencyKey.count({ where: { key: { startsWith: `${failing}:` } } })).toBe(0);
      expect(errors).toHaveBeenCalledWith(`${JOB}.item_failed`, expect.objectContaining({ companyId: COMPANY_A, complianceItemId: failing, errorMessage: "outbox unavailable" }));

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOf(failing)).toBe("EXPIRED");
      expect(await events(failing)).toHaveLength(1);
    });

    it("still runs the other companies when one company's item fails (PRD #47 §241)", async () => {
      const failing = await item(COMPANY_A, { expiresIn: -2 });
      const inB = await item(COMPANY_B, { expiresIn: -2 });
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await statusOf(inB)).toBe("EXPIRED");
      expect(await events(inB)).toHaveLength(1);
      expect(await statusOf(failing)).toBe("VALID");
    });
  });
});
