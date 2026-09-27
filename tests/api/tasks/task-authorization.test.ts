import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * A task stays on its source's project, and its assignee on its project's team
 * (PRD #11 §48, PRD #38 §45-§47, PRD #47 §51).
 *
 * The parent of a task raised from another record used to be resolved — its
 * project computed — and then ignored, so a milestone on Project A could file
 * work on Project B or on no project at all. And an edit that moved a task to
 * another project skipped the assignee check whenever the assignee itself was
 * unchanged.
 */
const created: string[] = [];
/** Another of Aurelia's projects: the demo gives each company only one. */
const OTHER_PROJECT = "test47_task_other_project";

beforeAll(async () => {
  await prisma.project.create({ data: { id: OTHER_PROJECT, companyId: COMPANY.a, code: "T47-TASK", name: "Task Authorization Elsewhere", status: "ACTIVE", createdBy: "test" } });
});

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: created } } });
  const threads = await prisma.collaborationThread.findMany({
    where: { parentType: "task", parentId: { in: created } },
    select: { id: true },
  });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.task.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: OTHER_PROJECT } });
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectLinkRefused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
  expect((error as AccessError).details).toHaveProperty("projectId");
}

async function milestoneOnProjectA() {
  return prisma.projectMilestone.findFirstOrThrow({
    where: { projectId: PROJECT.a, archivedAt: null },
    select: { id: true },
  });
}

describe("a task raised from a project record stays on that project (PRD #47 §51)", () => {
  it("refuses another project, or none, and accepts the record's own", async () => {
    const owner = await loginAs("OWNER");
    const milestone = await milestoneOnProjectA();
    const from = (projectId?: string) =>
      tasks.createTaskFromContext(owner, {
        ...createTaskSchema.parse({ title: "Raised from a milestone", projectId }),
        parentType: "project_milestone",
        parentId: milestone.id,
      });

    await expectLinkRefused(from(OTHER_PROJECT));
    await expectLinkRefused(from(undefined));

    const task = await from(PROJECT.a);
    created.push(task.id);
    expect(task.project?.id).toBe(PROJECT.a);
  });

  it("refuses moving a parented task to another project, or off its project", async () => {
    const owner = await loginAs("OWNER");
    const milestone = await milestoneOnProjectA();
    const task = await tasks.createTaskFromContext(owner, {
      ...createTaskSchema.parse({ title: "Parented and staying put", projectId: PROJECT.a }),
      parentType: "project_milestone",
      parentId: milestone.id,
    });
    created.push(task.id);

    await expectLinkRefused(tasks.updateTask(owner, task.id, updateTaskSchema.parse({ title: task.title, projectId: OTHER_PROJECT, expectedVersion: task.version })));
    // "Off its project" is an explicit clear; leaving the project out keeps it (AUD-09 §4, FV-05).
    await expectLinkRefused(tasks.updateTask(owner, task.id, updateTaskSchema.parse({ title: task.title, projectId: null, expectedVersion: task.version })));

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.projectId).toBe(PROJECT.a);
  });
});

describe("moving a task re-checks its assignee against the new project (PRD #11 §48, PRD #47 §51)", () => {
  it("refuses a move that would keep an assignee who is not on the destination project", async () => {
    const owner = await loginAs("OWNER");

    const [destinationMembers, destination] = await Promise.all([
      prisma.projectMember.findMany({ where: { projectId: OTHER_PROJECT, status: "ACTIVE" }, select: { companyMemberId: true } }),
      prisma.project.findUniqueOrThrow({ where: { id: OTHER_PROJECT }, select: { projectManagerMemberId: true } }),
    ]);
    const excluded = [...destinationMembers.map((row) => row.companyMemberId), destination.projectManagerMemberId].filter(
      (id): id is string => Boolean(id),
    );
    const onlyOnA = await prisma.projectMember.findFirstOrThrow({
      where: {
        projectId: PROJECT.a,
        status: "ACTIVE",
        companyMemberId: { notIn: excluded },
        member: { status: "ACTIVE" },
      },
      select: { companyMemberId: true },
    });

    const task = await tasks.createTask(
      owner,
      createTaskSchema.parse({ title: "Moving between projects", projectId: PROJECT.a, assigneeMemberId: onlyOnA.companyMemberId }),
    );
    created.push(task.id);

    const error = await tasks
      .updateTask(
        owner,
        task.id,
        updateTaskSchema.parse({ title: task.title, projectId: OTHER_PROJECT, assigneeMemberId: onlyOnA.companyMemberId, expectedVersion: task.version }),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(AccessError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.projectId).toBe(PROJECT.a);
  });
});
