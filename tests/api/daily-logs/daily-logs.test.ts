import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { attentionConditionDefinitions } from "@/lib/core/notifications/attention.conditions";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { globalSearch } from "@/lib/core/search/search.service";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { addEntry, removeEntry, updateEntry } from "@/lib/modules/daily-logs/daily-log.entries";
import { createTaskFromLog, linkRecord, linkTask, recordCandidates, unlinkRecord } from "@/lib/modules/daily-logs/daily-log.links";
import { dailyLogReport, missingYesterday, remindMissingDailyLogs } from "@/lib/modules/daily-logs/daily-log.reports";
import { addCorrection, lockDailyLog, returnDailyLog, reviewDailyLog, submitDailyLog, voidDailyLog } from "@/lib/modules/daily-logs/daily-log.review";
import { SECTION_SCHEMAS, createTaskFromLogSchema, listQuerySchema, reportQuerySchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { createDailyLog, getDailyLog, listDailyLogs, updateDailyLog } from "@/lib/modules/daily-logs/daily-log.service";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Construction daily logs, against the real database (PRD #43 §252-§268).
 *
 * The Engineer keeps the logs of the Logistics Hub (project_d), whose manager
 * is the Owner; the seed leaves that project without logs. Every log a test
 * creates there is removed after it, with the tasks, links, notifications,
 * attention and activity it left. Riverside's seeded logs are only read.
 */

const ZONE = "Europe/Tirane";
const SITE = PROJECT.d;
const TASK_D = "task_026"; // project_d, assigned to HSE
const COMPANY_B_TASK = "task_b_01";

let engineer: UserContext;
let owner: UserContext;
let qaqc: UserContext;
let hse: UserContext;
let architect: UserContext;
let viewer: UserContext;
let pm: UserContext;
const createdTasks: string[] = [];

const today = () => localDate(new Date(), ZONE);
const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
const parse = <K extends keyof typeof SECTION_SCHEMAS>(section: K, value: unknown) => SECTION_SCHEMAS[section].parse(value) as never;

async function cleanup() {
  const logs = await prisma.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  const ids = logs.map((row) => row.id);
  const trail = [...ids, SITE, ...createdTasks];
  await prisma.integrationLink.deleteMany({ where: { integrationType: "DAILY_LOG_RECORD", sourceEntityId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...ids, ...createdTasks] } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: [...ids, ...createdTasks] } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.dailyLog.deleteMany({ where: { id: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  createdTasks.length = 0;
  await prisma.projectDailyLogSettings.deleteMany({ where: { projectId: SITE } });
}

beforeAll(async () => {
  [engineer, owner, qaqc, hse, architect, viewer, pm] = await Promise.all([loginAs("ENGINEER"), loginAs("OWNER"), loginAs("QAQC"), loginAs("HSE"), loginAs("ARCHITECT"), loginAs("VIEWER"), loginAs("PROJECT_MANAGER")]);
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function started(date = today()) {
  const { id } = await createDailyLog(engineer, { projectId: SITE, workDate: date });
  return id;
}

async function readyToSubmit(date = today()) {
  const id = await started(date);
  await addEntry(engineer, id, "workforce", parse("workforce", { organizationName: "Atlas Groundworks", trade: "Groundworks", headcount: 6 }));
  await addEntry(engineer, id, "activities", parse("activities", { title: "Yard drainage trench", projectArea: "North yard", progressPercent: 40 }));
  return id;
}

const version = async (id: string, context = engineer) => (await getDailyLog(context, id)).version;

describe("creating a log (§10, §17-§19, §253)", () => {
  it("starts one canonical log per project and day, and answers a second start with the same log", async () => {
    const first = await createDailyLog(engineer, { projectId: SITE, workDate: today() });
    const second = await createDailyLog(owner, { projectId: SITE, workDate: today() });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await prisma.dailyLog.count({ where: { projectId: SITE, workDate: new Date(`${today()}T12:00:00.000Z`) } })).toBe(1);
    const concurrent = await Promise.all([createDailyLog(engineer, { projectId: SITE, workDate: addLocalDays(today(), -1) }), createDailyLog(owner, { projectId: SITE, workDate: addLocalDays(today(), -1) })]);
    expect(concurrent[0].id).toBe(concurrent[1].id);
  });

  it("refuses the future and days beyond the backdating window, and marks a late entry", async () => {
    await expect(createDailyLog(engineer, { projectId: SITE, workDate: addLocalDays(today(), 1) })).rejects.toMatchObject(code("DAILY_LOG_FUTURE_DATE"));
    await expect(createDailyLog(engineer, { projectId: SITE, workDate: addLocalDays(today(), -8) })).rejects.toMatchObject(code("DAILY_LOG_BACKDATE_LIMIT"));
    const late = await started(addLocalDays(today(), -3));
    expect((await getDailyLog(engineer, late)).lateEntry).toBe(true);
    expect((await getDailyLog(engineer, await started())).lateEntry).toBe(false);
  });

  it("keeps a log inside its project: another project's people, another company and the Viewer off it see nothing", async () => {
    const id = await started();
    await expect(getDailyLog(architect, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDailyLog(await loginAsEmail("owner-b@nesto.test"), id)).rejects.toBeTruthy();
    await expect(createDailyLog(architect, { projectId: SITE, workDate: today() })).rejects.toBeTruthy();
    await expect(createDailyLog(engineer, { projectId: PROJECT.companyB, workDate: today() })).rejects.toMatchObject(code("DAILY_LOG_PROJECT_NOT_FOUND"));
    expect(await loadRecord(owner, "daily_log", id)).toMatchObject({ href: `/projects/${SITE}/daily-logs/${id}` });
    expect(await loadRecord(viewer, "daily_log", id)).toBeNull();
  });
});

describe("sections (§26-§61, §186-§191, §254-§258)", () => {
  it("adds, edits and removes entries, deriving workforce totals and delay durations", async () => {
    const id = await started();
    const crew = await addEntry(engineer, id, "workforce", parse("workforce", { organizationName: "Alba Concrete", supplierId: "supplier_alba", trade: "Concrete", headcount: 12 }));
    await addEntry(engineer, id, "workforce", parse("workforce", { organizationName: "Unlisted fencing crew", headcount: 3 }));
    const delay = await addEntry(engineer, id, "delays", parse("delays", { category: "WEATHER", title: "Heavy rain", startedTime: "10:00", endedTime: "11:45", durationMinutes: 30, impact: "HIGH" }));
    await addEntry(engineer, id, "visitors", parse("visitors", { name: "Building inspector", organization: "Municipality", arrivedTime: "09:00", departedTime: "09:40" }));
    await addEntry(engineer, id, "weather", parse("weather", { observedTime: "07:00", condition: "RAIN", temperatureC: 14.5, humidityPct: 90 }));

    let log = await getDailyLog(engineer, id);
    expect(log.counts.workforce).toBe(15);
    expect(log.workforce[0].supplier).toMatchObject({ label: "Alba Concrete" });
    expect(log.delays[0]).toMatchObject({ durationMinutes: 105, startedAt: "10:00", endedAt: "11:45" });
    expect(log.visitors[0]).toMatchObject({ arrivedAt: "09:00", departedAt: "09:40" });
    expect(log.weather[0]).toMatchObject({ condition: "RAIN", temperatureC: 14.5 });
    expect(log.history.map((entry) => entry.action)).toContain("Major delay recorded");
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "DAILY_LOG_DELAY_ADDED" } })).toBe(1);

    const before = log.workforce[0];
    await updateEntry(engineer, id, "workforce", crew.id, Object.assign(parse("workforce", { organizationName: "Alba Concrete", headcount: 14 }) as object, { updatedAt: before.updatedAt }) as never);
    await expect(updateEntry(engineer, id, "workforce", crew.id, Object.assign(parse("workforce", { organizationName: "Alba Concrete", headcount: 16 }) as object, { updatedAt: before.updatedAt }) as never)).rejects.toMatchObject(code("DAILY_LOG_ENTRY_CHANGED"));
    await removeEntry(engineer, id, "delays", delay.id);
    log = await getDailyLog(engineer, id);
    expect(log.counts.workforce).toBe(17);
    expect(log.delays).toHaveLength(0);
  });

  it("refuses bad headcounts, progress, visitor times, and links outside the company or the project", async () => {
    const id = await started();
    expect(() => parse("workforce", { organizationName: "Crew", headcount: 0 })).toThrow();
    expect(() => parse("activities", { title: "Pour", progressPercent: 120 })).toThrow();
    expect(() => parse("visitors", { name: "Visitor", arrivedTime: "10:00", departedTime: "09:00" })).toThrow();
    expect(() => parse("delays", { category: "OTHER", title: "Stop", startedTime: "10:00", endedTime: "10:00" })).toThrow();
    await expect(addEntry(engineer, id, "workforce", parse("workforce", { organizationName: "Crew", supplierId: "supplier_b_steel", headcount: 2 }))).rejects.toMatchObject(code("DAILY_LOG_SUPPLIER_INVALID"));
    await expect(addEntry(engineer, id, "deliveries", parse("deliveries", { description: "Rebar", purchaseOrderId: "order_001" }))).rejects.toMatchObject(code("DAILY_LOG_PURCHASE_ORDER_PROJECT_MISMATCH"));
    await expect(addEntry(engineer, id, "activities", parse("activities", { title: "Pour", linkedTaskId: COMPANY_B_TASK }))).rejects.toMatchObject(code("DAILY_LOG_TASK_INVALID"));
    await expect(addEntry(engineer, id, "activities", parse("activities", { title: "Pour", linkedTaskId: "task_006" }))).rejects.toMatchObject(code("DAILY_LOG_TASK_PROJECT_MISMATCH"));
    await expect(linkTask(engineer, id, { taskId: COMPANY_B_TASK, linkType: "RELATED" })).rejects.toMatchObject(code("DAILY_LOG_TASK_INVALID"));
  });

  it("lets field roles change only their own sections", async () => {
    const id = await started();
    await expect(addEntry(qaqc, id, "workforce", parse("workforce", { organizationName: "Crew", headcount: 2 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addEntry(viewer, id, "activities", parse("activities", { title: "Pour" }))).rejects.toBeTruthy();
    const detail = await getDailyLog(hse, id);
    expect(detail.capabilities.sections).toMatchObject({ hse: true, workforce: false, qaqc: false });
  });

  it("references QA/QC and HSE records without changing them, and shows another reader only what they may see", async () => {
    const id = await started(addLocalDays(today(), -1));
    const incident = await prisma.hseIncident.findFirstOrThrow({ where: { companyId: "company_demo_a", projectId: SITE } });
    const before = incident.updatedAt;
    await expect(linkRecord(qaqc, id, { recordType: "incident", recordId: incident.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { linkId } = await linkRecord(hse, id, { recordType: "incident", recordId: incident.id });
    expect((await prisma.hseIncident.findUniqueOrThrow({ where: { id: incident.id } })).updatedAt).toEqual(before);
    await expect(linkRecord(engineer, id, { recordType: "invoice", recordId: "invoice_001" })).rejects.toMatchObject(code("DAILY_LOG_RECORD_TYPE_INVALID"));

    const forHse = await getDailyLog(hse, id);
    expect(forHse.records[0]).toMatchObject({ domain: "hse", restricted: false });
    // The same Engineer with HSE switched off: the log still opens, the incident does not.
    const withoutHse: UserContext = { ...engineer, moduleAccess: { ...engineer.moduleAccess, hse: { ...engineer.moduleAccess.hse, enabled: false, accessLevel: "NONE", permissions: [] } }, permissions: engineer.permissions.filter((permission) => !permission.startsWith("hse.")) };
    const forOthers = await getDailyLog(withoutHse, id);
    expect(forOthers.records[0]).toMatchObject({ label: "HSE incident recorded", restricted: true, href: null });
    expect(JSON.stringify(forOthers.records)).not.toContain(incident.title);

    await unlinkRecord(hse, id, linkId);
    expect((await getDailyLog(hse, id)).records).toHaveLength(0);
    expect(Array.isArray(await recordCandidates(hse, id))).toBe(true);
  });

  it("raises a follow-up task through the task service from a delay, without completing anything", async () => {
    const id = await started();
    const delay = await addEntry(engineer, id, "delays", parse("delays", { category: "EQUIPMENT", title: "Excavator breakdown", durationMinutes: 120, impact: "MEDIUM" }));
    const result = await createTaskFromLog(engineer, id, createTaskFromLogSchema.parse({ title: "Replace excavator hydraulic hose", source: { section: "delays", entryId: delay.id } }));
    createdTasks.push(result.taskId);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: result.taskId } });
    expect(task).toMatchObject({ projectId: SITE, entityType: "daily_log", entityId: id, status: "TODO" });
    const log = await getDailyLog(engineer, id);
    expect(log.delays[0].task).toMatchObject({ id: result.taskId });
    expect(log.tasks[0]).toMatchObject({ taskId: result.taskId, linkType: "DELAY_ACTION" });
    await linkTask(engineer, id, { taskId: TASK_D, linkType: "RELATED" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK_D } })).status).not.toBe("COMPLETED");
  });
});

describe("review, lock, void and corrections (§87-§102, §192, §262, §263)", () => {
  it("refuses an empty submission, then submits to the project manager and freezes the log", async () => {
    const empty = await started(addLocalDays(today(), -2));
    await expect(submitDailyLog(engineer, empty, { expectedVersion: await version(empty) })).rejects.toMatchObject(code("DAILY_LOG_INCOMPLETE"));

    const id = await readyToSubmit();
    await expect(submitDailyLog(engineer, id, { expectedVersion: 1 })).rejects.toMatchObject(code("DAILY_LOG_STALE"));
    const { reviewerMemberId } = await submitDailyLog(engineer, id, { expectedVersion: await version(id) });
    expect(reviewerMemberId).toBe(owner.membershipId);
    const log = await getDailyLog(engineer, id);
    expect(log.status).toBe("SUBMITTED");
    expect(log.capabilities.canEdit).toBe(false);
    await expect(addEntry(engineer, id, "activities", parse("activities", { title: "More work" }))).rejects.toMatchObject(code("DAILY_LOG_NOT_EDITABLE"));
    await expect(updateDailyLog(engineer, id, { expectedVersion: log.version, summary: "Changed", generalNotes: null, delaySummary: null, instructionSummary: null, weatherSummary: null, siteCondition: null, siteConditionNotes: null })).rejects.toMatchObject(code("DAILY_LOG_NOT_EDITABLE"));
    expect(await canAttachToDocumentParent(engineer, { projectId: null, clientId: null, module: "dailyLogs", entityType: "daily_log", entityId: id })).toBe(false);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "DAILY_LOG_SUBMITTED" } })).toBe(1);
  });

  it("is returned with a reason, corrected and resubmitted, reviewed by someone else, and locked", async () => {
    const id = await readyToSubmit();
    await submitDailyLog(engineer, id, { expectedVersion: await version(id) });
    await expect(reviewDailyLog(engineer, id, { expectedVersion: await version(id) })).rejects.toBeTruthy();
    await expect(lockDailyLog(owner, id, { expectedVersion: await version(id) })).rejects.toMatchObject(code("DAILY_LOG_NOT_REVIEWED"));

    await returnDailyLog(owner, id, { expectedVersion: await version(id, owner), reason: "Add the drainage subcontractor's crew." });
    let log = await getDailyLog(engineer, id);
    expect(log).toMatchObject({ status: "CORRECTION_REQUIRED", returnReason: "Add the drainage subcontractor's crew." });
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: id, recipientMemberId: engineer.membershipId, eventType: "DAILY_LOG_RETURNED" } })).toBe(1);

    await addEntry(engineer, id, "workforce", parse("workforce", { organizationName: "Delta Drainage", headcount: 4 }));
    await submitDailyLog(engineer, id, { expectedVersion: await version(id) });
    await reviewDailyLog(owner, id, { expectedVersion: await version(id, owner) });
    await lockDailyLog(owner, id, { expectedVersion: await version(id, owner) });
    log = await getDailyLog(engineer, id);
    expect(log.status).toBe("LOCKED");
    expect(log.history.map((entry) => entry.action)).toEqual(["Started", "Submitted", "Returned for correction", "Submitted", "Reviewed", "Locked"]);
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: { in: ["DAILY_LOG_SUBMITTED", "DAILY_LOG_RETURNED", "DAILY_LOG_REVIEWED", "DAILY_LOG_LOCKED"] } } })).toBe(5);
  });

  it("keeps a locked log unchanged, appending corrections only for authorised people", async () => {
    const id = await readyToSubmit();
    await submitDailyLog(engineer, id, { expectedVersion: await version(id) });
    await reviewDailyLog(owner, id, { expectedVersion: await version(id, owner) });
    await lockDailyLog(owner, id, { expectedVersion: await version(id, owner) });
    const locked = await getDailyLog(owner, id);
    const snapshot = await prisma.dailyLog.findUniqueOrThrow({ where: { id }, include: { workforce: true, workActivities: true } });

    const activity = locked.activities[0];
    await expect(updateEntry(engineer, id, "activities", activity.id, parse("activities", { title: "Rewritten" }))).rejects.toMatchObject(code("DAILY_LOG_LOCKED"));
    await expect(addCorrection(engineer, id, { reason: "Wrong", correctionSummary: "Fix" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await addCorrection(owner, id, { reason: "Headcount mistyped.", correctionSummary: "Atlas Groundworks had 7 people on site, not 6." });

    const after = await prisma.dailyLog.findUniqueOrThrow({ where: { id }, include: { workforce: true, workActivities: true } });
    expect(after.workforce).toEqual(snapshot.workforce);
    expect(after.workActivities).toEqual(snapshot.workActivities);
    expect(after.version).toBe(snapshot.version);
    const detail = await getDailyLog(engineer, id);
    expect(detail.corrections).toHaveLength(1);
    expect(detail.corrections[0].correctionSummary).toContain("7 people");
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "DAILY_LOG_CORRECTION_ADDED" } })).toBe(1);
  });

  it("voids a log with a reason, keeping it in history", async () => {
    const id = await started();
    await expect(voidDailyLog(engineer, id, { expectedVersion: await version(id), reason: "Duplicate" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await voidDailyLog(owner, id, { expectedVersion: await version(id, owner), reason: "Started on the wrong project." });
    const log = await getDailyLog(owner, id);
    expect(log).toMatchObject({ status: "VOID", voidReason: "Started on the wrong project." });
    expect(await loadRecord(owner, "daily_log", id)).toMatchObject({ archived: true });
  });
});

describe("attention, notifications, reporting and search (§103-§111, §196-§204, §264, §265)", () => {
  it("flags a missing log once for a required project's last working day, and only when required", async () => {
    const now = new Date();
    expect((await missingYesterday("company_demo_a", now)).some((row) => row.projectId === SITE)).toBe(false);
    await prisma.projectDailyLogSettings.create({ data: { companyId: "company_demo_a", projectId: SITE, logsRequired: true, workingDays: [1, 2, 3, 4, 5, 6, 7] } });
    const original = await prisma.project.findUniqueOrThrow({ where: { id: SITE }, select: { status: true, endDate: true } });
    await prisma.project.update({ where: { id: SITE }, data: { status: "ACTIVE", endDate: null } });
    try {
      const missing = await missingYesterday("company_demo_a", now);
      expect(missing.find((row) => row.projectId === SITE)).toMatchObject({ date: addLocalDays(today(), -1), projectManagerMemberId: owner.membershipId });
      const condition = attentionConditionDefinitions().find((row) => row.key === "DAILY_LOG_MISSING")!;
      expect((await condition.collect("company_demo_a", now)).filter((row) => row.entityId === SITE)).toHaveLength(1);

      const first = await remindMissingDailyLogs(now);
      const again = await remindMissingDailyLogs(now);
      expect(first.reminded).toBeGreaterThan(0);
      expect(await prisma.notificationEventOutbox.count({ where: { entityId: SITE, eventType: "DAILY_LOG_MISSING_REMINDER" } })).toBe(1);
      expect(again.reminded).toBeLessThan(first.reminded);

      await started(addLocalDays(today(), -1));
      expect((await missingYesterday("company_demo_a", now)).some((row) => row.projectId === SITE)).toBe(false);
      expect(await condition.holds("company_demo_a", "project", SITE, now)).toBe(false);
    } finally {
      await prisma.project.update({ where: { id: SITE }, data: { status: original.status, endDate: original.endDate } });
    }
  });

  it("puts a submitted log in front of its reviewer and a returned one in front of its author", async () => {
    const id = await readyToSubmit();
    await submitDailyLog(engineer, id, { expectedVersion: await version(id) });
    const awaiting = attentionConditionDefinitions().find((row) => row.key === "DAILY_LOG_AWAITING_REVIEW")!;
    expect((await awaiting.collect("company_demo_a", new Date())).find((row) => row.entityId === id)).toMatchObject({ recipients: [owner.membershipId], exclude: [engineer.membershipId] });
    await returnDailyLog(owner, id, { expectedVersion: await version(id, owner), reason: "Missing photos." });
    const returned = attentionConditionDefinitions().find((row) => row.key === "DAILY_LOG_RETURNED")!;
    expect((await returned.collect("company_demo_a", new Date())).find((row) => row.entityId === id)?.recipients).toContain(engineer.membershipId);
    expect(await awaiting.holds("company_demo_a", "daily_log", id, new Date())).toBe(false);
  });

  it("reports the seeded Riverside logs, lists them and finds them by project in search", async () => {
    const report = await dailyLogReport(pm, reportQuerySchema.parse({ projectId: PROJECT.a, from: addLocalDays(today(), -10), to: today() }));
    expect(report.totals.logs).toBeGreaterThanOrEqual(3);
    expect(report.totals.delays).toBeGreaterThanOrEqual(1);
    expect(report.workforceByTrade.map((row) => row.trade)).toContain("Concrete");
    expect(report.totals.photos).toBeGreaterThanOrEqual(3);
    await expect(dailyLogReport(pm, reportQuerySchema.parse({ projectId: PROJECT.companyB }))).rejects.toMatchObject({ code: "NOT_FOUND" });

    const list = await listDailyLogs(engineer, listQuerySchema.parse({ projectId: PROJECT.a }));
    expect(list.items.length).toBeGreaterThanOrEqual(3);
    expect(list.items.find((item) => item.status === "LOCKED")).toMatchObject({ corrected: true });
    expect(list.today?.date).toBe(today());

    const search = await globalSearch(pm, "Riverside");
    expect(search.results.some((row) => row.entityType === "daily_log")).toBe(true);
    const viewerSearch = await globalSearch(await loginAsEmail("owner-b@nesto.test"), "Riverside");
    expect(viewerSearch.results.some((row) => row.entityType === "daily_log")).toBe(false);
  });
});
