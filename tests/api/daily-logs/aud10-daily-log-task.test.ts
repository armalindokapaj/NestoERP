import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { addEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { createTaskFromLog } from "@/lib/modules/daily-logs/daily-log.links";
import { SECTION_SCHEMAS, createTaskFromLogSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { createDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { expectRefusal, failingWrites, locker, orphanTaskHistory, raceBehindRow, removeTasks, settle } from "../tasks/aud10-support";

/**
 * AUD-10 §3, §7 (CW-12, CW-13) for "create a task from this daily log": the
 * task, its link to the log, the entry's pointer and the audit commit in one
 * transaction; an entry points at one task however many clicks arrive at
 * once; a retry answers with that task; forged ids are refused before any
 * write. Real services and rows; a yard project of its own (prefix `aud10c_`),
 * removed at the end.
 */

const ZONE = "Europe/Tirane";
const SITE = "aud10c_yard";
const OTHER_SITE = "aud10c_other_yard";

let engineer: UserContext;
let engineer2: UserContext;
let tenantOwner: UserContext;

const today = () => localDate(new Date(), ZONE);
const parse = <K extends keyof typeof SECTION_SCHEMAS>(section: K, value: unknown) => SECTION_SCHEMAS[section].parse(value) as never;

async function raisedTasks(): Promise<string[]> {
  const logs = await prisma.dailyLog.findMany({ where: { projectId: { in: [SITE, OTHER_SITE] } }, select: { id: true } });
  return (await prisma.task.findMany({ where: { OR: [{ entityType: "daily_log", entityId: { in: logs.map((row) => row.id) } }, { projectId: { in: [SITE, OTHER_SITE] } }] }, select: { id: true } })).map((row) => row.id);
}

async function cleanup() {
  const logs = (await prisma.dailyLog.findMany({ where: { projectId: { in: [SITE, OTHER_SITE] } }, select: { id: true } })).map((row) => row.id);
  await removeTasks(await raisedTasks());
  await prisma.notification.deleteMany({ where: { entityId: { in: logs } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: logs } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: logs } } });
  await prisma.dailyLog.deleteMany({ where: { id: { in: logs } } });
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: { in: [SITE, OTHER_SITE] } } });
}

async function removeSites() {
  await cleanup();
  await prisma.projectMember.deleteMany({ where: { projectId: { in: [SITE, OTHER_SITE] } } });
  await prisma.project.deleteMany({ where: { id: { in: [SITE, OTHER_SITE] } } });
}

beforeAll(async () => {
  [engineer, engineer2, tenantOwner] = await Promise.all([loginAs("ENGINEER"), loginAs("ENGINEER"), loginAsEmail(DEMO_EMAIL.tenantOwner)]);
  await removeSites();
  for (const [id, code] of [[SITE, "A10C-YARD"], [OTHER_SITE, "A10C-OTHER"]] as const) {
    await prisma.project.create({ data: { id, companyId: COMPANY.a, code, name: `AUD-10 ${code}`, status: "ACTIVE", projectManagerMemberId: "member_owner", createdBy: "test" } });
    await prisma.projectMember.createMany({ data: ["member_engineer", "member_hse"].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: id, companyMemberId, status: "ACTIVE" as const })) });
  }
});
afterEach(cleanup);
afterAll(async () => {
  await removeSites();
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

async function logWithDelay(projectId = SITE, date = today()) {
  const { id } = await createDailyLog(engineer, { projectId, workDate: date });
  const delay = await addEntry(engineer, id, "delays", parse("delays", { category: "EQUIPMENT", title: "aud10c breakdown", durationMinutes: 60, impact: "MEDIUM" }));
  return { logId: id, delayId: delay.id as string };
}

const input = (entryId: string, overrides: Record<string, unknown> = {}) =>
  createTaskFromLogSchema.parse({ title: "aud10c replace the hose", assigneeMemberId: "member_engineer", source: { section: "delays", entryId }, ...overrides });

describe("a task from a daily log entry (CW-12, CW-13)", () => {
  it("two clicks at once create one task; both are answered with it, and a retry returns it too", async () => {
    const { logId, delayId } = await logWithDelay();
    const since = new Date();

    const results = await raceBehindRow("daily_logs", logId, [() => createTaskFromLog(engineer, logId, input(delayId)), () => createTaskFromLog(engineer2, logId, input(delayId))]);
    expect(results.every((result) => result.ok), JSON.stringify(results.map((r) => (r.ok ? "ok" : String((r as { error: unknown }).error))))).toBe(true);
    const values = results.map((result) => (result as { value: Awaited<ReturnType<typeof createTaskFromLog>> }).value);
    expect(values.map((value) => value.created).sort()).toEqual([false, true]);
    expect(values[0].taskId).toBe(values[1].taskId);

    const raised = await prisma.task.findMany({ where: { entityType: "daily_log", entityId: logId } });
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ id: values[0].taskId, projectId: SITE, assigneeMemberId: "member_engineer", status: "TODO" });
    expect((await prisma.dailyLogDelayEntry.findUniqueOrThrow({ where: { id: delayId } })).linkedTaskId).toBe(values[0].taskId);
    expect(await prisma.dailyLogTaskLink.count({ where: { dailyLogId: logId } })).toBe(1);
    expect(await prisma.dailyLogTaskLink.findFirstOrThrow({ where: { dailyLogId: logId } })).toMatchObject({ taskId: values[0].taskId, linkType: "DELAY_ACTION" });
    expect(await orphanTaskHistory(since)).toBe(0);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: values[0].taskId, eventType: "TASK_ASSIGNED" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: logId, actionKey: "DAILY_LOG_TASK_CREATED" } })).toBe(1);
    // The winner moved the log's version once; the loser did not.
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id: logId } })).version).toBe(Math.max(...values.map((value) => value.version)));

    const retry = await createTaskFromLog(engineer, logId, input(delayId, { title: "aud10c a second try" }));
    expect(retry).toMatchObject({ taskId: values[0].taskId, created: false });
    expect(await prisma.task.count({ where: { entityType: "daily_log", entityId: logId } })).toBe(1);
  });

  it("does not name an entry's task to somebody who may not open it", async () => {
    const { logId, delayId } = await logWithDelay();
    const { taskId } = await createTaskFromLog(engineer, logId, input(delayId));
    const title = (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).title;
    const blind: UserContext = { ...engineer, permissions: engineer.permissions.filter((permission) => permission !== "task.view") };
    const refusal = await expectRefusal(createTaskFromLog(blind, logId, input(delayId)), "DAILY_LOG_ENTRY_HAS_TASK");
    expect(JSON.stringify({ message: refusal.message, details: refusal.details })).not.toContain(title);
    expect(JSON.stringify(refusal.details)).not.toContain(taskId);
    expect(await prisma.task.count({ where: { entityType: "daily_log", entityId: logId } })).toBe(1);
  });

  it("leaves no task behind when the link cannot be written", async () => {
    const { logId, delayId } = await logWithDelay();
    const before = (await prisma.dailyLog.findUniqueOrThrow({ where: { id: logId } })).version;
    const since = new Date();
    await failingWrites("daily_log_task_links", `NEW."dailyLogId" = '${logId}'`, async () => {
      const outcome = await settle(createTaskFromLog(engineer, logId, input(delayId)));
      expect(outcome.ok).toBe(false);
    });
    expect(await prisma.task.count({ where: { entityType: "daily_log", entityId: logId } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);
    expect((await prisma.dailyLogDelayEntry.findUniqueOrThrow({ where: { id: delayId } })).linkedTaskId).toBeNull();
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id: logId } })).version).toBe(before);

    // Positive control: the same click, without the failure.
    const created = await createTaskFromLog(engineer, logId, input(delayId));
    expect(created.created).toBe(true);
  });

  it("refuses forged entry, log and company ids before writing anything", async () => {
    const { logId } = await logWithDelay();
    const other = await logWithDelay(OTHER_SITE, addLocalDays(today(), -1));
    const since = new Date();

    // An entry of another log (another project): not this log's entry.
    await expectRefusal(createTaskFromLog(engineer, logId, input(other.delayId)), "DAILY_LOG_ENTRY_NOT_FOUND");
    expect((await prisma.dailyLogDelayEntry.findUniqueOrThrow({ where: { id: other.delayId } })).linkedTaskId).toBeNull();
    // Another company's person, naming this company's log.
    await expectRefusal(createTaskFromLog(tenantOwner, logId, input(other.delayId)), "DAILY_LOG_NOT_FOUND");
    // Somebody else as the assignee, from a writer who may only take work themselves.
    const second = await addEntry(engineer, logId, "delays", parse("delays", { category: "EQUIPMENT", title: "aud10c second", durationMinutes: 30, impact: "LOW" }));
    await expectRefusal(createTaskFromLog(engineer, logId, input(second.id, { assigneeMemberId: "member_sales" })), "FORBIDDEN");
    expect((await prisma.dailyLogDelayEntry.findUniqueOrThrow({ where: { id: second.id } })).linkedTaskId).toBeNull();

    expect(await prisma.task.count({ where: { entityType: "daily_log", entityId: { in: [logId, other.logId] } } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);
    expect(await prisma.dailyLogTaskLink.count({ where: { dailyLogId: { in: [logId, other.logId] } } })).toBe(0);
  });
});
