import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

vi.mock("@/lib/core/notifications/notification.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/core/notifications/notification.service")>();
  return { ...actual, enqueueNotificationEvent: vi.fn(actual.enqueueNotificationEvent) };
});

/**
 * Job `finance.unit-installments` (E-05F §94-§96; PRD #51 §173-§181): an
 * installment of an active schedule on a signed sale contract falling due within
 * seven days is announced once per due date; one past due and still owed is
 * announced once, and the unit's move to Overdue is audited as the system — for
 * the first overdue installment only, however often the job runs and whether or
 * not two runs overlap. Nothing is written to the installment itself.
 */

const JOB = "finance.unit-installments";
const EVENTS = ["UNIT_INSTALLMENT_OVERDUE", "UNIT_INSTALLMENT_DUE_SOON"];
const RUN = `t05f${Date.now().toString(36)}`;
const DAY = 86_400_000;
const FIXTURE: Record<string, { projectId: string; client: string; member: string; typeCode: string }> = {
  [COMPANY_A]: { projectId: "project_c", client: "client_acme", member: "member_finance", typeCode: "APARTMENT" },
  [COMPANY_B]: { projectId: "project_b_one", client: "client_b_muc", member: "member_owner_b", typeCode: "OFFICE" },
};

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
let restoreTrail: () => Promise<void>;
const made = { buildings: [] as string[], units: [] as string[], contracts: [] as string[], payments: [] as string[] };
let serial = 0;

/** A signed, active sale contract selling one unit, with one active schedule of the given installments. */
async function sale(companyId: string, installments: Array<{ days: number; amount: number; paid?: number }>) {
  const fixture = FIXTURE[companyId]!;
  serial += 1;
  const tag = `${RUN}${serial}`;
  const building = await prisma.projectBuilding.create({ data: { id: `${tag}_b`, companyId, projectId: fixture.projectId, name: `Job ${tag}`, nameKey: `JOB ${tag}`.toUpperCase(), sortOrder: 99, createdBy: "test" } });
  made.buildings.push(building.id);
  const floor = await prisma.projectFloor.create({ data: { id: `${tag}_f`, companyId, projectId: fixture.projectId, buildingId: building.id, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "test" } });
  const type = await prisma.projectUnitType.findFirstOrThrow({ where: { companyId, code: fixture.typeCode }, select: { id: true } });
  const unit = await prisma.projectUnit.create({ data: { id: `${tag}_u`, companyId, projectId: fixture.projectId, floorId: floor.id, unitCode: `F-${tag}`, unitCodeKey: `F-${tag}`.toUpperCase(), unitTypeId: type.id, sortOrder: 1, createdBy: "test", publicationStatus: "PUBLISHED" } });
  made.units.push(unit.id);
  const total = installments.reduce((sum, row) => sum + row.amount, 0);
  const contract = await prisma.contract.create({
    data: { id: `${tag}_c`, companyId, contractNumber: `JOB-${tag}`, title: "Sale", contractType: "SALE_AGREEMENT", clientId: fixture.client, projectId: fixture.projectId, ownerMemberId: fixture.member, status: "ACTIVE", currency: "EUR", contractValue: total, createdByMemberId: fixture.member },
  });
  made.contracts.push(contract.id);
  await prisma.contractUnit.create({ data: { companyId, projectId: fixture.projectId, contractId: contract.id, unitId: unit.id, value: total, currency: "EUR", createdByMemberId: fixture.member } });
  const schedule = await prisma.paymentSchedule.create({ data: { id: `${tag}_s`, companyId, contractId: contract.id, versionNumber: 1, status: "ACTIVE", currency: "EUR", activatedAt: new Date(), activatedByMemberId: fixture.member, createdByMemberId: fixture.member } });
  const ids: string[] = [];
  for (const [index, row] of installments.entries()) {
    const dueDate = new Date(Math.floor((Date.now() + row.days * DAY) / DAY) * DAY + 12 * 3_600_000);
    const installment = await prisma.paymentInstallment.create({ data: { companyId, contractId: contract.id, scheduleId: schedule.id, sequence: index + 1, label: `Installment ${index + 1}`, amount: row.amount, currency: "EUR", dueDate } });
    ids.push(installment.id);
    if (row.paid) {
      const payment = await prisma.payment.create({ data: { companyId, direction: "RECEIPT", clientId: fixture.client, contractId: contract.id, projectId: fixture.projectId, amount: row.paid, currency: "EUR", paymentDate: new Date(), method: "BANK_TRANSFER", createdByMemberId: fixture.member } });
      made.payments.push(payment.id);
      await prisma.paymentAllocation.create({ data: { companyId, paymentId: payment.id, contractId: contract.id, installmentId: installment.id, amount: row.paid, createdByMemberId: fixture.member } });
    }
  }
  return { unitId: unit.id, contractId: contract.id, installments: ids };
}

const events = (unitId: string, eventType: string) => prisma.notificationEventOutbox.findMany({ where: { entityType: "project_unit", entityId: unitId, eventType } });
const statusAudits = (contractId: string) => prisma.auditEvent.count({ where: { entityId: contractId, actionKey: "UNIT_FINANCIAL_STATUS_CHANGED" } });

function beforeNoticeAbout(unitId: string, first: () => Promise<void>) {
  enqueue.mockImplementation(async (tx, input) => {
    if (input.entityId === unitId) await first();
    return realEnqueue(tx, input);
  });
}

beforeAll(() => {
  realEnqueue = enqueue.getMockImplementation()!;
});

beforeEach(async () => {
  restoreTrail = await rememberTrail(JOB, EVENTS);
});

afterEach(async () => {
  enqueue.mockImplementation(realEnqueue);
  await restoreTrail();
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: made.units } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: made.contracts } } });
  await prisma.paymentAllocation.deleteMany({ where: { contractId: { in: made.contracts } } });
  await prisma.payment.deleteMany({ where: { id: { in: made.payments } } });
  await prisma.paymentInstallment.deleteMany({ where: { contractId: { in: made.contracts } } });
  await prisma.paymentSchedule.deleteMany({ where: { contractId: { in: made.contracts } } });
  await prisma.contractUnit.deleteMany({ where: { contractId: { in: made.contracts } } });
  await prisma.contract.deleteMany({ where: { id: { in: made.contracts } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: made.units } } });
  await prisma.projectFloor.deleteMany({ where: { buildingId: { in: made.buildings } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: made.buildings } } });
  for (const list of Object.values(made)) list.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("finance.unit-installments", () => {
  describe("idempotency", () => {
    it("announces an overdue installment once, and audits the unit becoming Overdue once, as the system", async () => {
      const fixture = await sale(COMPANY_A, [{ days: -3, amount: 30000, paid: 10000 }, { days: -1, amount: 20000 }, { days: 60, amount: 50000 }]);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect((first.detail as { overdue: number }).overdue).toBeGreaterThanOrEqual(2);
      expect(second.detail).toMatchObject({ overdue: 0, dueSoon: 0 });
      expect(await events(fixture.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(2);
      const audits = await prisma.auditEvent.findMany({ where: { entityId: fixture.contractId, actionKey: "UNIT_FINANCIAL_STATUS_CHANGED" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM" });
      // Derived, never stored: the installments are untouched.
      expect(await prisma.paymentInstallment.count({ where: { contractId: fixture.contractId, updatedAt: { gt: new Date(Date.now() - 60_000) } } })).toBe(3);
    });

    it("announces an installment due within the week once per due date, and never a paid one or a later one", async () => {
      const fixture = await sale(COMPANY_A, [{ days: 3, amount: 10000 }, { days: 2, amount: 5000, paid: 5000 }, { days: 30, amount: 90000 }]);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const due = await events(fixture.unitId, "UNIT_INSTALLMENT_DUE_SOON");
      expect(due).toHaveLength(1);
      // Counted from the company's own day, so three or four days depending on the hour and zone.
      expect(due[0]!.payloadJson).toMatchObject({ installmentId: fixture.installments[0], dueLabel: expect.stringMatching(/^in [34] days$/) });

      // A new due date earns its own announcement.
      await prisma.paymentInstallment.update({ where: { id: fixture.installments[0] }, data: { dueDate: new Date(Date.now() + 5 * DAY) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(fixture.unitId, "UNIT_INSTALLMENT_DUE_SOON")).toHaveLength(2);
      expect(await statusAudits(fixture.contractId)).toBe(0);
    });

    it("leaves a contract that no longer sells the unit alone (§82)", async () => {
      const fixture = await sale(COMPANY_A, [{ days: -2, amount: 10000 }]);
      await prisma.contractUnit.updateMany({ where: { contractId: fixture.contractId }, data: { releasedAt: new Date() } });
      await prisma.contract.update({ where: { id: fixture.contractId }, data: { status: "TERMINATED" } });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(fixture.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("announces once when a second run reaches the installment while the first is announcing it", async () => {
      const fixture = await sale(COMPANY_A, [{ days: -4, amount: 10000 }]);
      let second: Promise<unknown> | undefined;
      beforeNoticeAbout(fixture.unitId, async () => {
        if (second) return;
        second = invokeJob(JOB, { companyIds: [COMPANY_A] });
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second;

      expect(await events(fixture.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);
      expect(await statusAudits(fixture.contractId)).toBe(1);
    });
  });

  describe("company isolation", () => {
    it("announces only for the companies it is run for", async () => {
      const a = await sale(COMPANY_A, [{ days: -2, amount: 10000 }]);
      const b = await sale(COMPANY_B, [{ days: -2, amount: 10000 }]);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(a.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);
      expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);
      expect(await prisma.jobIdempotencyKey.count({ where: { companyId: COMPANY_B, jobKey: JOB } })).toBe(0);

      await withModule(COMPANY_B, "finance", true, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
      expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company and one with Projects or Finance switched off, then catches up", async () => {
      const b = await sale(COMPANY_B, [{ days: -2, amount: 10000 }]);

      // Company B runs with Finance switched off (PRD #9 §13).
      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);
      await withModule(COMPANY_B, "finance", true, async () => {
        await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
        expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);
        await withModule(COMPANY_B, "projects", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
        expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);

        await invokeJob(JOB, { companyIds: [COMPANY_B] });
        expect(await events(b.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);
      });
    });
  });

  describe("failure", () => {
    it("rolls one announcement back whole, sends the rest, reports a partial failure and sends it on the next run", async () => {
      const broken = await sale(COMPANY_A, [{ days: -2, amount: 10000 }]);
      const healthy = await sale(COMPANY_A, [{ days: -2, amount: 10000 }]);
      beforeNoticeAbout(broken.unitId, async () => {
        throw new Error("outbox unavailable");
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await events(broken.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(0);
      expect(await prisma.jobIdempotencyKey.count({ where: { jobKey: JOB, key: `overdue:${broken.installments[0]}` } })).toBe(0);
      expect(await statusAudits(broken.contractId)).toBe(0);
      expect(await events(healthy.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(broken.unitId, "UNIT_INSTALLMENT_OVERDUE")).toHaveLength(1);
    });
  });
});
