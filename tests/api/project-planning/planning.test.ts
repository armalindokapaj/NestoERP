import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { attentionConditionDefinitions } from "@/lib/core/notifications/attention.conditions";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { globalSearch } from "@/lib/core/search/search.service";
import { calendarProviders } from "@/lib/modules/calendar/calendar.providers";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { runMilestoneReminders } from "@/lib/modules/project-planning/planning.attention";
import { createBlocker, resolveBlocker } from "@/lib/modules/project-planning/planning.blockers";
import { addDependency, removeDependency } from "@/lib/modules/project-planning/planning.dependencies";
import { createTaskFromMilestone, linkRecord, linkTask, milestoneOptions, unlinkRecord, unlinkTask } from "@/lib/modules/project-planning/planning.links";
import { archiveMilestone, changeBaseline, completeMilestone, createMilestone, quickUpdateMilestone, reopenMilestone, setBaselineLock, updateMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { archivePhase, createPhase, reorderPhases, updatePhase } from "@/lib/modules/project-planning/planning.phases";
import { upcomingMilestones, criticalMilestones, planningReport } from "@/lib/modules/project-planning/planning.reports";
import { createMilestoneSchema, createPhaseSchema, milestoneListSchema, reportQuerySchema, updateMilestoneSchema, updatePhaseSchema } from "@/lib/modules/project-planning/planning.schema";
import { getMilestone, getPlanningOverview, getPlanningTimeline, listMilestones } from "@/lib/modules/project-planning/planning.service";
import { applyTemplate, copyPlanning } from "@/lib/modules/project-planning/planning.templates";
import { completeTask } from "@/lib/modules/tasks/task.service";
import { PLANNING_SEED } from "../../../prisma/seed/planning";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Project milestones and planning, against the real database (PRD #44
 * §282-§298).
 *
 * Each demo company runs one project, so this file builds two more in Aurelia
 * and removes them at the end. The Project Manager plans the first, which has
 * no plan; its members are QA/QC and HSE, so the Engineer and Architect are
 * outsiders there. The Owner copies plans into the second, where only the
 * Architect works. Everything a test creates on those two projects is removed after it;
 * Riverside's seeded plan is only read, apart from links a test adds and
 * removes again.
 */

const ZONE = "Europe/Tirane";
const SITE = "t44_office_tower";
const COPY_TARGET = "t44_marina";
const SITE_TASKS = ["t44_task_curtain_wall", "t44_task_waterproofing"];
const M = PLANNING_SEED.milestones;

let pm: UserContext;
let owner: UserContext;
let engineer: UserContext;
let architect: UserContext;
let viewer: UserContext;
let ceo: UserContext;
let finance: UserContext;
let groupIt: UserContext;
let hr: UserContext;
let qaqc: UserContext;
let ownerB: UserContext;
const createdTasks: string[] = [];

const today = () => localDate(new Date(), ZONE);
const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
const without = (context: UserContext, ...drop: string[]) => ({ ...context, permissions: context.permissions.filter((permission) => !drop.includes(permission)) }) as UserContext;

async function cleanup() {
  const milestones = await prisma.projectMilestone.findMany({ where: { projectId: { in: [SITE, COPY_TARGET, PROJECT.archived] } }, select: { id: true } });
  const ids = milestones.map((row) => row.id);
  const seeded = Object.values(M);
  const trail = [...ids, ...seeded, ...createdTasks];
  await prisma.integrationLink.deleteMany({ where: { integrationType: "MILESTONE_RECORD", OR: [{ sourceEntityId: { in: ids } }, { sourceEntityId: M.facade }] } });
  await prisma.projectMilestoneBlocker.deleteMany({ where: { milestoneId: { in: ids } } });
  await prisma.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: { in: ids } } });
  await prisma.projectMilestoneDependency.deleteMany({ where: { projectId: { in: [SITE, COPY_TARGET, PROJECT.archived] } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.jobIdempotencyKey.deleteMany({ where: { jobKey: "planning.milestones", OR: trail.map((id) => ({ key: { startsWith: `${id}:` } })) } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...ids, ...createdTasks] } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: [...ids, ...createdTasks] } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.projectMilestone.deleteMany({ where: { id: { in: ids } } });
  await prisma.projectPhase.deleteMany({ where: { projectId: { in: [SITE, COPY_TARGET, PROJECT.archived] } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  createdTasks.length = 0;
  await prisma.project.updateMany({ where: { id: { in: [SITE, COPY_TARGET] } }, data: { planningBaselineLocked: false, planningTemplateKey: null } });
  await prisma.projectPlanningSettings.updateMany({ where: { companyId: COMPANY.a }, data: { milestoneReminderDays: 7, baselineChangeReasonRequired: true, notifyExecutivesOnCriticalChanges: false } });
}

async function removeSites() {
  const tasks = (await prisma.task.findMany({ where: { OR: [{ id: { in: SITE_TASKS } }, { projectId: { in: [SITE, COPY_TARGET] } }] }, select: { id: true } })).map((row) => row.id);
  await prisma.projectMilestoneTaskLink.deleteMany({ where: { taskId: { in: tasks } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...tasks, SITE, COPY_TARGET] } } });
  await prisma.task.deleteMany({ where: { id: { in: tasks } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: [SITE, COPY_TARGET] } } });
  await prisma.project.deleteMany({ where: { id: { in: [SITE, COPY_TARGET] } } });
}

async function makeSites() {
  const schedule = { startDate: new Date(Date.now() - 60 * 86_400_000), endDate: new Date(Date.now() + 400 * 86_400_000) };
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY.a, code: "T44-TOWER", name: "Harbour Office Tower", status: "ACTIVE", projectManagerMemberId: "member_pm", createdBy: "test", ...schedule } });
  await prisma.project.create({ data: { id: COPY_TARGET, companyId: COMPANY.a, code: "T44-MARINA", name: "Harbour Marina Apartments", status: "ACTIVE", createdBy: "test", ...schedule } });
  await prisma.projectMember.createMany({ data: ["member_pm", "member_qaqc", "member_hse"].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: SITE, companyMemberId, status: "ACTIVE" as const })) });
  await prisma.projectMember.create({ data: { companyId: COMPANY.a, projectId: COPY_TARGET, companyMemberId: "member_architect", status: "ACTIVE" } });
  await prisma.task.createMany({
    data: [
      { id: SITE_TASKS[0], companyId: COMPANY.a, projectId: SITE, title: "Agree curtain wall procurement route", status: "IN_PROGRESS", assigneeMemberId: "member_pm", createdByMemberId: "member_pm", createdBy: "user_pm" },
      { id: SITE_TASKS[1], companyId: COMPANY.a, projectId: SITE, title: "Chase basement waterproofing warranty", status: "TODO", assigneeMemberId: "member_pm", createdByMemberId: "member_pm", createdBy: "user_pm" },
    ],
  });
}

beforeAll(async () => {
  [pm, owner, engineer, architect, viewer, ceo, finance, groupIt, hr, qaqc] = await Promise.all(
    (["PROJECT_MANAGER", "OWNER", "ENGINEER", "ARCHITECT", "VIEWER", "CEO", "FINANCE", "GROUP_IT", "HR", "QAQC"] as const).map((role) => loginAs(role)),
  );
  ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
  await cleanup();
  await removeSites();
  await makeSites();
});
afterEach(cleanup);
afterAll(async () => {
  await removeSites();
  await cleanupSessions();
  await prisma.$disconnect();
});

const phase = async (name: string, extra: Record<string, unknown> = {}) => (await createPhase(pm, SITE, createPhaseSchema.parse({ name, ...extra }))).id;
const milestone = async (name: string, extra: Record<string, unknown> = {}, context = pm) => (await createMilestone(context, SITE, createMilestoneSchema.parse({ name, ...extra }))).id;
const detail = (id: string, context = pm) => getMilestone(context, id);

async function edit(id: string, changes: Record<string, unknown>, context = pm) {
  const current = await detail(id, context);
  return updateMilestone(
    context,
    id,
    updateMilestoneSchema.parse({
      expectedVersion: current.version,
      name: current.name,
      description: current.description,
      phaseId: current.phaseId,
      milestoneType: current.type,
      status: current.status,
      ownerMemberId: current.owner?.memberId ?? null,
      plannedDate: current.plannedDate,
      forecastDate: current.forecastDate,
      progressPercent: current.progressPercent,
      critical: current.critical,
      externallyCommitted: current.externallyCommitted,
      actualDate: current.actualDate,
      ...changes,
    }),
  );
}

describe("phases (§9-§11, §26, §187, §271, §283)", () => {
  it("creates, edits with the version it read, reorders and archives only an empty phase", async () => {
    const structure = await phase("Structure", { status: "IN_PROGRESS", plannedStartDate: addLocalDays(today(), -10), plannedEndDate: addLocalDays(today(), 60) });
    const envelope = await phase("Envelope");
    let overview = await getPlanningOverview(pm, SITE);
    expect(overview.phases.map((row) => row.name)).toEqual(["Structure", "Envelope"]);

    const version = overview.phases[0].version;
    await updatePhase(pm, structure, updatePhaseSchema.parse({ name: "Superstructure", status: "AT_RISK", progressPercent: 40, expectedVersion: version }));
    await expect(updatePhase(pm, structure, updatePhaseSchema.parse({ name: "Again", expectedVersion: version }))).rejects.toMatchObject(code("PLANNING_STALE"));

    await reorderPhases(pm, SITE, [envelope, structure]);
    await expect(reorderPhases(pm, SITE, [envelope])).rejects.toMatchObject(code("PLANNING_REORDER_MISMATCH"));
    overview = await getPlanningOverview(pm, SITE);
    expect(overview.phases.map((row) => [row.name, row.status, row.progressPercent])).toEqual([["Envelope", "NOT_STARTED", null], ["Superstructure", "AT_RISK", 40]]);

    const inside = await milestone("Roof Watertight", { phaseId: envelope });
    await expect(archivePhase(pm, envelope)).rejects.toMatchObject(code("PHASE_HAS_MILESTONES"));
    await edit(inside, { phaseId: structure });
    await archivePhase(pm, envelope);
    expect((await getPlanningOverview(pm, SITE)).phases.map((row) => row.name)).toEqual(["Superstructure"]);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PROJECT_PHASE_ARCHIVED", projectId: SITE } })).toBeGreaterThanOrEqual(1);
  });

  it("suggests phase progress from its milestones without writing it", async () => {
    const id = await phase("Handover");
    const first = await milestone("Practical Completion", { phaseId: id });
    await milestone("Handover", { phaseId: id });
    await completeMilestone(pm, first, { expectedVersion: 1, actualDate: null, completionNote: null });
    const [summary] = (await getPlanningOverview(pm, SITE)).phases;
    expect(summary).toMatchObject({ suggestedProgress: 50, progressPercent: null, completedCount: 1, milestoneCount: 2 });
  });
});

describe("milestones (§12-§31, §141-§146, §188-§190, §204-§206, §284)", () => {
  it("creates a milestone with the forecast and baseline defaulting to the planned date", async () => {
    const planned = addLocalDays(today(), 30);
    const id = await milestone("Structure Complete", { plannedDate: planned, critical: true, externallyCommitted: true, ownerMemberId: qaqc.membershipId, milestoneType: "CONSTRUCTION" });
    const row = await detail(id);
    expect(row).toMatchObject({ status: "NOT_STARTED", plannedDate: planned, forecastDate: planned, baselineDate: planned, varianceDays: 0, critical: true, externallyCommitted: true, type: "CONSTRUCTION", owner: { memberId: qaqc.membershipId } });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_ASSIGNED" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "PROJECT_MILESTONE_CREATED" } })).toBe(1);
    expect(row.history.map((entry) => entry.action)).toContain("Milestone created");
  });

  it("refuses a baseline typed in by someone without the baseline grant, owners from off the project, and other companies' people", async () => {
    await expect(milestone("Design Freeze", { baselineDate: today() }, without(pm, "project_planning.baseline.manage"))).rejects.toMatchObject(code("MILESTONE_BASELINE_FORBIDDEN"));
    await expect(milestone("Design Freeze", { ownerMemberId: engineer.membershipId })).rejects.toMatchObject(code("PLANNING_MEMBER_INVALID"));
    await expect(milestone("Design Freeze", { ownerMemberId: ownerB.membershipId })).rejects.toMatchObject(code("PLANNING_MEMBER_INVALID"));
    await expect(createMilestone(pm, PROJECT.companyB, createMilestoneSchema.parse({ name: "Elsewhere" }))).rejects.toMatchObject(code("PLANNING_PROJECT_NOT_FOUND"));
    const otherPhase = await prisma.projectPhase.create({ data: { companyId: COMPANY.a, projectId: COPY_TARGET, name: "Marina phase", sortOrder: 1, createdByMemberId: owner.membershipId } });
    await expect(milestone("Wrong phase", { phaseId: otherPhase.id })).rejects.toMatchObject(code("PLANNING_PHASE_INVALID"));
  });

  it("keeps baseline and forecast apart, derives variance and delay, and flags a stale edit", async () => {
    const id = await milestone("Foundation Complete", { plannedDate: addLocalDays(today(), -12) });
    let row = await detail(id);
    expect(row).toMatchObject({ delayed: true, overdueDays: 12, varianceDays: 0 });

    await edit(id, { forecastDate: addLocalDays(today(), 3), status: "IN_PROGRESS", forecastReason: "Pile tests ran long" });
    row = await detail(id);
    expect(row).toMatchObject({ baselineDate: addLocalDays(today(), -12), forecastDate: addLocalDays(today(), 3), varianceDays: 15, delayed: false });
    expect(row.history.find((entry) => entry.action === "Forecast changed")?.note).toBe("Pile tests ran long");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_UPDATED" } })).toBe(1);

    // A progress nudge is not news (§210).
    await quickUpdateMilestone(pm, id, { expectedVersion: row.version, progressPercent: 55, forecastReason: null });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_UPDATED" } })).toBe(1);
    await expect(quickUpdateMilestone(pm, id, { expectedVersion: row.version, progressPercent: 60, forecastReason: null })).rejects.toMatchObject(code("PLANNING_STALE"));
    await expect(edit(id, { status: "COMPLETED" })).rejects.toMatchObject(code("MILESTONE_COMPLETE_REQUIRED"));
    await expect(edit(id, { actualDate: today() })).rejects.toMatchObject(code("MILESTONE_ACTUAL_NOT_ALLOWED"));

    const overview = await getPlanningOverview(pm, SITE);
    expect(overview.metrics).toMatchObject({ total: 1, completed: 0, upcoming: 1, delayed: 0 });
  });

  it("completes with today's actual date by default, leaves the tasks alone, and reopens only with the grant and a reason", async () => {
    const id = await milestone("Roof Watertight", { plannedDate: addLocalDays(today(), 5), ownerMemberId: qaqc.membershipId });
    const { taskId } = await createTaskFromMilestone(pm, id, { title: "Membrane install", description: null, assigneeMemberId: null, dueDate: null, priority: "MEDIUM", linkType: "DELIVERS" });
    createdTasks.push(taskId);

    await expect(completeMilestone(pm, id, { expectedVersion: 1, actualDate: addLocalDays(today(), 1), completionNote: null })).rejects.toMatchObject(code("MILESTONE_ACTUAL_FUTURE"));
    await expect(completeMilestone(without(pm, "project_planning.milestone.complete"), id, { expectedVersion: 1, actualDate: null, completionNote: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await completeMilestone(pm, id, { expectedVersion: (await detail(id)).version, actualDate: null, completionNote: "Watertight on all blocks" });
    expect(result.actualDate).toBe(today());
    expect(await detail(id)).toMatchObject({ status: "COMPLETED", actualDate: today(), progressPercent: 100, completionNote: "Watertight on all blocks" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("TODO");
    expect(await prisma.auditEvent.count({ where: { entityId: id, actionKey: "PROJECT_MILESTONE_COMPLETED" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_COMPLETED" } })).toBe(1);

    const version = (await detail(id)).version;
    await expect(reopenMilestone(without(pm, "project_planning.milestone.reopen"), id, { expectedVersion: version, reason: "Leak found" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reopenMilestone(ceo, id, { expectedVersion: version, reason: "Leak found" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reopenMilestone(pm, id, { expectedVersion: version, reason: "Leak found at the east parapet" });
    const reopened = await detail(id);
    expect(reopened).toMatchObject({ status: "IN_PROGRESS", actualDate: null });
    expect(reopened.reopenedAt).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, actionKey: "PROJECT_MILESTONE_REOPENED" } });
    expect(audit.reason).toBe("Leak found at the east parapet");
  });

  it("finishing every linked task does not finish the milestone (§54)", async () => {
    const id = await milestone("MEP First Fix");
    const { taskId } = await createTaskFromMilestone(pm, id, { title: "Riser first fix", description: null, assigneeMemberId: pm.membershipId, dueDate: null, priority: "MEDIUM", linkType: "SUPPORTS" });
    createdTasks.push(taskId);
    await completeTask(pm, taskId);
    const row = await detail(id);
    expect(row.taskStats).toEqual({ total: 1, completed: 1 });
    expect(row.status).toBe("NOT_STARTED");
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { entityType: true, entityId: true } })).toEqual({ entityType: "project_milestone", entityId: id });
  });

  it("archives a milestone only once nothing live depends on it", async () => {
    const first = await milestone("Frame");
    const second = await milestone("Cladding");
    const { id: dependencyId } = await addDependency(pm, second, { predecessorMilestoneId: first, lagDays: 0 });
    await expect(archiveMilestone(pm, first)).rejects.toMatchObject(code("MILESTONE_HAS_DEPENDENTS"));
    await removeDependency(pm, second, dependencyId);
    await archiveMilestone(pm, first);
    expect((await getPlanningOverview(pm, SITE)).milestones.map((row) => row.name)).toEqual(["Cladding"]);
    await expect(archiveMilestone(without(pm, "project_planning.manage"), second)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("baseline (§16, §21-§23, §76, §196, §202, §209, §297)", () => {
  it("sets a first baseline without a reason, needs one to move it, audits both dates and honours the lock", async () => {
    const id = await milestone("Design Freeze", { baselineDate: null, plannedDate: null, forecastDate: addLocalDays(today(), 20) });
    let row = await detail(id);
    expect(row.baselineDate).toBeNull();
    await changeBaseline(pm, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 18), reason: null });
    row = await detail(id);
    expect(row).toMatchObject({ baselineDate: addLocalDays(today(), 18), varianceDays: 2 });

    await expect(changeBaseline(pm, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 25), reason: null })).rejects.toMatchObject(code("MILESTONE_BASELINE_REASON_REQUIRED"));
    await expect(changeBaseline(engineer, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 25), reason: "x" })).rejects.toBeTruthy();
    await expect(changeBaseline(ceo, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 25), reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeBaseline(pm, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 25), reason: "Client approved the revised design programme" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: id, actionKey: "PROJECT_MILESTONE_BASELINE_CHANGED", reason: { not: null } } });
    expect(audit.reason).toBe("Client approved the revised design programme");
    expect(JSON.stringify(audit)).toContain(addLocalDays(today(), 18));
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "BASELINE_CHANGED" } })).toBe(2);

    await setBaselineLock(pm, SITE, true);
    row = await detail(id);
    expect(row.capabilities.canChangeBaseline).toBe(false);
    await expect(changeBaseline(pm, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 30), reason: "Again" })).rejects.toMatchObject(code("MILESTONE_BASELINE_LOCKED"));
    await expect(setBaselineLock(pm, SITE, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeBaseline(owner, id, { expectedVersion: row.version, newBaselineDate: addLocalDays(today(), 30), reason: "Contract variation 4" });
    await setBaselineLock(owner, SITE, false);
    expect((await getPlanningOverview(pm, SITE)).baselineLocked).toBe(false);
  });
});

describe("dependencies (§32-§39, §158-§163, §285, §296)", () => {
  it("allows finish-to-start with lag inside one project and refuses self, duplicate, cycle, cross-project and cross-company edges", async () => {
    const [a, b, c] = [await milestone("A", { plannedDate: addLocalDays(today(), -4) }), await milestone("B", { plannedDate: addLocalDays(today(), 10) }), await milestone("C", { plannedDate: addLocalDays(today(), 12) })];
    await addDependency(pm, b, { predecessorMilestoneId: a, lagDays: 3 });
    await addDependency(pm, c, { predecessorMilestoneId: b, lagDays: 7 });
    await expect(addDependency(pm, a, { predecessorMilestoneId: a, lagDays: 0 })).rejects.toMatchObject(code("DEPENDENCY_SELF"));
    await expect(addDependency(pm, b, { predecessorMilestoneId: a, lagDays: 0 })).rejects.toMatchObject(code("DEPENDENCY_DUPLICATE"));
    await expect(addDependency(pm, a, { predecessorMilestoneId: c, lagDays: 0 })).rejects.toMatchObject(code("DEPENDENCY_CYCLE"));
    await expect(addDependency(pm, a, { predecessorMilestoneId: M.structure, lagDays: 0 })).rejects.toMatchObject(code("DEPENDENCY_CROSS_PROJECT"));
    await expect(addDependency(pm, a, { predecessorMilestoneId: M.companyB, lagDays: 0 })).rejects.toMatchObject(code("DEPENDENCY_MILESTONE_INVALID"));
    // Marina is not the PM's project: its milestone answers like a missing id, never "another project" (PRD #47 §51).
    const marina = (await createMilestone(owner, COPY_TARGET, createMilestoneSchema.parse({ name: "Marina milestone" }))).id;
    const refused = await addDependency(pm, a, { predecessorMilestoneId: marina, lagDays: 0 }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ ...code("DEPENDENCY_MILESTONE_INVALID"), reason: "SCOPE_DENIED" });
    expect((refused as Error).message).not.toMatch(/project/i);
    await expect(addDependency(without(pm, "project_planning.dependencies.manage"), a, { predecessorMilestoneId: b, lagDays: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const overview = await getPlanningOverview(pm, SITE);
    const byName = new Map(overview.milestones.map((row) => [row.name, row]));
    // A is four days late, so B warns; C is forecast before B plus its lag allows.
    expect(byName.get("B")).toMatchObject({ waitingOn: 1, dependencyWarning: "Predecessor delayed 4 days" });
    expect(byName.get("C")?.dependencyWarning).toContain("before its predecessors allow");
    expect(overview.dependencies).toHaveLength(2);
    const c_ = await detail(c);
    expect(c_.suggestion.forecastDate).toBe(addLocalDays(today(), 17));
    expect(c_.predecessors).toEqual([expect.objectContaining({ name: "B", lagDays: 7 })]);
    // Nothing was rescheduled (§38, §163).
    expect(c_.forecastDate).toBe(addLocalDays(today(), 12));

    const options = await milestoneOptions(pm, a);
    expect(options.milestones.find((row) => row.id === c)?.blocked).toBe(true);
    const timeline = await getPlanningTimeline(pm, SITE);
    expect(timeline.edges).toHaveLength(2);
  });
});

describe("blockers (§40-§43, §153-§157, §286)", () => {
  it("records a blocker with its task through the task service, raises critical attention and resolves it", async () => {
    const id = await milestone("Envelope Closed", { plannedDate: addLocalDays(today(), 40), critical: true });
    const blocker = await createBlocker(pm, id, { title: "Crane out of service", description: null, severity: "CRITICAL", ownerMemberId: qaqc.membershipId, dueDate: addLocalDays(today(), 3), createTask: true });
    createdTasks.push(blocker.taskId!);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: blocker.taskId! } });
    expect(task).toMatchObject({ projectId: SITE, entityType: "project_milestone", entityId: id, priority: "CRITICAL", assigneeMemberId: qaqc.membershipId });
    let row = await detail(id);
    expect(row.blockers[0]).toMatchObject({ severity: "CRITICAL", owner: { memberId: qaqc.membershipId }, linkedTask: { id: blocker.taskId } });
    expect(row.tasks).toEqual([expect.objectContaining({ taskId: blocker.taskId, linkType: "BLOCKS" })]);
    expect(row.suggestion.atRisk).toContain("An open critical blocker");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_BLOCKER_ASSIGNED" } })).toBe(1);

    const condition = attentionConditionDefinitions().find((entry) => entry.key === "CRITICAL_MILESTONE_BLOCKED")!;
    const candidate = (await condition.collect(pm.companyId, new Date())).find((entry) => entry.entityId === id);
    expect(candidate).toMatchObject({ entityType: "project_milestone", recipients: expect.arrayContaining([qaqc.membershipId, pm.membershipId]) });
    await reconcileAttention({ companyId: pm.companyId });
    expect(await prisma.attentionItem.count({ where: { entityId: id, conditionKey: "CRITICAL_MILESTONE_BLOCKED", status: "ACTIVE", recipientMemberId: qaqc.membershipId } })).toBe(1);

    await expect(resolveBlocker(engineer, blocker.id, { resolutionNote: null })).rejects.toBeTruthy();
    await resolveBlocker(pm, blocker.id, { resolutionNote: "Replacement crane on site" });
    row = await detail(id);
    expect(row.blockers[0]).toMatchObject({ resolutionNote: "Replacement crane on site", resolvedBy: { memberId: pm.membershipId } });
    expect(await condition.holds(pm.companyId, "project_milestone", id, new Date())).toBe(false);
    expect(await prisma.attentionItem.count({ where: { entityId: id, conditionKey: "CRITICAL_MILESTONE_BLOCKED", status: "ACTIVE" } })).toBe(0);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_BLOCKER_RESOLVED" } })).toBe(1);
  });
});

describe("tasks, meetings, daily logs and documents (§49-§64, §182-§185, §287-§291)", () => {
  it("links tasks of the same project only, counts them and unlinks without touching them", async () => {
    const id = await milestone("Curtain Wall Package");
    await linkTask(pm, id, { taskId: SITE_TASKS[0], linkType: "SUPPORTS" });
    await linkTask(pm, id, { taskId: SITE_TASKS[1], linkType: "RELATED" });
    await expect(linkTask(pm, id, { taskId: "task_001", linkType: "SUPPORTS" })).rejects.toMatchObject(code("MILESTONE_TASK_PROJECT_MISMATCH"));
    await expect(linkTask(pm, id, { taskId: "task_b_01", linkType: "SUPPORTS" })).rejects.toMatchObject(code("MILESTONE_TASK_INVALID"));
    expect((await detail(id)).taskStats).toEqual({ total: 2, completed: 0 });
    await unlinkTask(pm, id, SITE_TASKS[1]);
    expect((await detail(id)).tasks.map((task) => task.taskId)).toEqual([SITE_TASKS[0]]);
    expect(await prisma.task.count({ where: { id: SITE_TASKS[1] } })).toBe(1);
  });

  it("links a meeting and a daily log of the milestone's own project, and shows each reader only what they can open", async () => {
    const facade = M.facade;
    const meeting = await prisma.meeting.findFirstOrThrow({ where: { projectId: PROJECT.a }, select: { id: true } });
    const log = await prisma.dailyLog.findFirstOrThrow({ where: { projectId: PROJECT.a, status: "LOCKED" }, select: { id: true } });
    const meetingLink = await linkRecord(pm, facade, "meeting", meeting.id);
    await linkRecord(pm, facade, "daily_log", log.id);
    const own = await detail(facade);
    expect(own.meetings).toEqual([expect.objectContaining({ recordId: meeting.id, restricted: false })]);
    expect(own.dailyLogs).toEqual([expect.objectContaining({ recordId: log.id, restricted: false, href: `/projects/${PROJECT.a}/daily-logs/${log.id}` })]);

    // Finance reads the plan but not the site diary (§184).
    const theirs = await getMilestone(finance, facade);
    expect(theirs.dailyLogs).toEqual([expect.objectContaining({ label: "A daily log you cannot open", href: null, restricted: true })]);

    const siteMilestone = await milestone("Office Tower Mobilization");
    await expect(linkRecord(pm, siteMilestone, "meeting", meeting.id)).rejects.toMatchObject(code("MILESTONE_RECORD_PROJECT_MISMATCH"));
    await expect(linkRecord(pm, siteMilestone, "daily_log", "not_a_log")).rejects.toMatchObject(code("MILESTONE_RECORD_INVALID"));
    await expect(linkRecord(viewer, facade, "meeting", meeting.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await unlinkRecord(pm, facade, meetingLink.linkId);
    expect((await detail(facade)).meetings).toEqual([]);
    expect(await prisma.meeting.count({ where: { id: meeting.id } })).toBe(1);
  });

  it("takes files from the plan's keepers, and only on a live milestone the reader can open", async () => {
    const id = await milestone("Occupancy Permit");
    const ref = { projectId: SITE, clientId: null, module: "projects", entityType: "project_milestone", entityId: id };
    expect(await canAttachToDocumentParent(pm, ref)).toBe(true);
    expect(await canAttachToDocumentParent(engineer, ref)).toBe(false);
    expect(await canAttachToDocumentParent(qaqc, ref)).toBe(false);
    expect(await loadRecord(pm, "project_milestone", id)).toMatchObject({ href: `/projects/${SITE}/planning?milestone=${id}`, projectId: SITE });
    expect(await loadRecord(engineer, "project_milestone", id)).toBeNull();
    expect(await loadRecord(ownerB, "project_milestone", id)).toBeNull();
  });
});

describe("access by role, project and company (§77-§95, §225-§233, §295)", () => {
  it("lets the people on a project read its plan and keeps everybody else out", async () => {
    const id = await milestone("Core Complete");
    expect((await getPlanningOverview(qaqc, SITE)).capabilities.canCreateMilestone).toBe(false);
    expect((await getPlanningOverview(ceo, SITE)).milestones).toHaveLength(1);
    await expect(createMilestone(ceo, SITE, createMilestoneSchema.parse({ name: "Nope" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getPlanningOverview(engineer, SITE)).rejects.toMatchObject(code("PLANNING_PROJECT_NOT_FOUND"));
    await expect(getPlanningOverview(architect, SITE)).rejects.toMatchObject(code("PLANNING_PROJECT_NOT_FOUND"));
    await expect(getMilestone(engineer, id)).rejects.toMatchObject(code("MILESTONE_NOT_FOUND"));
    await expect(getMilestone(ownerB, id)).rejects.toBeTruthy();
    for (const context of [groupIt, hr]) await expect(getPlanningOverview(context, PROJECT.a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getPlanningOverview(viewer, PROJECT.a)).capabilities).toMatchObject({ canEditMilestone: false, canCreatePhase: false });
    const riverside = await getPlanningOverview(engineer, PROJECT.a);
    expect(riverside.milestones.length).toBeGreaterThanOrEqual(11);
    await expect(edit(M.structure, { name: "Renamed" }, engineer)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps an archived project's plan read-only", async () => {
    // The archived project is Fixture Works', and so is its Owner.
    const worksOwner = await loginAsEmail(DEMO_EMAIL.fixtureOwner);
    const archivedMilestone = await prisma.projectMilestone.create({ data: { companyId: COMPANY.works, projectId: PROJECT.archived, name: "Old handover", milestoneType: "HANDOVER", sortOrder: 1, createdByMemberId: worksOwner.membershipId } });
    const row = await getMilestone(worksOwner, archivedMilestone.id);
    expect(row.capabilities.canEdit).toBe(false);
    await expect(edit(archivedMilestone.id, { name: "Changed" }, worksOwner)).rejects.toMatchObject(code("PLANNING_PROJECT_ARCHIVED"));
  });
});

describe("templates and copying (§133-§139)", () => {
  it("fills an empty plan from a template, never over an existing one", async () => {
    const result = await applyTemplate(pm, SITE, "commercial");
    expect(result).toMatchObject({ phases: 8 });
    const overview = await getPlanningOverview(pm, SITE);
    expect(overview.phases).toHaveLength(8);
    expect(overview.milestones.every((row) => row.status === "NOT_STARTED" && row.baselineDate === null && row.plannedDate !== null)).toBe(true);
    expect(overview.dependencies.length).toBeGreaterThan(5);
    expect(overview.templateKey).toBe("commercial");
    await expect(applyTemplate(pm, SITE, "residential")).rejects.toMatchObject(code("PLANNING_NOT_EMPTY"));
    await expect(applyTemplate(pm, SITE, "unknown")).rejects.toBeTruthy();
  });

  it("copies another project's structure and dependencies without actual dates, statuses or links", async () => {
    const result = await copyPlanning(owner, COPY_TARGET, PROJECT.a);
    expect(result.milestones).toBeGreaterThanOrEqual(11);
    const overview = await getPlanningOverview(owner, COPY_TARGET);
    expect(overview.phases.map((row) => row.name)).toEqual(["Pre-Construction", "Structure", "Envelope", "MEP", "Commissioning", "Handover"]);
    expect(overview.milestones.every((row) => row.status === "NOT_STARTED" && row.actualDate === null && row.baselineDate === null && row.taskStats.total === 0)).toBe(true);
    expect(overview.dependencies.length).toBe(10);
    await expect(copyPlanning(owner, COPY_TARGET, PROJECT.a)).rejects.toMatchObject(code("PLANNING_NOT_EMPTY"));
    await expect(copyPlanning(architect, COPY_TARGET, PROJECT.a)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("calendar, notifications, attention, reporting and search (§65-§74, §171-§177, §288, §292-§294)", () => {
  it("puts milestones on the calendar of people who can open the plan, on the date that matters, linking to the drawer", async () => {
    const id = await milestone("Topping Out", { plannedDate: addLocalDays(today(), 2), critical: true });
    const provider = calendarProviders.get("milestones")!;
    const range = { from: new Date(`${addLocalDays(today(), -1)}T00:00:00Z`), to: new Date(`${addLocalDays(today(), 5)}T00:00:00Z`) };
    const events = await provider.getEvents({ context: pm, range, filters: {}, timezone: ZONE });
    expect(events.find((event) => event.sourceId === id)).toMatchObject({ category: "MILESTONE", allDay: true, draggable: false, href: `/projects/${SITE}/planning?milestone=${id}`, priority: "HIGH" });
    expect((await provider.getEvents({ context: engineer, range, filters: {}, timezone: ZONE })).some((event) => event.sourceId === id)).toBe(false);
    expect((await provider.getEvents({ context: ownerB, range, filters: {}, timezone: ZONE })).some((event) => event.sourceId === id)).toBe(false);
    expect(provider.enabled(groupIt)).toBe(false);
    expect((await provider.getEvents({ context: pm, range, filters: { categories: ["TASK"] }, timezone: ZONE })).length).toBe(0);
  });

  it("reminds owners once per target date before and after it falls due, and opens attention for the overdue", async () => {
    const soon = await milestone("Facade Mockup Approved", { plannedDate: addLocalDays(today(), 3), ownerMemberId: qaqc.membershipId });
    const late = await milestone("Basement Waterproofed", { plannedDate: addLocalDays(today(), -2), ownerMemberId: qaqc.membershipId, critical: true });

    const first = await runMilestoneReminders(new Date());
    expect(first.dueSoon).toBeGreaterThanOrEqual(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: soon, eventType: "MILESTONE_DUE_SOON" } })).toBe(1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: late, eventType: "MILESTONE_OVERDUE" } })).toBe(1);
    await runMilestoneReminders(new Date());
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: { in: [soon, late] } } })).toBe(4);

    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: soon, recipientMemberId: qaqc.membershipId, eventType: "MILESTONE_DUE_SOON" } })).toBe(1);
    expect(await prisma.notification.count({ where: { entityId: late, recipientMemberId: pm.membershipId, eventType: "MILESTONE_OVERDUE" } })).toBe(1);

    await reconcileAttention({ companyId: pm.companyId });
    expect(await prisma.attentionItem.count({ where: { entityId: late, conditionKey: "MILESTONE_OVERDUE", status: "ACTIVE" } })).toBe(2);
    // Moving the forecast into the future ends the condition at once (§73).
    await edit(late, { forecastDate: addLocalDays(today(), 10) });
    expect(await prisma.attentionItem.count({ where: { entityId: late, conditionKey: "MILESTONE_OVERDUE", status: "ACTIVE" } })).toBe(0);

    await edit(soon, { status: "AT_RISK" });
    const atRisk = attentionConditionDefinitions().find((entry) => entry.key === "MILESTONE_AT_RISK")!;
    expect((await atRisk.collect(pm.companyId, new Date())).some((entry) => entry.entityId === soon)).toBe(true);
    await reconcileAttention({ companyId: pm.companyId });
    expect(await prisma.attentionItem.count({ where: { entityId: soon, conditionKey: "MILESTONE_AT_RISK", status: "ACTIVE" } })).toBeGreaterThanOrEqual(1);
    await edit(soon, { status: "IN_PROGRESS" });
    expect(await prisma.attentionItem.count({ where: { entityId: soon, conditionKey: "MILESTONE_AT_RISK", status: "ACTIVE" } })).toBe(0);
  });

  it("reports status, variance, overdue and critical milestones for the projects a reader can open", async () => {
    await milestone("Late one", { plannedDate: addLocalDays(today(), -6), critical: true });
    const moved = await milestone("Moved one", { plannedDate: addLocalDays(today(), 10) });
    await edit(moved, { forecastDate: addLocalDays(today(), 22) });
    const done = await milestone("Done one", { plannedDate: addLocalDays(today(), -1) });
    await completeMilestone(pm, done, { expectedVersion: 1, actualDate: addLocalDays(today(), -3), completionNote: null });

    const report = await planningReport(pm, reportQuerySchema.parse({ projectId: SITE }));
    expect(report.totals).toMatchObject({ total: 3, completed: 1, delayed: 1, critical: 1 });
    expect(report.overdue.map((row) => row.name)).toEqual(["Late one"]);
    expect(report.variance.map((row) => [row.name, row.varianceDays])).toEqual([["Moved one", 12], ["Late one", 0], ["Done one", -2]]);
    expect(report.byStatus.find((row) => row.status === "COMPLETED")?.count).toBe(1);
    expect(report.portfolio).toEqual([expect.objectContaining({ projectId: SITE, criticalDelays: 1 })]);

    const everywhere = await planningReport(ceo, reportQuerySchema.parse({}));
    expect(everywhere.byProject.map((row) => row.projectId)).toEqual(expect.arrayContaining([SITE, PROJECT.a]));
    const engineerView = await planningReport(engineer, reportQuerySchema.parse({}));
    expect(engineerView.byProject.some((row) => row.projectId === SITE)).toBe(false);

    expect((await upcomingMilestones(pm, 10)).some((row) => row.name === "Late one")).toBe(true);
    expect((await criticalMilestones(ceo, 20)).some((row) => row.name === "Late one")).toBe(true);
    expect((await listMilestones(pm, SITE, milestoneListSchema.parse({ quick: "delayed" }))).map((row) => row.name)).toEqual(["Late one"]);
  });

  it("finds milestones by name, project and phase, only for readers of the plan", async () => {
    await milestone("Atrium Glazing Complete");
    const results = await globalSearch(pm, "Atrium Glazing");
    expect(results.results.find((result) => result.entityType === "project_milestone")).toMatchObject({ title: "Atrium Glazing Complete", href: expect.stringContaining(`/projects/${SITE}/planning?milestone=`) });
    expect((await globalSearch(engineer, "Atrium Glazing")).results.some((result) => result.entityType === "project_milestone")).toBe(false);
    expect((await globalSearch(ownerB, "Atrium Glazing")).results.some((result) => result.entityType === "project_milestone")).toBe(false);
  });
});
