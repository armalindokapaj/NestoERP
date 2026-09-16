import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as notifications from "@/lib/core/notifications/notification.service";
import { prisma } from "../../helpers";
import { clearIdempotencyKeys, COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `announcements.reminders` (PRD #51 §15-§19, §133-§138, §145, §183).
 *
 * Each announcement here was published four days before the clock the job is
 * given, so with the seeded three-day period it is in its first reminder
 * round. Acknowledgment-required announcements already in the database may be
 * reminded by the same runs; whatever those runs enqueue or claim for them is
 * removed with this file's own rows.
 */

const JOB = "announcements.reminders";
const PREFIX = `jobtest_announce_remind_${process.pid}_${Date.now().toString(36)}`;
const DAY = 86_400_000;
const AUTHOR: Record<string, string> = { [COMPANY_A]: "member_hr", [COMPANY_B]: "member_owner_b", [COMPANY_SUSPENDED]: "member_suspended_company" };
const created: string[] = [];
let startedAt: Date;

async function awaitingAcknowledgment(companyId: string, targets: string[], acknowledged: string[] = [], data: Partial<Prisma.AnnouncementUncheckedCreateInput> = {}): Promise<string> {
  const id = `${PREFIX}_${created.length + 1}`;
  created.push(id);
  const publishedAt = new Date(Date.now() - 4 * DAY);
  await prisma.announcement.create({
    data: { id, companyId, title: `Reminder contract ${created.length}`, body: "Written by the job contract test.", status: "PUBLISHED", priority: "IMPORTANT", audienceType: "COMPANY", authorMemberId: AUTHOR[companyId], requiresAcknowledgment: true, publishedAt, ...data },
  });
  await prisma.announcementTarget.createMany({ data: targets.map((memberId) => ({ announcementId: id, memberId, targetedAt: publishedAt })) });
  await prisma.announcementAcknowledgment.createMany({ data: acknowledged.map((memberId) => ({ announcementId: id, memberId, acknowledgedAt: new Date() })) });
  return id;
}

const reminders = (id: string) =>
  prisma.notificationEventOutbox.findMany({ where: { eventType: "ANNOUNCEMENT_REMINDER", entityId: id }, orderBy: { createdAt: "asc" }, select: { companyId: true, payloadJson: true } });
const claimed = (companyId: string, id: string) => prisma.jobIdempotencyKey.findMany({ where: { companyId, jobKey: JOB, key: { startsWith: `${id}:` } }, select: { key: true } });
const payload = (row: { payloadJson: Prisma.JsonValue }) => row.payloadJson as { memberIds: string[]; round: string };

beforeAll(() => {
  startedAt = new Date();
});

afterEach(async () => {
  vi.restoreAllMocks();
  const ids = created.splice(0);
  await clearIdempotencyKeys(JOB, ids.map((id) => `${id}:`));
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: JOB, createdAt: { gte: startedAt } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { eventType: "ANNOUNCEMENT_REMINDER", createdAt: { gte: startedAt } } });
  await prisma.notification.deleteMany({ where: { entityType: "announcement", entityId: { in: ids } } });
  await prisma.announcement.deleteMany({ where: { id: { in: ids } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("announcements.reminders", () => {
  describe("idempotency", () => {
    it("reminds a round once however often it runs, and only those who have not acknowledged", async () => {
      const id = await awaitingAcknowledgment(COMPANY_A, ["member_engineer", "member_architect", "member_pm"], ["member_engineer"]);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });

      const sent = await reminders(id);
      expect(sent).toHaveLength(1);
      expect(payload(sent[0]).round).toBe("1");
      expect(payload(sent[0]).memberIds.sort()).toEqual(["member_architect", "member_pm"]);
      expect(await claimed(COMPANY_A, id)).toEqual([{ key: `${id}:1` }]);
    });

    it("does not remind the round again once retention has purged the first reminder from the outbox", async () => {
      const id = await awaitingAcknowledgment(COMPANY_A, ["member_architect"]);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await prisma.notificationEventOutbox.deleteMany({ where: { eventType: "ANNOUNCEMENT_REMINDER", entityId: id } });

      const again = await invokeJob(JOB, { companyIds: [COMPANY_A] });

      expect(await reminders(id)).toHaveLength(0);
      expect(again.processed).toBe(0);
    });

    it("reminds again in the next round", async () => {
      const id = await awaitingAcknowledgment(COMPANY_A, ["member_architect"]);
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(Date.now() + 3 * DAY) });

      expect((await reminders(id)).map((row) => payload(row).round)).toEqual(["1", "2"]);
    });
  });

  describe("concurrency", () => {
    it("two runs at once remind a round once", async () => {
      const id = await awaitingAcknowledgment(COMPANY_A, ["member_architect", "member_pm"]);

      await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A] }), invokeJob(JOB, { companyIds: [COMPANY_A] })]);

      expect(await reminders(id)).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("a run for company A reminds only A's announcement, and B's reminder and claim carry B's id", async () => {
      const inA = await awaitingAcknowledgment(COMPANY_A, ["member_architect"]);
      const inB = await awaitingAcknowledgment(COMPANY_B, ["member_multicompany_b"]);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await reminders(inA)).toHaveLength(1);
      expect(await reminders(inB)).toHaveLength(0);
      expect(await claimed(COMPANY_B, inB)).toHaveLength(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect((await reminders(inB)).map((row) => row.companyId)).toEqual([COMPANY_B]);
      expect(await claimed(COMPANY_B, inB)).toHaveLength(1);
      expect(await claimed(COMPANY_A, inB)).toHaveLength(0);
      expect(await reminders(inA)).toHaveLength(1);
    });
  });

  describe("suspended company", () => {
    it("reminds nobody in a suspended company, and reminds the current round once it is active again", async () => {
      const id = await awaitingAcknowledgment(COMPANY_SUSPENDED, ["member_suspended_company"]);

      await withCompanyStatus(COMPANY_SUSPENDED, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));
      expect(await reminders(id)).toHaveLength(0);
      expect(await claimed(COMPANY_SUSPENDED, id)).toHaveLength(0);

      await withCompanyStatus(COMPANY_SUSPENDED, "ACTIVE", () => invokeJob(JOB, { companyIds: [COMPANY_SUSPENDED] }));
      expect(await reminders(id)).toHaveLength(1);
    });
  });

  describe("failure", () => {
    it("reminds the announcements after one that fails, claims nothing for the failed one, and fails the run", async () => {
      // Published earlier, so it is read first.
      const failing = await awaitingAcknowledgment(COMPANY_A, ["member_architect"], [], { publishedAt: new Date(Date.now() - 5 * DAY) });
      const healthy = await awaitingAcknowledgment(COMPANY_A, ["member_architect"]);
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.entityId === failing) throw new Error("contract test: outbox unavailable for this announcement");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await reminders(healthy)).toHaveLength(1);
      // The claim rolled back with the enqueue, so the next run tries the round again.
      expect(await claimed(COMPANY_A, failing)).toHaveLength(0);

      vi.restoreAllMocks();
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await reminders(failing)).toHaveLength(1);
      expect(await reminders(healthy)).toHaveLength(1);
    });
  });
});
