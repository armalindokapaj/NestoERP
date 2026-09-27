import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as notifications from "@/lib/core/notifications/notification.service";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `announcements.schedule` (PRD #51 §51, §52, §76-§78, §145, §149, §186).
 *
 * Every announcement here is written straight into the table with its own id
 * and removed after the test with the audit, outbox and attention it caused.
 * The seeded schedule is "days from now" at seed time, so on a database
 * seeded a few days ago it has come due. Any schedule this file did not write
 * is moved a year ahead for the file's duration and put back afterwards, so a
 * run publishes only what the test wrote.
 */

const JOB = "announcements.schedule";
const PREFIX = `jobtest_announce_schedule_${process.pid}_${Date.now().toString(36)}`;
const AUTHOR: Record<string, string> = { [COMPANY_A]: "member_hr", [COMPANY_B]: "member_owner_b", [COMPANY_SUSPENDED]: "member_suspended_company" };
const MINUTE = 60_000;
const created: string[] = [];

async function announcement(companyId: string, data: Partial<Prisma.AnnouncementUncheckedCreateInput>): Promise<string> {
  const id = `${PREFIX}_${created.length + 1}`;
  created.push(id);
  await prisma.announcement.create({
    data: { id, companyId, title: `Schedule contract ${created.length}`, body: "Written by the job contract test.", priority: "IMPORTANT", audienceType: "COMPANY", authorMemberId: AUTHOR[companyId], ...data },
  });
  return id;
}

const scheduled = (companyId: string, data: Partial<Prisma.AnnouncementUncheckedCreateInput> = {}) =>
  announcement(companyId, { status: "SCHEDULED", publishAt: new Date(Date.now() - MINUTE), ...data });

const row = (id: string) => prisma.announcement.findUniqueOrThrow({ where: { id }, select: { companyId: true, status: true, version: true, publishAt: true, publishedAt: true } });
const audits = (id: string, actionKey: string) => prisma.auditEvent.findMany({ where: { entityId: id, actionKey }, select: { companyId: true, actorType: true, actorDisplayNameSnapshot: true, beforeJson: true, afterJson: true } });
const events = (id: string) => prisma.notificationEventOutbox.findMany({ where: { entityType: "announcement", entityId: id }, select: { companyId: true, eventType: true } });

afterEach(async () => {
  vi.restoreAllMocks();
  const ids = created.splice(0);
  await prisma.attentionItem.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.announcement.deleteMany({ where: { id: { in: ids } } });
});

const parked: Array<{ id: string; publishAt: Date | null }> = [];

beforeAll(async () => {
  const seeded = await prisma.announcement.findMany({ where: { status: "SCHEDULED", NOT: { id: { startsWith: "jobtest_" } } }, select: { id: true, publishAt: true } });
  for (const row of seeded) {
    parked.push(row);
    await prisma.announcement.update({ where: { id: row.id }, data: { publishAt: new Date(Date.now() + 365 * 24 * 60 * MINUTE) } });
  }
});

afterAll(async () => {
  for (const row of parked) await prisma.announcement.update({ where: { id: row.id }, data: { publishAt: row.publishAt } });
  await prisma.$disconnect();
});

describe("announcements.schedule", () => {
  describe("idempotency", () => {
    it("publishes a due schedule once however often it runs: one transition, one audit entry, one notification", async () => {
      const id = await scheduled(COMPANY_A);

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(first.detail).toMatchObject({ published: 1 });
      expect(second.detail).toMatchObject({ published: 0 });
      expect(await row(id)).toMatchObject({ status: "PUBLISHED", version: 2 });
      const published = await audits(id, "ANNOUNCEMENT_PUBLISHED");
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ actorType: "SYSTEM", actorDisplayNameSnapshot: `System (${JOB})` });
      expect(await events(id)).toEqual([{ companyId: COMPANY_A, eventType: "ANNOUNCEMENT_PUBLISHED" }]);
    });

    it("returns a schedule that expired before it went out to draft once, cleared and audited as the system", async () => {
      const publishAt = new Date(Date.now() - 120 * MINUTE);
      const id = await scheduled(COMPANY_A, { publishAt, expiresAt: new Date(Date.now() - 60 * MINUTE) });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(first.detail).toMatchObject({ published: 0, returnedToDraft: 1 });
      expect(await row(id)).toMatchObject({ status: "DRAFT", publishAt: null, publishedAt: null, version: 2 });
      const unscheduled = await audits(id, "ANNOUNCEMENT_SCHEDULED");
      expect(unscheduled).toHaveLength(1);
      expect(unscheduled[0]).toMatchObject({
        actorType: "SYSTEM",
        beforeJson: expect.objectContaining({ status: "SCHEDULED", publishAt: publishAt.toISOString() }),
        afterJson: expect.objectContaining({ status: "DRAFT", publishAt: null }),
      });
      expect(await audits(id, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(0);
      expect(await events(id)).toEqual([]);
    });

    it("expires a published announcement once", async () => {
      const id = await announcement(COMPANY_A, { status: "PUBLISHED", publishedAt: new Date(Date.now() - 180 * MINUTE), expiresAt: new Date(Date.now() - MINUTE) });

      const first = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(first.detail).toMatchObject({ expired: 1 });
      expect(second.detail).toMatchObject({ expired: 0 });
      expect((await row(id)).status).toBe("EXPIRED");
      expect(await audits(id, "ANNOUNCEMENT_EXPIRED")).toHaveLength(1);
    });
  });

  describe("concurrency", () => {
    it("two workers publishing the same announcement make one transition, one outbox event and one audit entry (§186)", async () => {
      const id = await scheduled(COMPANY_A);

      const results = await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A] }), invokeJob(JOB, { companyIds: [COMPANY_A] })]);

      expect(results.map((result) => (result.detail as { published: number }).published).sort()).toEqual([0, 1]);
      expect(await row(id)).toMatchObject({ status: "PUBLISHED", version: 2 });
      expect(await audits(id, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(1);
      expect(await events(id)).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("a run for company A publishes only A's schedule, and each company's audit and events carry its own id", async () => {
      const inA = await scheduled(COMPANY_A);
      const inB = await scheduled(COMPANY_B);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await row(inA)).status).toBe("PUBLISHED");
      expect((await row(inB)).status).toBe("SCHEDULED");
      expect(await audits(inB, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect((await row(inB)).status).toBe("PUBLISHED");
      expect((await audits(inA, "ANNOUNCEMENT_PUBLISHED")).map((entry) => entry.companyId)).toEqual([COMPANY_A]);
      expect((await audits(inB, "ANNOUNCEMENT_PUBLISHED")).map((entry) => entry.companyId)).toEqual([COMPANY_B]);
      expect((await events(inB)).map((event) => event.companyId)).toEqual([COMPANY_B]);
    });
  });

  describe("suspended company", () => {
    it("leaves a suspended company's schedule waiting, and publishes it once the company is active again", async () => {
      const id = await scheduled(COMPANY_SUSPENDED);

      await withCompanyStatus(COMPANY_SUSPENDED, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));
      expect(await row(id)).toMatchObject({ status: "SCHEDULED", version: 1 });
      expect(await audits(id, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(0);

      await withCompanyStatus(COMPANY_SUSPENDED, "ACTIVE", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));
      expect((await row(id)).status).toBe("PUBLISHED");
      expect(await audits(id, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(1);
    });
  });

  describe("announcements switched off", () => {
    it("leaves a schedule waiting while the company has announcements off, and publishes it once they are on again", async () => {
      const id = await scheduled(COMPANY_A);
      const settings = await prisma.productivitySettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });
      await prisma.productivitySettings.update({ where: { companyId: COMPANY_A }, data: { announcementsEnabled: false } });
      try {
        const off = await invokeJob(JOB, { companyIds: [COMPANY_A] });
        expect(off.detail).toMatchObject({ published: 0 });
        expect(await row(id)).toMatchObject({ status: "SCHEDULED", version: 1 });
        expect(await events(id)).toEqual([]);
      } finally {
        await prisma.productivitySettings.update({ where: { companyId: COMPANY_A }, data: { announcementsEnabled: settings.announcementsEnabled } });
      }

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await row(id)).toMatchObject({ status: "PUBLISHED" });
    });
  });

  describe("failure", () => {
    it("publishes the schedules behind one that fails, leaves the failed one untouched, and fails the run", async () => {
      // The failing one is due first, where the old worker's front-of-queue retry would have stood in the way.
      const failing = await scheduled(COMPANY_A, { publishAt: new Date(Date.now() - 10 * MINUTE) });
      const healthy = await scheduled(COMPANY_A, { publishAt: new Date(Date.now() - 5 * MINUTE) });
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.entityId === failing) throw new Error("contract test: outbox unavailable for this announcement");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect((await row(healthy)).status).toBe("PUBLISHED");
      expect(await events(healthy)).toHaveLength(1);
      // The failed transaction left nothing behind: not published, not audited, nothing enqueued.
      expect(await row(failing)).toMatchObject({ status: "SCHEDULED", version: 1, publishedAt: null });
      expect(await audits(failing, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(0);
      expect(await events(failing)).toHaveLength(0);

      vi.restoreAllMocks();
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await row(failing)).status).toBe("PUBLISHED");
      expect(await audits(failing, "ANNOUNCEMENT_PUBLISHED")).toHaveLength(1);
    });

    it("still reaches the next company when one company's run fails", async () => {
      const inA = await scheduled(COMPANY_A);
      const inB = await scheduled(COMPANY_B);
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.companyId === COMPANY_A) throw new Error("contract test: company A cannot enqueue");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A, COMPANY_B] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect((await row(inA)).status).toBe("SCHEDULED");
      expect((await row(inB)).status).toBe("PUBLISHED");
    });
  });
});
