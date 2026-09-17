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
 * Job `sales.unit-reservations` (E-05E §25, §51, §52, §60; PRD #51 §173-§181):
 * an active reservation past its expiry expires once and frees its unit, as the
 * system; one expiring within a day warns the salesperson and the deal owner once
 * per expiry date — however often the job runs, and whether or not two runs
 * overlap.
 */

const JOB = "sales.unit-reservations";
const EVENTS = ["UNIT_RESERVATION_EXPIRED", "UNIT_RESERVATION_EXPIRING"];
const RUN = `t05e${Date.now().toString(36)}`;
const HOUR = 3_600_000;
const FIXTURE: Record<string, { projectId: string; client: string; seller: string; typeCode: string }> = {
  [COMPANY_A]: { projectId: "project_c", client: "client_acme", seller: "member_sales", typeCode: "APARTMENT" },
  [COMPANY_B]: { projectId: "project_b_one", client: "client_b_muc", seller: "member_owner_b", typeCode: "OFFICE" },
};

const enqueue = vi.mocked(enqueueNotificationEvent);
let realEnqueue: typeof enqueueNotificationEvent;
let restoreTrail: () => Promise<void>;
const made = { buildings: [] as string[], units: [] as string[], deals: [] as string[] };
let serial = 0;

/** A reserved unit with an active reservation expiring `hours` from now. */
async function reservation(companyId: string, hours: number): Promise<{ unitId: string; reservationId: string }> {
  const fixture = FIXTURE[companyId]!;
  serial += 1;
  const tag = `${RUN}${serial}`;
  const building = await prisma.projectBuilding.create({ data: { id: `${tag}_b`, companyId, projectId: fixture.projectId, name: `Job ${tag}`, nameKey: `JOB ${tag}`.toUpperCase(), sortOrder: 99, createdBy: "test" } });
  made.buildings.push(building.id);
  const floor = await prisma.projectFloor.create({ data: { id: `${tag}_f`, companyId, projectId: fixture.projectId, buildingId: building.id, levelType: "STANDARD", number: 1, name: "Floor 1", floorKey: "STANDARD:1", sortOrder: 1, createdBy: "test" } });
  const type = await prisma.projectUnitType.findFirstOrThrow({ where: { companyId, code: fixture.typeCode }, select: { id: true } });
  const unit = await prisma.projectUnit.create({ data: { id: `${tag}_u`, companyId, projectId: fixture.projectId, floorId: floor.id, unitCode: `J-${tag}`, unitCodeKey: `J-${tag}`.toUpperCase(), unitTypeId: type.id, sortOrder: 1, createdBy: "test", publicationStatus: "PUBLISHED" } });
  made.units.push(unit.id);
  const deal = await prisma.opportunity.create({ data: { id: `${tag}_o`, companyId, name: `Job deal ${tag}`, clientId: fixture.client, ownerMemberId: fixture.seller, stage: "NEGOTIATION", estimatedValue: "100000", currency: "EUR", createdByMemberId: fixture.seller } });
  made.deals.push(deal.id);
  await prisma.unitCommercialProfile.create({ data: { companyId, projectId: fixture.projectId, unitId: unit.id, status: "RESERVED", askingPrice: "100000", currency: "EUR" } });
  const reserved = await prisma.unitReservation.create({
    data: { companyId, projectId: fixture.projectId, unitId: unit.id, clientId: fixture.client, opportunityId: deal.id, reservedAt: new Date(Date.now() - 10 * 24 * HOUR), expiresAt: new Date(Date.now() + hours * HOUR), createdByMemberId: fixture.seller },
  });
  return { unitId: unit.id, reservationId: reserved.id };
}

const state = async (fixture: { unitId: string; reservationId: string }) => ({
  reservation: (await prisma.unitReservation.findUniqueOrThrow({ where: { id: fixture.reservationId }, select: { status: true } })).status,
  unit: (await prisma.unitCommercialProfile.findUniqueOrThrow({ where: { unitId: fixture.unitId }, select: { status: true } })).status,
});
const events = (unitId: string, eventType: string) => prisma.notificationEventOutbox.findMany({ where: { entityType: "project_unit", entityId: unitId, eventType } });

/** Runs `first` inside the job's transaction, just before the notice about `unitId` is enqueued. */
function beforeNoticeAbout(unitId: string, first: () => Promise<void>) {
  enqueue.mockImplementation(async (tx, input) => {
    if (input.entityId === unitId) await first();
    return realEnqueue(tx, input);
  });
}

/** Starts a second run while the first, inside its transaction, is about to tell people about `unitId`. */
function overlapWhileNoticeAbout(unitId: string): () => Promise<unknown> {
  let second: Promise<unknown> | undefined;
  beforeNoticeAbout(unitId, async () => {
    if (second) return;
    second = invokeJob(JOB, { companyIds: [COMPANY_A] });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  return async () => second;
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
  const units = made.units;
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: units } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: units } } });
  await prisma.unitCommercialStatusHistory.deleteMany({ where: { unitId: { in: units } } });
  await prisma.unitReservation.deleteMany({ where: { unitId: { in: units } } });
  await prisma.unitCommercialProfile.deleteMany({ where: { unitId: { in: units } } });
  await prisma.opportunity.deleteMany({ where: { id: { in: made.deals } } });
  await prisma.projectUnit.deleteMany({ where: { id: { in: units } } });
  await prisma.projectFloor.deleteMany({ where: { buildingId: { in: made.buildings } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: made.buildings } } });
  for (const list of Object.values(made)) list.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sales.unit-reservations", () => {
  describe("idempotency", () => {
    it("expires a reservation past its date once, frees the unit, audits it as the system and tells the salesperson once", async () => {
      const fixture = await reservation(COMPANY_A, -2);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await state(fixture)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
      expect(first.detail).toMatchObject({ expired: expect.any(Number) });
      expect((first.detail as { expired: number }).expired).toBeGreaterThanOrEqual(1);
      expect(second.detail).toMatchObject({ expired: 0 });
      expect(await events(fixture.unitId, "UNIT_RESERVATION_EXPIRED")).toHaveLength(1);
      const audit = await prisma.auditEvent.findMany({ where: { entityId: fixture.unitId, actionKey: "UNIT_RESERVATION_EXPIRED" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM", actorDisplayNameSnapshot: `System (${JOB})` });
      expect(await prisma.unitCommercialStatusHistory.findFirst({ where: { unitId: fixture.unitId } })).toMatchObject({ fromStatus: "RESERVED", toStatus: "FOR_SALE", source: "SYSTEM_EXPIRY", actorMemberId: null });
    });

    it("warns once a day before, again only when the expiry moves, and leaves a later reservation alone", async () => {
      const soon = await reservation(COMPANY_A, 5);
      const later = await reservation(COMPANY_A, 72);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(soon.unitId, "UNIT_RESERVATION_EXPIRING")).toHaveLength(1);
      expect(await events(later.unitId, "UNIT_RESERVATION_EXPIRING")).toHaveLength(0);
      expect(await state(soon)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });

      // An extension clears the warning and moves the date: the new date earns its own.
      await prisma.unitReservation.update({ where: { id: soon.reservationId }, data: { expiresAt: new Date(Date.now() + 20 * HOUR), expiryWarnedAt: null } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await events(soon.unitId, "UNIT_RESERVATION_EXPIRING")).toHaveLength(2);
    });

    it("never expires a reservation extended after the job read it (§25)", async () => {
      const first = await reservation(COMPANY_A, -1);
      const extended = await reservation(COMPANY_A, -1);
      // While the job tells people about the first, a salesperson extends the second, which the job has already read as expired.
      beforeNoticeAbout(first.unitId, async () => {
        await prisma.unitReservation.update({ where: { id: extended.reservationId }, data: { expiresAt: new Date(Date.now() + 48 * HOUR) } });
      });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await state(first)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
      expect(await state(extended)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });
      expect(await prisma.auditEvent.count({ where: { entityId: extended.unitId } })).toBe(0);
    });
  });

  describe("concurrency", () => {
    it("expires, audits and tells once when a second run reaches the reservation while the first is still expiring it", async () => {
      const fixture = await reservation(COMPANY_A, -3);
      const second = overlapWhileNoticeAbout(fixture.unitId);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await second();

      expect(await state(fixture)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
      expect(await events(fixture.unitId, "UNIT_RESERVATION_EXPIRED")).toHaveLength(1);
      expect(await prisma.auditEvent.count({ where: { entityId: fixture.unitId, actionKey: "UNIT_RESERVATION_EXPIRED" } })).toBe(1);
    });
  });

  describe("company isolation", () => {
    it("settles only the companies it is run for", async () => {
      const a = await reservation(COMPANY_A, -2);
      const b = await reservation(COMPANY_B, -2);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await state(a)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
      expect(await state(b)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });
      expect(await prisma.jobIdempotencyKey.count({ where: { companyId: COMPANY_B, jobKey: JOB, key: `expired:${b.reservationId}` } })).toBe(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await state(b)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company and one with Projects switched off, then catches up", async () => {
      const b = await reservation(COMPANY_B, -2);

      await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
      expect(await state(b)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });
      await withModule(COMPANY_B, "projects", false, () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
      expect(await state(b)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect(await state(b)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
    });
  });

  describe("failure", () => {
    it("rolls one reservation back whole, settles the rest, reports a partial failure and succeeds on the next run", async () => {
      const broken = await reservation(COMPANY_A, -2);
      const healthy = await reservation(COMPANY_A, -2);
      beforeNoticeAbout(broken.unitId, async () => {
        throw new Error("outbox unavailable");
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await state(broken)).toEqual({ reservation: "ACTIVE", unit: "RESERVED" });
      expect(await prisma.auditEvent.count({ where: { entityId: broken.unitId } })).toBe(0);
      expect(await prisma.jobIdempotencyKey.count({ where: { jobKey: JOB, key: `expired:${broken.reservationId}` } })).toBe(0);
      expect(await state(healthy)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });

      enqueue.mockImplementation(realEnqueue);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await state(broken)).toEqual({ reservation: "EXPIRED", unit: "FOR_SALE" });
    });
  });
});
