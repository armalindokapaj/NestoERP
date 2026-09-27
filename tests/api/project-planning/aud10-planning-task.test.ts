import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createBlocker } from "@/lib/modules/project-planning/planning.blockers";
import { createTaskFromMilestone } from "@/lib/modules/project-planning/planning.links";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma, PROJECT } from "../../helpers";
import { expectRefusal, failingWrites, locker, orphanTaskHistory, raceBehindRow, removeTasks, settle } from "../tasks/aud10-support";

/**
 * AUD-10 §7 (CW-12, CW-13) for tasks raised from a milestone and from a
 * blocker: the task and what points at it commit in one transaction, one task
 * per click, and forged ids are refused before any write. A milestone of the
 * test's own on Riverside (prefix `aud10c_`), removed after each test.
 */

const MILESTONE = "aud10c_milestone";

let pm: UserContext;
let pm2: UserContext;
let tenantOwner: UserContext;

async function cleanup() {
  const raised = await prisma.task.findMany({ where: { entityType: "project_milestone", entityId: MILESTONE }, select: { id: true } });
  await prisma.projectMilestoneBlocker.deleteMany({ where: { milestoneId: MILESTONE } });
  await prisma.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: MILESTONE } });
  await removeTasks(raised.map((row) => row.id));
  await prisma.notification.deleteMany({ where: { entityId: MILESTONE } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: MILESTONE } });
  await prisma.attentionItem.deleteMany({ where: { entityId: MILESTONE } });
  await prisma.activity.deleteMany({ where: { entityId: MILESTONE } });
  await prisma.projectMilestone.deleteMany({ where: { id: MILESTONE } });
}

beforeAll(async () => {
  [pm, pm2, tenantOwner] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("PROJECT_MANAGER"), loginAsEmail(DEMO_EMAIL.tenantOwner)]);
  await cleanup();
});

async function milestone(): Promise<string> {
  await prisma.projectMilestone.create({ data: { id: MILESTONE, companyId: COMPANY.a, projectId: PROJECT.a, name: "aud10c Handover", sortOrder: 990, createdByMemberId: "member_pm" } });
  return MILESTONE;
}

afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

const taskInput = (overrides: Record<string, unknown> = {}) => ({ title: "aud10c membrane", description: null, assigneeMemberId: "member_engineer", dueDate: null, priority: "MEDIUM" as const, linkType: "DELIVERS" as const, ...overrides });
const blockerInput = (overrides: Record<string, unknown> = {}) => ({ title: "aud10c crane down", description: null, severity: "HIGH" as const, ownerMemberId: "member_qaqc", dueDate: null, createTask: true, ...overrides });
const raisedCount = () => prisma.task.count({ where: { entityType: "project_milestone", entityId: MILESTONE } });

describe("a task from a milestone (CW-12)", () => {
  it("commits the task, its link and the audit together; a failed link leaves no task", async () => {
    const id = await milestone();
    const since = new Date();
    await failingWrites("project_milestone_task_links", `NEW."milestoneId" = '${id}'`, async () => {
      expect((await settle(createTaskFromMilestone(pm, id, taskInput()))).ok).toBe(false);
    });
    expect(await raisedCount()).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);

    const { taskId } = await createTaskFromMilestone(pm, id, taskInput());
    expect(await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ projectId: PROJECT.a, entityType: "project_milestone", entityId: id, assigneeMemberId: "member_engineer" });
    expect(await prisma.projectMilestoneTaskLink.findFirstOrThrow({ where: { milestoneId: id } })).toMatchObject({ taskId, linkType: "DELIVERS" });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: taskId, eventType: "TASK_ASSIGNED" } })).toBe(1);
  });

  it("gives each of two simultaneous clicks its own linked task, and none once the milestone is archived under them", async () => {
    const id = await milestone();
    const since = new Date();
    const results = await raceBehindRow("project_milestones", id, [() => createTaskFromMilestone(pm, id, taskInput()), () => createTaskFromMilestone(pm2, id, taskInput())]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await raisedCount()).toBe(2);
    expect(await prisma.projectMilestoneTaskLink.count({ where: { milestoneId: id } })).toBe(2);
    expect(await orphanTaskHistory(since)).toBe(0);

    const archived = await raceBehindRow("project_milestones", id, [() => createTaskFromMilestone(pm, id, taskInput())], async (tx) => {
      await tx.projectMilestone.update({ where: { id }, data: { archivedAt: new Date() } });
    });
    await expectRefusal(Promise.reject((archived[0] as { error: unknown }).error), "MILESTONE_ARCHIVED");
    expect(await raisedCount()).toBe(2);
  });

  it("refuses a forged milestone from another company and an off-team assignee before writing", async () => {
    const id = await milestone();
    const since = new Date();
    // Another company's person naming this company's milestone: it does not exist for them.
    await expectRefusal(createTaskFromMilestone(tenantOwner, id, taskInput({ assigneeMemberId: null })), "MILESTONE_NOT_FOUND");
    await expectRefusal(createBlocker(tenantOwner, id, blockerInput({ ownerMemberId: null })), "MILESTONE_NOT_FOUND");
    await expectRefusal(createTaskFromMilestone(pm, id, taskInput({ assigneeMemberId: "member_sales" })), "VALIDATION_ERROR");
    expect(await raisedCount()).toBe(0);
    expect(await prisma.projectMilestoneTaskLink.count({ where: { milestoneId: id } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);
  });
});

describe("a task from a blocker (CW-12)", () => {
  it("commits the blocker and its task together, or neither", async () => {
    const id = await milestone();
    const since = new Date();
    await failingWrites("project_milestone_blockers", `NEW."milestoneId" = '${id}'`, async () => {
      expect((await settle(createBlocker(pm, id, blockerInput()))).ok).toBe(false);
    });
    expect(await raisedCount()).toBe(0);
    expect(await prisma.projectMilestoneBlocker.count({ where: { milestoneId: id } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);

    // The task service refusing the task refuses the blocker too: no blocker without the task it was asked for.
    await expectRefusal(createBlocker(pm, id, blockerInput({ ownerMemberId: "member_sales" })), "PLANNING_MEMBER_INVALID");
    expect(await prisma.projectMilestoneBlocker.count({ where: { milestoneId: id } })).toBe(0);

    const created = await createBlocker(pm, id, blockerInput());
    expect(created.taskId).not.toBeNull();
    expect(await prisma.projectMilestoneBlocker.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ linkedTaskId: created.taskId });
    expect(await prisma.projectMilestoneTaskLink.findFirstOrThrow({ where: { milestoneId: id } })).toMatchObject({ taskId: created.taskId, linkType: "BLOCKS" });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: created.taskId! } })).toMatchObject({ priority: "HIGH", assigneeMemberId: "member_qaqc", projectId: PROJECT.a });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: id, eventType: "MILESTONE_BLOCKER_ASSIGNED" } })).toBe(1);
  });
});
