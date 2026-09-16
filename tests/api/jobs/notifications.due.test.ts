import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as notifications from "@/lib/core/notifications/notification.service";
import { prisma, PROJECT } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus, withModule } from "./job-harness";
import { rememberTrail } from "./reminder-trail";

/**
 * `notifications.due` (PRD #38 §50, §74, PRD #51 §15-§19, §48, §133-§135, §183).
 *
 * The job is run on a clock of its own, a day in 2031, so its window holds the
 * fixtures and nothing seeded. Tasks and obligations are made directly, in
 * companies A (Tirane) and B (Berlin); they, and every ledger row and outbox
 * event the runs add, are removed after each test.
 */

const JOB = "notifications.due";
const HOUR = 3_600_000;
const DAY = 86_400_000;
const PREFIX = `jobtest_due_${process.pid}_${Date.now().toString(36)}`;
/** Midday in Tirane and Berlin, 14 May 2031. */
const NOW = new Date("2031-05-14T10:00:00.000Z");
const createdTasks: string[] = [];
const createdObligations: string[] = [];
let counter = 0;
let forgetTrail: () => Promise<void>;

beforeEach(async () => {
  forgetTrail = await rememberTrail(JOB, ["TASK_OVERDUE", "CONTRACT_OBLIGATION_DUE"]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await forgetTrail();
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  await prisma.contractObligation.deleteMany({ where: { id: { in: createdObligations } } });
  createdTasks.length = 0;
  createdObligations.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (date: string) => new Date(`${date}T00:00:00.000Z`);

async function task(companyId: string, dueDate: string) {
  counter += 1;
  const people = companyId === COMPANY_A ? { member: "member_engineer", creator: "member_pm", user: "user_pm", projectId: PROJECT.a } : { member: "member_owner_b", creator: "member_owner_b", user: "user_owner_b", projectId: PROJECT.companyB };
  const row = await prisma.task.create({
    data: { companyId, projectId: people.projectId, title: `${PREFIX} ${counter}`, assigneeMemberId: people.member, createdByMemberId: people.creator, createdBy: people.user, dueDate: at(dueDate) },
  });
  createdTasks.push(row.id);
  return row.id;
}

async function obligation(dueDate: string) {
  counter += 1;
  const row = await prisma.contractObligation.create({
    data: { companyId: COMPANY_A, contractId: "contract_001", title: `${PREFIX} ${counter}`, obligationType: "DELIVERABLE", responsibleMemberId: "member_legal", createdByMemberId: "member_legal", dueDate: new Date(`${dueDate}T12:00:00.000Z`) },
  });
  createdObligations.push(row.id);
  return row.id;
}

const events = (entityId: string) =>
  prisma.notificationEventOutbox.findMany({ where: { entityId }, select: { companyId: true, eventType: true, payloadJson: true }, orderBy: { createdAt: "asc" } });

/** An hourly run: the window starts where the previous one ended. */
const hourly = (now: Date, companyIds?: string[]) => invokeJob(JOB, { now, lastSuccessAt: new Date(now.getTime() - HOUR), companyIds });

describe("notifications.due", () => {
  describe("idempotency", () => {
    it("enqueues an overdue task once for its due date however many hourly windows cover it, and again for a new due date (§183)", async () => {
      const taskId = await task(COMPANY_A, "2031-05-13");

      const first = await hourly(NOW, [COMPANY_A]);
      await hourly(new Date(NOW.getTime() + HOUR), [COMPANY_A]);
      await invokeJob(JOB, { now: new Date(NOW.getTime() + 2 * HOUR), lastSuccessAt: new Date(NOW.getTime() - 2 * DAY), companyIds: [COMPANY_A] });
      expect(first.detail).toMatchObject({ tasksOverdue: 1 });
      expect(await events(taskId)).toEqual([{ companyId: COMPANY_A, eventType: "TASK_OVERDUE", payloadJson: expect.objectContaining({ dueDate: "2031-05-13", assigneeMemberId: "member_engineer" }) }]);

      // Moved and missed again: a new episode, told once more.
      await prisma.task.update({ where: { id: taskId }, data: { dueDate: at("2031-05-12") } });
      await invokeJob(JOB, { now: NOW, lastSuccessAt: new Date(NOW.getTime() - 3 * DAY), companyIds: [COMPANY_A] });
      await invokeJob(JOB, { now: NOW, lastSuccessAt: new Date(NOW.getTime() - 3 * DAY), companyIds: [COMPANY_A] });
      expect((await events(taskId)).map((row) => (row.payloadJson as { dueDate: string }).dueDate)).toEqual(["2031-05-13", "2031-05-12"]);
    });

    it("enqueues an obligation coming due once, not once per sweep", async () => {
      const obligationId = await obligation("2031-05-21");
      await hourly(NOW, [COMPANY_A]);
      await hourly(new Date(NOW.getTime() + HOUR), [COMPANY_A]);
      expect(await events(obligationId)).toEqual([{ companyId: COMPANY_A, eventType: "CONTRACT_OBLIGATION_DUE", payloadJson: expect.objectContaining({ dueDate: "2031-05-21", responsibleMemberId: "member_legal" }) }]);
    });

    it("takes today from the company's timezone, not the server's (§48)", async () => {
      const taskId = await task(COMPANY_A, "2031-05-14");
      // 23:30 UTC on the 14th is 01:30 on the 15th in Tirane: the task is a day overdue there.
      await hourly(new Date("2031-05-14T21:30:00.000Z"), [COMPANY_A]);
      expect(await events(taskId)).toEqual([]);
      await hourly(new Date("2031-05-14T23:30:00.000Z"), [COMPANY_A]);
      expect(await events(taskId)).toHaveLength(1);
    });
  });

  describe("concurrency", () => {
    it("two sweeps at once enqueue each reminder once (§175)", async () => {
      const taskId = await task(COMPANY_A, "2031-05-13");
      const obligationId = await obligation("2031-05-21");
      await Promise.all([hourly(NOW, [COMPANY_A]), hourly(NOW, [COMPANY_A])]);
      expect(await events(taskId)).toHaveLength(1);
      expect(await events(obligationId)).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("reminds only the companies it is run for, each about its own records (§180)", async () => {
      const taskA = await task(COMPANY_A, "2031-05-13");
      const taskB = await task(COMPANY_B, "2031-05-13");

      await hourly(NOW, [COMPANY_A]);
      expect((await events(taskA)).map((row) => row.companyId)).toEqual([COMPANY_A]);
      expect(await events(taskB)).toEqual([]);

      await hourly(NOW);
      expect((await events(taskB)).map((row) => row.companyId)).toEqual([COMPANY_B]);
      expect((await events(taskA)).map((row) => row.companyId)).toEqual([COMPANY_A]);
    });

    it("tells a company nothing about a module it switched off", async () => {
      const taskId = await task(COMPANY_A, "2031-05-13");
      const obligationId = await obligation("2031-05-21");
      await withModule(COMPANY_A, "tasks", false, () => hourly(NOW, [COMPANY_A]));
      expect(await events(taskId)).toEqual([]);
      expect(await events(obligationId)).toHaveLength(1);
    });
  });

  describe("suspended company", () => {
    it("skips a suspended company, and claims nothing that would silence it once reactivated (§145, §181)", async () => {
      const taskId = await task(COMPANY_B, "2031-05-13");
      const skipped = await withCompanyStatus(COMPANY_B, "SUSPENDED", () => hourly(NOW, [COMPANY_B]));
      expect(skipped).toMatchObject({ processed: 0 });
      expect(await events(taskId)).toEqual([]);
      expect(await prisma.jobIdempotencyKey.count({ where: { jobKey: JOB, companyId: COMPANY_B, key: { contains: taskId } } })).toBe(0);

      await hourly(NOW, [COMPANY_B]);
      expect(await events(taskId)).toHaveLength(1);
    });
  });

  describe("failure", () => {
    it("enqueues every other reminder when one fails, leaves the failed one unclaimed, and fails the run", async () => {
      const failing = await task(COMPANY_A, "2031-05-13");
      const other = await task(COMPANY_A, "2031-05-13");
      const enqueue = notifications.enqueueNotificationEvent;
      vi.spyOn(notifications, "enqueueNotificationEvent").mockImplementation(async (tx, input) => {
        if (input.entityId === failing) throw new Error("contract test: outbox unavailable for this task");
        return enqueue(tx, input);
      });

      await expect(hourly(NOW, [COMPANY_A])).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect(await events(other)).toHaveLength(1);
      expect(await events(failing)).toEqual([]);
      expect(await prisma.jobIdempotencyKey.count({ where: { jobKey: JOB, key: { contains: failing } } })).toBe(0);

      vi.restoreAllMocks();
      await hourly(new Date(NOW.getTime() + HOUR), [COMPANY_A]);
      expect(await events(failing)).toHaveLength(1);
      expect(await events(other)).toHaveLength(1);
    });
  });
});
