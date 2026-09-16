import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import {
  ATTENTION_PAGE_SIZE,
  attentionConditionDefinitions,
  attentionDedupeKey,
  findAttentionCondition,
  type AttentionConditionDefinition,
  type AttentionPage,
} from "@/lib/core/notifications/attention.conditions";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { prisma as client } from "@/lib/database/prisma";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, loginAs, loginAsEmail, prisma, PROJECT } from "../../helpers";
import { COMPANY_A, COMPANY_B, invokeJob, withCompanyStatus } from "./job-harness";

/**
 * `attention.reconcile` (PRD #51 §68-§70, §133-§138, §173-§184).
 *
 * The fixtures are overdue tasks made through the task service in companies A
 * and B, and "stale" items — active attention for records that do not exist,
 * which a pass must resolve unless something keeps it from reading the whole
 * condition. Every task, item, notification and outbox row made here is
 * removed after each test; a pass also reconciles the seeded companies'
 * attention, which is what the job is for.
 */

const JOB = "attention.reconcile";
const DAY = 86_400_000;
const PREFIX = `jobtest_attention_${process.pid}_${Date.now().toString(36)}`;
let counter = 0;
const createdTasks: string[] = [];
const createdItems: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdTasks.length > 0) {
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.subscription.deleteMany({ where: { thread: { parentId: { in: createdTasks } } } });
    await prisma.collaborationThread.deleteMany({ where: { parentId: { in: createdTasks } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
    await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
    createdTasks.length = 0;
  }
  if (createdItems.length > 0) {
    await prisma.attentionItem.deleteMany({ where: { id: { in: createdItems } } });
    createdItems.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function overdueTask(creator: UserContext, projectId: string, assigneeMemberId: string, daysOverdue = 3) {
  counter += 1;
  const task = await tasks.createTask(creator, createTaskSchema.parse({ title: `${PREFIX} task ${counter}`, projectId, assigneeMemberId }));
  createdTasks.push(task.id);
  await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date(Date.now() - daysOverdue * DAY) } });
  return task.id;
}

/** Active attention for a record that does not exist: nothing true stands behind it. */
async function staleItem(companyId: string, recipientMemberId: string, conditionKey = "OVERDUE_TASK", entityType = "task", moduleKey = "tasks") {
  counter += 1;
  const entityId = `${PREFIX}_gone_${counter}`;
  const row = await prisma.attentionItem.create({
    data: {
      companyId,
      recipientMemberId,
      conditionKey,
      moduleKey,
      entityType,
      entityId,
      title: "Contract test",
      priority: "NORMAL",
      dedupeKey: `${conditionKey}:${entityType}:${entityId}:2026-01-01`,
      lastEvaluatedAt: new Date(Date.now() - DAY),
    },
  });
  createdItems.push(row.id);
  return row;
}

const itemsFor = (entityId: string) => prisma.attentionItem.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });
const statusOf = async (id: string) => (await prisma.attentionItem.findUniqueOrThrow({ where: { id } })).status;
const activeIds = async (companyId: string) =>
  (await prisma.attentionItem.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);

describe("attention.reconcile", () => {
  describe("idempotency", () => {
    it("raises one active item for a true condition, keeps that one item on the next run, and resolves it once false (§184)", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const first = await itemsFor(taskId);
      expect(first.map((item) => [item.recipientMemberId, item.status])).toEqual([["member_engineer", "ACTIVE"]]);

      const again = await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const second = await itemsFor(taskId);
      expect(second.map((item) => [item.id, item.status])).toEqual([[first[0].id, "ACTIVE"]]);
      // The item was re-evaluated, not rewritten.
      expect(second[0].lastEvaluatedAt.getTime()).toBeGreaterThan(first[0].lastEvaluatedAt.getTime());
      expect(again.detail).toMatchObject({ dryRun: false });

      // Changed behind the task service's back: only the pass can notice.
      await prisma.task.update({ where: { id: taskId }, data: { dueDate: new Date(Date.now() + 5 * DAY) } });
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await itemsFor(taskId)).map((item) => [item.id, item.status])).toEqual([[first[0].id, "RESOLVED"]]);
    });

    it("counts in a dry run and writes nothing (§165, §166)", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");
      const stale = await staleItem(COMPANY_A, "member_engineer");

      const dry = await invokeJob(JOB, { companyIds: [COMPANY_A], dryRun: true });
      expect(dry.detail).toMatchObject({ dryRun: true, companies: 1 });
      expect((dry.detail as { created: number }).created).toBeGreaterThanOrEqual(1);
      expect((dry.detail as { resolved: number }).resolved).toBeGreaterThanOrEqual(1);
      expect(await itemsFor(taskId)).toEqual([]);
      expect(await statusOf(stale.id)).toBe("ACTIVE");
      expect((await prisma.attentionItem.findUniqueOrThrow({ where: { id: stale.id } })).lastEvaluatedAt).toEqual(stale.lastEvaluatedAt);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await itemsFor(taskId)).map((item) => item.status)).toEqual(["ACTIVE"]);
      expect(await statusOf(stale.id)).toBe("RESOLVED");
    });
  });

  describe("company day", () => {
    it("counts a task overdue from the company's midnight, not the server's (§48, §159)", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");
      await prisma.task.update({ where: { id: taskId }, data: { dueDate: new Date("2026-09-09T00:00:00.000Z") } });
      const condition = findAttentionCondition("OVERDUE_TASK")!;
      // Company A keeps Tirane time: 21:30 UTC on the 9th is still the 9th there, 22:30 is the 10th.
      const beforeMidnight = new Date("2026-09-09T21:30:00.000Z");
      const afterMidnight = new Date("2026-09-09T22:30:00.000Z");

      expect(await condition.holds(COMPANY_A, "task", taskId, beforeMidnight)).toBe(false);
      expect(await condition.holds(COMPANY_A, "task", taskId, afterMidnight)).toBe(true);
      expect((await condition.collect(COMPANY_A, beforeMidnight)).some((candidate) => candidate.entityId === taskId)).toBe(false);
      expect((await condition.collect(COMPANY_A, afterMidnight)).some((candidate) => candidate.entityId === taskId)).toBe(true);
    });
  });

  describe("paging", () => {
    it("walks a condition longer than a page and resolves nothing still true beyond it (§133-§135)", async () => {
      const owner = await loginAs("OWNER");
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) ids.push(await overdueTask(owner, PROJECT.a, "member_engineer", 3 + index));
      await reconcileAttention({ companyId: COMPANY_A });
      const before = new Map((await prisma.attentionItem.findMany({ where: { entityId: { in: ids } } })).map((item) => [item.entityId, item]));
      expect([...before.values()].every((item) => item.status === "ACTIVE")).toBe(true);
      expect(before.size).toBe(5);

      // One of them stops being overdue; the pass reads two rows at a time.
      await prisma.task.update({ where: { id: ids[2] }, data: { dueDate: new Date(Date.now() + 5 * DAY) } });
      await reconcileAttention({ companyId: COMPANY_A, pageSize: 2 });

      const after = await prisma.attentionItem.findMany({ where: { entityId: { in: ids } } });
      expect(after).toHaveLength(5);
      for (const item of after) {
        expect(item.id).toBe(before.get(item.entityId)!.id);
        expect(item.status, item.entityId).toBe(item.entityId === ids[2] ? "RESOLVED" : "ACTIVE");
        // Every page was read: each item still true was marked by this pass.
        if (item.entityId !== ids[2]) expect(item.lastEvaluatedAt.getTime()).toBeGreaterThan(before.get(item.entityId)!.lastEvaluatedAt.getTime());
      }
    });

    it("reads every condition's records one row a page exactly as in one page", async () => {
      const owner = await loginAs("OWNER");
      await overdueTask(owner, PROJECT.a, "member_engineer");
      const now = new Date();
      const walk = async (definition: AttentionConditionDefinition, size: number) => {
        const keys: string[] = [];
        let cursor: string | null = null;
        do {
          const page: AttentionPage = await definition.page(COMPANY_A, now, cursor, size);
          keys.push(...page.candidates.map((candidate) => attentionDedupeKey(definition.key, candidate)));
          cursor = page.next;
        } while (cursor !== null);
        return keys.sort();
      };
      for (const definition of attentionConditionDefinitions()) {
        expect(await walk(definition, 1), definition.key).toEqual(await walk(definition, ATTENTION_PAGE_SIZE));
      }
    });
  });

  describe("concurrency", () => {
    it("two passes at once leave one active item per recipient and resolve nothing true (§175)", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");
      const stale = await staleItem(COMPANY_A, "member_engineer");

      await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A] }), invokeJob(JOB, { companyIds: [COMPANY_A] })]);
      expect((await itemsFor(taskId)).map((item) => [item.recipientMemberId, item.status])).toEqual([["member_engineer", "ACTIVE"]]);
      expect(await statusOf(stale.id)).toBe("RESOLVED");

      // What one pass settles, two passes racing each other leave exactly as it was.
      const settled = await activeIds(COMPANY_A);
      await Promise.all([invokeJob(JOB, { companyIds: [COMPANY_A] }), invokeJob(JOB, { companyIds: [COMPANY_A] })]);
      expect(await activeIds(COMPANY_A)).toEqual(settled);
    });

    it("keeps an item another pass inserted between its read and its insert, rather than resolving it", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");
      const insert = client.attentionItem.createManyAndReturn.bind(client.attentionItem);
      let raced = false;
      vi.spyOn(client.attentionItem, "createManyAndReturn").mockImplementation((async (args: NonNullable<Parameters<typeof insert>[0]>) => {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        const ours = rows.find((row) => row.entityId === taskId);
        if (ours && !raced) {
          raced = true;
          // The other pass started earlier, so its mark is older than this one's.
          await prisma.attentionItem.create({ data: { ...ours, lastEvaluatedAt: new Date(Date.now() - 60_000) } });
        }
        return insert(args);
      }) as never);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(raced).toBe(true);
      expect((await itemsFor(taskId)).map((item) => item.status)).toEqual(["ACTIVE"]);
    });

    it("keeps an item dismissed while a pass was writing it dismissed", async () => {
      const owner = await loginAs("OWNER");
      const engineer = await loginAs("ENGINEER");
      const renamed = await overdueTask(owner, PROJECT.a, "member_engineer");
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      const [item] = await itemsFor(renamed);

      // The pass will refresh the renamed task's item; a second task gives it
      // something to insert, and the engineer dismisses the item in between.
      await prisma.task.update({ where: { id: renamed }, data: { title: `${PREFIX} renamed` } });
      const fresh = await overdueTask(owner, PROJECT.a, "member_engineer");
      const insert = client.attentionItem.createManyAndReturn.bind(client.attentionItem);
      let dismissed = false;
      vi.spyOn(client.attentionItem, "createManyAndReturn").mockImplementation((async (args: Parameters<typeof insert>[0]) => {
        if (!dismissed) {
          dismissed = true;
          const { dismissAttention } = await import("@/lib/core/notifications/attention.service");
          await dismissAttention(engineer, item.id);
        }
        return insert(args);
      }) as never);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(dismissed).toBe(true);
      const after = await prisma.attentionItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.status).toBe("DISMISSED");
      expect(after.title).toBe(item.title);
      expect((await itemsFor(fresh)).map((row) => row.status)).toEqual(["ACTIVE"]);
    });
  });

  describe("company isolation", () => {
    it("reconciles only the company it is run for, and never files one company's condition in another (§180)", async () => {
      const [ownerA, ownerB] = await Promise.all([loginAs("OWNER"), loginAsEmail("owner-b@nesto.test")]);
      const taskA = await overdueTask(ownerA, PROJECT.a, "member_engineer");
      const taskB = await overdueTask(ownerB, PROJECT.companyB, ownerB.membershipId);
      const staleB = await staleItem(COMPANY_B, ownerB.membershipId);

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect((await itemsFor(taskA)).map((item) => item.companyId)).toEqual([COMPANY_A]);
      expect(await itemsFor(taskB)).toEqual([]);
      expect(await statusOf(staleB.id)).toBe("ACTIVE");

      await invokeJob(JOB);
      expect((await itemsFor(taskB)).map((item) => [item.companyId, item.recipientMemberId])).toEqual([[COMPANY_B, ownerB.membershipId]]);
      expect((await itemsFor(taskA)).map((item) => [item.companyId, item.recipientMemberId])).toEqual([[COMPANY_A, "member_engineer"]]);
      expect(await statusOf(staleB.id)).toBe("RESOLVED");
      const membersA = new Set((await prisma.companyMember.findMany({ where: { companyId: COMPANY_A }, select: { id: true } })).map((row) => row.id));
      const itemsA = await prisma.attentionItem.findMany({ where: { companyId: COMPANY_A, status: "ACTIVE" }, select: { recipientMemberId: true } });
      expect(itemsA.every((row) => membersA.has(row.recipientMemberId))).toBe(true);
    });
  });

  describe("suspended company", () => {
    it("neither raises nor resolves anything in a suspended company (§145, §181)", async () => {
      const ownerB = await loginAsEmail("owner-b@nesto.test");
      const taskB = await overdueTask(ownerB, PROJECT.companyB, ownerB.membershipId);
      const staleB = await staleItem(COMPANY_B, ownerB.membershipId);

      const skipped = await withCompanyStatus(COMPANY_B, "SUSPENDED", () => invokeJob(JOB, { companyIds: [COMPANY_B] }));
      expect(skipped).toMatchObject({ processed: 0, detail: { companies: 0 } });
      expect(await itemsFor(taskB)).toEqual([]);
      expect(await statusOf(staleB.id)).toBe("ACTIVE");

      await invokeJob(JOB, { companyIds: [COMPANY_B] });
      expect((await itemsFor(taskB)).map((item) => item.status)).toEqual(["ACTIVE"]);
      expect(await statusOf(staleB.id)).toBe("RESOLVED");
    });
  });

  describe("failure", () => {
    it("leaves a failing condition's items as they were, reconciles every other condition, and fails the run", async () => {
      const owner = await loginAs("OWNER");
      const taskId = await overdueTask(owner, PROJECT.a, "member_engineer");
      const staleNcr = await staleItem(COMPANY_A, "member_qaqc", "UNRESOLVED_NCR", "non_conformance_report", "qaqc");
      const staleTask = await staleItem(COMPANY_A, "member_engineer");
      vi.spyOn(findAttentionCondition("UNRESOLVED_NCR")!, "page").mockRejectedValue(new Error("contract test: the NCR query failed"));

      await expect(invokeJob(JOB, { companyIds: [COMPANY_A] })).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      expect((await itemsFor(taskId)).map((item) => item.status)).toEqual(["ACTIVE"]);
      expect(await statusOf(staleTask.id)).toBe("RESOLVED");
      // Nothing it could not read is taken as ended.
      expect(await statusOf(staleNcr.id)).toBe("ACTIVE");

      vi.restoreAllMocks();
      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await statusOf(staleNcr.id)).toBe("RESOLVED");
    });

    it("resolves nothing for a condition a stopped run did not finish reading", async () => {
      const stale = await staleItem(COMPANY_A, "member_engineer");
      const controller = new AbortController();
      const condition = findAttentionCondition("OVERDUE_TASK")!;
      const page = condition.page;
      vi.spyOn(condition, "page").mockImplementation(async (companyId, now, cursor, size) => {
        const read = await page(companyId, now, cursor, size);
        controller.abort(new Error("contract test: shutdown"));
        return { ...read, next: read.next ?? "0:" };
      });

      await invokeJob(JOB, { companyIds: [COMPANY_A], signal: controller.signal });
      expect(await statusOf(stale.id)).toBe("ACTIVE");
    });
  });
});
