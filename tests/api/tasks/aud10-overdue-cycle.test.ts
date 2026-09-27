import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { findNotificationEvent, readPayload } from "@/lib/core/notifications/notification.events";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, loginAs, prisma, PROJECT, taskVersion } from "../../helpers";
import { COMPANY_A, invokeJob } from "../jobs/job-harness";
import { rememberTrail } from "../jobs/reminder-trail";
import { removeTasks } from "./aud10-support";

/**
 * AUD-10 §7 (gap 11): one overdue reminder per due date *per completion
 * cycle*. A replayed sweep sends nothing new; a task completed, reopened and
 * overdue again on the same due date is a genuine second occurrence and is
 * told again — whether it was reopened by the Reopen command or the edit
 * form. The first cycle keeps the exact key it always had, so nothing already
 * sent before this change is sent twice.
 *
 * The job runs on a clock of its own (14 May 2031) over company A only, so
 * its window holds this test's task and nothing seeded; the ledger rows and
 * outbox events it adds are removed after each test.
 */

const JOB = "notifications.due";
const HOUR = 3_600_000;
const NOW = new Date("2031-05-14T10:00:00.000Z");
const DUE = "2031-05-13";
const created: string[] = [];

let pm: UserContext;
let engineer: UserContext;
let owner: UserContext;
let forgetTrail: () => Promise<void>;

beforeAll(async () => {
  [pm, engineer, owner] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("ENGINEER"), loginAs("OWNER")]);
});
beforeEach(async () => {
  forgetTrail = await rememberTrail(JOB, ["TASK_OVERDUE"]);
});
afterEach(async () => {
  await forgetTrail();
  await removeTasks(created);
  created.length = 0;
});
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const sweep = (hours: number) => invokeJob(JOB, { now: new Date(NOW.getTime() + hours * HOUR), lastSuccessAt: new Date(NOW.getTime() + (hours - 1) * HOUR), companyIds: [COMPANY_A] });
const overdue = (taskId: string) => prisma.notificationEventOutbox.findMany({ where: { entityId: taskId, eventType: "TASK_OVERDUE" }, orderBy: { createdAt: "asc" } });

describe("TASK_OVERDUE per completion cycle (gap 11)", () => {
  it("sends once per cycle: a replay adds nothing; reopen by command or by form and overdue again is told again", async () => {
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: "aud10c overdue", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId, dueDate: DUE }));
    created.push(task.id);

    await sweep(0);
    await sweep(1);
    expect(await overdue(task.id)).toHaveLength(1);

    // Completed and reopened with the Reopen command: a second cycle.
    await tasks.completeTask(engineer, task.id, await taskVersion(task.id));
    await tasks.reopenTask(owner, task.id, await taskVersion(task.id));
    await sweep(2);
    await sweep(3);
    expect(await overdue(task.id)).toHaveLength(2);

    // Completed and put back to To Do from the edit form: a third.
    await tasks.completeTask(engineer, task.id, await taskVersion(task.id));
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    await tasks.updateTask(owner, task.id, updateTaskSchema.parse({ title: row.title, priority: row.priority, status: "TODO", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId, dueDate: DUE, ...(await taskVersion(task.id)) }));
    // An ordinary edit is not a new cycle.
    const edited = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    await tasks.updateTask(owner, task.id, updateTaskSchema.parse({ title: `${edited.title} (edited)`, priority: edited.priority, status: "TODO", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId, dueDate: DUE, ...(await taskVersion(task.id)) }));
    await sweep(4);
    await sweep(5);
    const events = await overdue(task.id);
    expect(events).toHaveLength(3);

    expect(events.map((event) => (readPayload(event as never) as { reopenCycle?: number }).reopenCycle)).toEqual([0, 1, 2]);
    const ledger = await prisma.jobIdempotencyKey.findMany({ where: { jobKey: JOB, key: { startsWith: `task:${task.id}:` } }, select: { key: true } });
    expect(ledger.map((row) => row.key).sort()).toEqual([`task:${task.id}:${DUE}`, `task:${task.id}:${DUE}:r1`, `task:${task.id}:${DUE}:r2`]);

    // The recipient's dedupe identities are distinct per cycle; the first is the key it always was.
    const definition = findNotificationEvent("TASK_OVERDUE")!;
    const keys = events.map((event) => definition.dedupe(event as never, engineer.membershipId, readPayload(event as never)));
    expect(keys).toEqual([`TASK_OVERDUE:${task.id}:${engineer.membershipId}:${DUE}`, `TASK_OVERDUE:${task.id}:${engineer.membershipId}:${DUE}:r1`, `TASK_OVERDUE:${task.id}:${engineer.membershipId}:${DUE}:r2`]);
    expect(new Set(keys).size).toBe(3);
  });
});
