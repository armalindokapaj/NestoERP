import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as notifications from "@/lib/core/notifications/notification.service";
import { prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

/**
 * `approvals.overdue` (PRD #41 §40, §228, PRD #51 §15-§19, §48, §133-§135).
 *
 * The fixtures are document reviews past their due date on seeded document
 * versions — two reviewers on one version where it matters — in companies A
 * (Tirane) and B (Berlin). The job runs on a fixed clock; it also reminds
 * people about seeded approvals overdue by then, and every ledger row and
 * outbox event its runs add is removed after each test with the reviews.
 */

const JOB = "approvals.overdue";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PREFIX = `jobtest_approvals_${process.pid}_${Date.now().toString(36)}`;
/** 10:00 in Tirane and Berlin on 10 September 2026. */
const NOW = new Date("2026-09-10T08:00:00.000Z");
const createdReviews: string[] = [];
let counter = 0;
let forgetTrail: () => Promise<void>;

beforeEach(async () => {
  forgetTrail = await rememberTrail(JOB, ["APPROVAL_OVERDUE"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await forgetTrail();
  await prisma.documentReview.deleteMany({ where: { id: { in: createdReviews } } });
  createdReviews.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function version(companyId: string) {
  return prisma.documentVersion.findFirstOrThrow({ where: { document: { companyId } }, select: { id: true, documentId: true }, orderBy: { id: "asc" } });
}

async function overdueReview(companyId: string, reviewerMemberId: string, requestedByMemberId: string, dueDate = "2026-09-08") {
  counter += 1;
  const { id: documentVersionId, documentId } = await version(companyId);
  const row = await prisma.documentReview.create({
    data: { companyId, documentId, documentVersionId, reviewerMemberId, requestedByMemberId, pendingKey: `${PREFIX}:${counter}`, dueAt: new Date(`${dueDate}T12:00:00.000Z`) },
  });
  createdReviews.push(row.id);
  return row;
}

async function reminders(reviewId: string) {
  const rows = await prisma.notificationEventOutbox.findMany({
    where: { eventType: "APPROVAL_OVERDUE", payloadJson: { path: ["approvalKey"], equals: `documents:${reviewId}` } },
    select: { companyId: true, entityId: true, payloadJson: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({ companyId: row.companyId, entityId: row.entityId, day: (row.payloadJson as { day: string }).day, approvers: (row.payloadJson as { approverMemberIds: string[] }).approverMemberIds }));
}

const claimed = (companyId: string, reviewId: string) => prisma.jobIdempotencyKey.count({ where: { companyId, jobKey: JOB, key: { startsWith: `documents:${reviewId}:` } } });

describe("approvals.overdue", () => {
  describe("idempotency", () => {
    it("reminds every reviewer of a version once a day, however often the hourly job runs", async () => {
      const architect = await overdueReview(COMPANY_A, "member_architect", "member_pm");
      const legal = await overdueReview(COMPANY_A, "member_legal", "member_pm");

      await invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW });
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(NOW.getTime() + HOUR) });
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(NOW.getTime() + 2 * HOUR) });
      // Both reviewers of the same document, not only the first (the bug a per-document key had).
      expect(await reminders(architect.id)).toEqual([{ companyId: COMPANY_A, entityId: architect.documentId, day: "2026-09-10", approvers: ["member_architect"] }]);
      expect(await reminders(legal.id)).toEqual([{ companyId: COMPANY_A, entityId: legal.documentId, day: "2026-09-10", approvers: ["member_legal"] }]);

      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(NOW.getTime() + DAY) });
      expect((await reminders(architect.id)).map((row) => row.day)).toEqual(["2026-09-10", "2026-09-11"]);
      expect((await reminders(legal.id)).map((row) => row.day)).toEqual(["2026-09-10", "2026-09-11"]);
    });

    it("counts the day in the company's timezone (§48)", async () => {
      const review = await overdueReview(COMPANY_A, "member_architect", "member_pm", "2026-09-09");
      // 22:30 UTC on the 9th is already the 10th in Tirane, when a review due on the 9th is overdue.
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date("2026-09-09T21:30:00.000Z") });
      expect(await reminders(review.id)).toEqual([]);
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date("2026-09-09T22:30:00.000Z") });
      expect((await reminders(review.id)).map((row) => row.day)).toEqual(["2026-09-10"]);
    });
  });

  describe("concurrency", () => {
    it("two runs at once remind each reviewer once (§175)", async () => {
      const architect = await overdueReview(COMPANY_A, "member_architect", "member_pm");
      const legal = await overdueReview(COMPANY_A, "member_legal", "member_pm");
      await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW }), invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW })]);
      expect(await reminders(architect.id)).toHaveLength(1);
      expect(await reminders(legal.id)).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("reminds only the companies it is run for, each within its own company (§180)", async () => {
      const reviewA = await overdueReview(COMPANY_A, "member_architect", "member_pm");
      const reviewB = await overdueReview(COMPANY_B, "member_owner_b", "member_viewer_b");

      await invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW });
      expect((await reminders(reviewA.id)).map((row) => row.companyId)).toEqual([COMPANY_A]);
      expect(await reminders(reviewB.id)).toEqual([]);
      expect(await claimed(COMPANY_B, reviewB.id)).toBe(0);

      await invokeJob(JOB, { now: NOW });
      expect(await reminders(reviewB.id)).toEqual([{ companyId: COMPANY_B, entityId: reviewB.documentId, day: "2026-09-10", approvers: ["member_owner_b"] }]);
      expect(await claimed(COMPANY_A, reviewB.id)).toBe(0);
      expect((await reminders(reviewA.id)).map((row) => row.companyId)).toEqual([COMPANY_A]);
    });

    it("reminds nobody about a module the company switched off", async () => {
      const review = await overdueReview(COMPANY_A, "member_architect", "member_pm");
      await withModule(COMPANY_A, "documents", false, () => invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW }));
      expect(await reminders(review.id)).toEqual([]);
      expect(await claimed(COMPANY_A, review.id)).toBe(0);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company and claims nothing for it (§145, §181)", async () => {
      const review = await overdueReview(COMPANY_B, "member_owner_b", "member_viewer_b");
      const skipped = await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_B], now: NOW }));
      expect(skipped).toMatchObject({ processed: 0 });
      expect(await reminders(review.id)).toEqual([]);
      expect(await claimed(COMPANY_B, review.id)).toBe(0);

      await invokeJob(JOB, { companyIds: [COMPANY_B], now: NOW });
      expect(await reminders(review.id)).toHaveLength(1);
    });
  });

  describe("failure", () => {
    it("reminds the other reviewers when one reminder fails, claims nothing for that one, and fails the run", async () => {
      const failing = await overdueReview(COMPANY_A, "member_architect", "member_pm");
      const other = await overdueReview(COMPANY_A, "member_legal", "member_pm");
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.payload.approvalKey === `documents:${failing.id}`) throw new Error("contract test: outbox unavailable for this review");
        return enqueue(tx, input);
      });

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A], now: NOW })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await reminders(other.id)).toHaveLength(1);
      expect(await reminders(failing.id)).toEqual([]);
      expect(await claimed(COMPANY_A, failing.id)).toBe(0);

      vi.restoreAllMocks();
      await invokeJob(JOB, { companyIds: [COMPANY_A], now: new Date(NOW.getTime() + HOUR) });
      expect(await reminders(failing.id)).toHaveLength(1);
      expect(await reminders(other.id)).toHaveLength(1);
    });
  });
});
