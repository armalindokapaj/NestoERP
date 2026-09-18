import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { companyDays } from "@/lib/core/notifications/company-day";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger } from "@/lib/core/observability/logger";
import { addDays } from "@/lib/modules/hr/employment/employment.dates";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

vi.mock("@/lib/core/notifications/notification.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/notifications/notification.service")>();
  return { ...actual, enqueueNotificationEvent: vi.fn(actual.enqueueNotificationEvent) };
});

/**
 * Job `hr.credential-expiry` (E-02 §83-§91, §193; PRD #51 §173-§181): employee
 * documents and qualifications are reminded about at 90, 60, 30 and 7 days and
 * once past their date, in their company's own day; a verified one becomes
 * EXPIRED. Each reminder goes out once however often, and however
 * concurrently, the job runs.
 */

const JOB = "hr.credential-expiry";
const EVENTS = ["EMPLOYEE_DOCUMENT_EXPIRING", "EMPLOYEE_DOCUMENT_EXPIRED", "QUALIFICATION_EXPIRING", "QUALIFICATION_EXPIRED"];
const RUN = `t02x${Date.now().toString(36)}`;

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
const today = new Map<string, string>();
/** An employment per company to file documents on: the engineer's in Aurelia, a made one in the fixture tenant. */
const employment = new Map<string, { id: string; personId: string; groupId: string; memberId: string | null }>();
const links: string[] = [];
const documents: string[] = [];
const qualifications: string[] = [];
let serial = 0;
let restoreTrail: () => Promise<void>;

async function link(companyId: string, input: { expiresIn: number; status?: "VERIFIED" | "UNVERIFIED"; current?: boolean }): Promise<string> {
  serial += 1;
  const id = `${RUN}_l${String(serial).padStart(3, "0")}`;
  const documentId = `${RUN}_d${String(serial).padStart(3, "0")}`;
  const owner = employment.get(companyId)!;
  await prisma.document.create({ data: { id: documentId, companyId, name: `Expiry test ${id}.pdf`, module: "hr", entityType: "employee", entityId: owner.id, status: "ACTIVE", storageStatus: "AVAILABLE", createdBy: "test" } });
  documents.push(documentId);
  await prisma.employeeDocumentLink.create({
    data: { id, companyId, employeeProfileId: owner.id, documentId, category: "DRIVING_LICENSE", title: `Licence ${id}`, visibility: "EMPLOYEE_AND_HR", verificationStatus: input.status ?? "VERIFIED", isCurrent: input.current ?? true, expiryDate: new Date(`${addDays(today.get(companyId)!, input.expiresIn)}T00:00:00.000Z`) },
  });
  links.push(id);
  return id;
}

async function qualification(companyId: string, input: { expiresIn: number; status?: "VERIFIED" | "UNVERIFIED" }): Promise<string> {
  serial += 1;
  const id = `${RUN}_q${String(serial).padStart(3, "0")}`;
  const owner = employment.get(companyId)!;
  await prisma.personQualification.create({
    data: { id, parentGroupId: owner.groupId, personProfileId: owner.personId, companyId, type: "PROFESSIONAL_LICENSE", title: `Licence ${id}`, verificationStatus: input.status ?? "VERIFIED", expiryDate: new Date(`${addDays(today.get(companyId)!, input.expiresIn)}T00:00:00.000Z`) },
  });
  qualifications.push(id);
  return id;
}

function beforeNoticeAbout(entityId: string, first: () => Promise<void>) {
  enqueue.mockImplementation(async (tx, input) => {
    if (input.entityId === entityId) await first();
    return realEnqueue(tx, input);
  });
}

const statusOfLink = async (id: string) => (await prisma.employeeDocumentLink.findUniqueOrThrow({ where: { id }, select: { verificationStatus: true } })).verificationStatus;
const statusOfQualification = async (id: string) => (await prisma.personQualification.findUniqueOrThrow({ where: { id }, select: { verificationStatus: true } })).verificationStatus;
const events = (id: string, eventType: string) => prisma.notificationEventOutbox.findMany({ where: { entityId: id, eventType }, orderBy: { createdAt: "asc" } });
const memberIdsOf = (event: { payloadJson: unknown }) => (event.payloadJson as { memberIds: string[] }).memberIds;

beforeAll(async () => {
  realEnqueue = enqueue.getMockImplementation()!;
  for (const companyId of [COMPANY_A, COMPANY_B]) today.set(companyId, (await companyDays(companyId))(new Date()).day);

  const engineer = await prisma.employeeProfile.findFirstOrThrow({ where: { companyId: COMPANY_A, companyMember: { is: { role: { key: "ENGINEER" } } } }, select: { id: true, personProfileId: true, companyMemberId: true, company: { select: { parentGroupId: true } } } });
  employment.set(COMPANY_A, { id: engineer.id, personId: engineer.personProfileId, groupId: engineer.company.parentGroupId!, memberId: engineer.companyMemberId });

  // Nobody is employed in the fixture tenant: the test brings somebody who never signs in.
  const tenant = await prisma.company.findUniqueOrThrow({ where: { id: COMPANY_B }, select: { parentGroupId: true } });
  await prisma.personProfile.create({ data: { id: `${RUN}_person`, parentGroupId: tenant.parentGroupId!, firstName: "Expiry", lastName: RUN, lifecycleStatus: "EMPLOYEE" } });
  await prisma.employeeProfile.create({ data: { id: `${RUN}_employment`, companyId: COMPANY_B, personProfileId: `${RUN}_person`, employmentStatus: "ACTIVE" } });
  employment.set(COMPANY_B, { id: `${RUN}_employment`, personId: `${RUN}_person`, groupId: tenant.parentGroupId!, memberId: null });
});

beforeEach(async () => {
  restoreTrail = await rememberTrail(JOB, EVENTS);
});

afterEach(async () => {
  vi.restoreAllMocks();
  enqueue.mockImplementation(realEnqueue);
  await restoreTrail();
  const ids = [...links, ...qualifications];
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, key: { startsWith: RUN } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.employeeDocumentLink.deleteMany({ where: { id: { in: links } } });
  await prisma.document.deleteMany({ where: { id: { in: documents } } });
  await prisma.personQualification.deleteMany({ where: { id: { in: qualifications } } });
  links.length = 0;
  documents.length = 0;
  qualifications.length = 0;
});

afterAll(async () => {
  await prisma.employeeProfile.deleteMany({ where: { id: `${RUN}_employment` } });
  await prisma.personProfile.deleteMany({ where: { id: `${RUN}_person` } });
  await prisma.$disconnect();
});

describe("hr.credential-expiry", () => {
  describe("idempotency", () => {
    it("moves a verified document past its date to EXPIRED once, audits it as the system, and tells people once (§90, §193)", async () => {
      const id = await link(COMPANY_A, { expiresIn: -2 });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await statusOfLink(id)).toBe("EXPIRED");
      expect(first.processed).toBeGreaterThanOrEqual(1);
      expect(second.detail).toMatchObject({ expired: 0 });
      const sent = await events(id, "EMPLOYEE_DOCUMENT_EXPIRED");
      expect(sent).toHaveLength(1);
      // The employee, who may see it, and HR's verifiers.
      expect(memberIdsOf(sent[0])).toContain(employment.get(COMPANY_A)!.memberId);
      expect(memberIdsOf(sent[0]).length).toBeGreaterThan(1);
      const audit = await prisma.auditEvent.findMany({ where: { entityId: id, actionKey: "EMPLOYEE_DOCUMENT_EXPIRED" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM" });
    });

    it("reminds once per window, and again as the date comes closer (§85, §88)", async () => {
      const id = await link(COMPANY_A, { expiresIn: 20 });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await events(id, "EMPLOYEE_DOCUMENT_EXPIRING")).map((event) => (event.payloadJson as { window: string }).window)).toEqual(["30"]);

      await prisma.employeeDocumentLink.update({ where: { id }, data: { expiryDate: new Date(`${addDays(today.get(COMPANY_A)!, 5)}T00:00:00.000Z`) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await events(id, "EMPLOYEE_DOCUMENT_EXPIRING")).map((event) => (event.payloadJson as { window: string }).window)).toEqual(["30", "7"]);
      // Further than 90 days away is nobody's business yet.
      const far = await link(COMPANY_A, { expiresIn: 120 });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(far, "EMPLOYEE_DOCUMENT_EXPIRING")).toHaveLength(0);
    });

    it("expires a verified qualification once and reminds the person and HR once (§87)", async () => {
      const id = await qualification(COMPANY_A, { expiresIn: -1 });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOfQualification(id)).toBe("EXPIRED");
      const sent = await events(id, "QUALIFICATION_EXPIRED");
      expect(sent).toHaveLength(1);
      expect(memberIdsOf(sent[0])).toContain(employment.get(COMPANY_A)!.memberId);
      expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "EMPLOYEE_QUALIFICATION_EXPIRED" } })).toBe(1);
    });

    it("leaves what was renewed alone: a superseded record is nobody's reminder (§91, §194)", async () => {
      const id = await link(COMPANY_A, { expiresIn: -3, current: false });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOfLink(id)).toBe("VERIFIED");
      expect(await events(id, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(0);
    });

    it("moves and tells once when a renewal lands while the job is telling people about another record", async () => {
      const first = await link(COMPANY_A, { expiresIn: -3 });
      const renewed = await link(COMPANY_A, { expiresIn: -3 });
      beforeNoticeAbout(first, async () => {
        await prisma.employeeDocumentLink.update({ where: { id: renewed }, data: { isCurrent: false, verificationStatus: "SUPERSEDED" } });
      });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOfLink(first)).toBe("EXPIRED");
      expect(await statusOfLink(renewed)).toBe("SUPERSEDED");
      expect(await events(renewed, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(0);
    });
  });

  describe("company isolation", () => {
    it("runs one company without touching another, and tells each company's people only about their own (§84)", async () => {
      const inA = await link(COMPANY_A, { expiresIn: -2 });
      const inB = await link(COMPANY_B, { expiresIn: -2 });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOfLink(inA)).toBe("EXPIRED");
      expect(await statusOfLink(inB)).toBe("VERIFIED");
      expect(await events(inB, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await statusOfLink(inB)).toBe("EXPIRED");
      const [eventB] = await events(inB, "EMPLOYEE_DOCUMENT_EXPIRED");
      expect(eventB.companyId).toBe(COMPANY_B);
      const membersB = new Set((await prisma.companyMember.findMany({ where: { companyId: COMPANY_B }, select: { id: true } })).map((row) => row.id));
      expect(memberIdsOf(eventB).length).toBeGreaterThan(0);
      expect(memberIdsOf(eventB).every((id) => membersB.has(id))).toBe(true);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company while the others run, and catches up once it is active again", async () => {
      const inA = await link(COMPANY_A, { expiresIn: -2 });
      const inB = await link(COMPANY_B, { expiresIn: -2 });

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B] }));
      expect(await statusOfLink(inA)).toBe("EXPIRED");
      expect(await statusOfLink(inB)).toBe("VERIFIED");

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await statusOfLink(inB)).toBe("EXPIRED");
    });

    it("skips a company that has switched HR off (PRD #51 §26)", async () => {
      const inB = await link(COMPANY_B, { expiresIn: -2 });
      await withModule(COMPANY_B, "hr", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
      expect(await statusOfLink(inB)).toBe("VERIFIED");
      expect(await events(inB, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(0);
    });
  });

  describe("failure", () => {
    it("settles every other record when one fails, rolls the failed one back whole, fails the run, and picks it up next time", async () => {
      const failing = await link(COMPANY_A, { expiresIn: -2 });
      const after = await link(COMPANY_A, { expiresIn: -2 });
      beforeNoticeAbout(failing, async () => {
        throw new Error("outbox unavailable");
      });
      const errors = vi.spyOn(logger, "error");

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await statusOfLink(after)).toBe("EXPIRED");
      expect(await events(after, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(1);
      expect(await statusOfLink(failing)).toBe("VERIFIED");
      expect(await prisma.auditEvent.count({ where: { entityId: failing } })).toBe(0);
      expect(errors).toHaveBeenCalledWith(`${JOB}.item_failed`, expect.objectContaining({ companyId: COMPANY_A, employeeDocumentId: failing, errorMessage: "outbox unavailable" }));

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOfLink(failing)).toBe("EXPIRED");
      expect(await events(failing, "EMPLOYEE_DOCUMENT_EXPIRED")).toHaveLength(1);
    });
  });
});
