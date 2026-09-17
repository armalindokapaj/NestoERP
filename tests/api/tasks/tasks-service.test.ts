import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import {
  createTaskSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Tasks authorisation and lifecycle tests (PRD #11 §202–§219, §243).
 *
 * These call the same service the API routes and the UI call, so a test that
 * passes here is a statement about the running product, not about a mock
 * (PRD #9 §223).
 */
const created: string[] = [];
/** Another of Aurelia's projects, run by the Project Manager, with a task of theirs: the demo gives each company only one. */
const OTHER_PROJECT = "test11_task_other_project";
const OTHER_TASK = "test11_task_other_task";

beforeAll(async () => {
  const pm = await loginAs("PROJECT_MANAGER");
  await prisma.project.create({ data: { id: OTHER_PROJECT, companyId: COMPANY.a, code: "T11-TASK", name: "Tasks Elsewhere", status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "test" } });
  await prisma.task.create({ data: { id: OTHER_TASK, companyId: COMPANY.a, projectId: OTHER_PROJECT, title: "Survey the other site", assigneeMemberId: pm.membershipId, createdByMemberId: pm.membershipId, createdBy: pm.userId } });
});

async function track<T extends { id: string }>(task: Promise<T>): Promise<T> {
  const result = await task;
  created.push(result.id);
  return result;
}

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: created } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: created } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.task.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { id: OTHER_TASK } });
  await prisma.project.deleteMany({ where: { id: OTHER_PROJECT } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const listQuery = taskListQuerySchema.parse({});

function createInput(overrides: Record<string, unknown> = {}) {
  return createTaskSchema.parse({ title: "Authorisation test task", ...overrides });
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return updateTaskSchema.parse({ title: "Authorisation test task", ...overrides });
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/* -------------------------------------------------------------------------- */

describe("list scope (PRD #11 §203, §204)", () => {
  it("gives the Owner company-wide tasks", async () => {
    const context = await loginAs("OWNER");
    const result = await tasks.listTasks(context, listQuery);
    expect(result.pagination.total).toBeGreaterThan(10);
  });

  it("keeps My Tasks to the caller's own assignments", async () => {
    const context = await loginAs("ARCHITECT");
    const result = await tasks.listTasks(
      context,
      taskListQuerySchema.parse({ mine: true, limit: 100 }),
    );

    expect(result.data.length).toBeGreaterThan(0);
    for (const task of result.data) {
      expect(task.assignee?.memberId).toBe(context.membershipId);
    }
  });

  it("excludes archived tasks from ordinary lists and includes them in Archived", async () => {
    const context = await loginAs("OWNER");

    const live = await tasks.listTasks(context, taskListQuerySchema.parse({ limit: 100 }));
    expect(live.data.every((task) => task.status !== "ARCHIVED")).toBe(true);

    const archived = await tasks.listTasks(
      context,
      taskListQuerySchema.parse({ archived: true, limit: 100 }),
    );
    expect(archived.data.length).toBeGreaterThan(0);
    expect(archived.data.every((task) => task.status === "ARCHIVED")).toBe(true);
  });

  /** Overdue is derived, and finished work is never overdue (PRD #11 §205). */
  it("returns only open, past-due work in the Overdue section", async () => {
    const context = await loginAs("OWNER");
    const result = await tasks.listTasks(
      context,
      taskListQuerySchema.parse({ due: "overdue", openOnly: true, limit: 100 }),
    );

    expect(result.data.length).toBeGreaterThan(0);
    for (const task of result.data) {
      expect(task.isOverdue).toBe(true);
      expect(["TODO", "IN_PROGRESS", "BLOCKED"]).toContain(task.status);
    }
  });

  /**
   * A Viewer is ASSIGNED-scoped: their own work, plus the projects they
   * actually belong to. Nothing from a project they are not on (PRD #11 §22,
   * §140, §203).
   */
  it("keeps a Viewer to their own work and their own projects", async () => {
    const context = await loginAs("VIEWER");
    const result = await tasks.listTasks(context, taskListQuerySchema.parse({ limit: 100 }));

    expect(result.data.length).toBeGreaterThan(0);
    for (const task of result.data) {
      const ownWork = task.assignee?.memberId === context.membershipId;
      const ownProject = task.project === null || task.project.id === PROJECT.a;
      expect(ownWork || ownProject).toBe(true);
    }

    // Aurelia's other project is outside their scope entirely.
    expect(result.data.some((task) => task.project?.id === OTHER_PROJECT)).toBe(false);
  });
});

describe("cross-company isolation (PRD #11 §215, §236)", () => {
  it("never returns Company A tasks to a Company B user", async () => {
    const contextB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const result = await tasks.listTasks(contextB, taskListQuerySchema.parse({ limit: 100 }));

    const companyA = await prisma.task.findFirst({
      where: { companyId: { not: contextB.companyId } },
      select: { id: true },
    });

    expect(companyA).not.toBeNull();
    expect(result.data.map((task) => task.id)).not.toContain(companyA!.id);
    await expectError(tasks.getTask(contextB, companyA!.id), "NOT_FOUND");
  });

  it("refuses to link a task to another company's project", async () => {
    const contextB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectError(
      tasks.createTask(contextB, createInput({ projectId: PROJECT.a })),
      "VALIDATION_ERROR",
    );
  });
});

describe("detail scope (PRD #11 §206)", () => {
  it("answers 404 rather than 403 for a task outside scope", async () => {
    const architect = await loginAs("ARCHITECT");
    const hidden = await prisma.task.findFirst({
      where: {
        companyId: architect.companyId,
        projectId: OTHER_PROJECT,
        assigneeMemberId: { not: architect.membershipId },
      },
      select: { id: true },
    });

    expect(hidden).not.toBeNull();
    await expectError(tasks.getTask(architect, hidden!.id), "NOT_FOUND");
  });
});

describe("create (PRD #11 §202, §208)", () => {
  it("creates a personal task and records the creator from the session", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));

    expect(task.creator?.memberId).toBe(context.membershipId);
    expect(task.status).toBe("TODO");
    expect(task.priority).toBe("MEDIUM");
  });

  it("refuses a Viewer", async () => {
    const context = await loginAs("VIEWER");
    await expectError(tasks.createTask(context, createInput()), "FORBIDDEN");
  });

  it("refuses a project the caller cannot reach", async () => {
    const context = await loginAs("ARCHITECT");
    await expectError(
      tasks.createTask(context, createInput({ projectId: OTHER_PROJECT })),
      "VALIDATION_ERROR",
    );
  });

  it("refuses an archived project (PRD #11 §173)", async () => {
    const context = await loginAs("OWNER");
    await expectError(
      tasks.createTask(context, createInput({ projectId: PROJECT.archived })),
      "VALIDATION_ERROR",
    );
  });

  /** Without task.assign a contributor may only take work themselves (§122). */
  it("refuses to assign somebody else without task.assign", async () => {
    const context = await loginAs("ARCHITECT");
    const other = await prisma.companyMember.findFirst({
      where: { companyId: context.companyId, id: { not: context.membershipId }, status: "ACTIVE" },
      select: { id: true },
    });

    await expectError(
      tasks.createTask(context, createInput({ assigneeMemberId: other!.id })),
      "FORBIDDEN",
    );
  });

  it("lets that same user assign the task to themselves", async () => {
    const context = await loginAs("ARCHITECT");
    const task = await track(
      tasks.createTask(context, createInput({ assigneeMemberId: context.membershipId })),
    );
    expect(task.assignee?.memberId).toBe(context.membershipId);
  });

  it("refuses an inactive member as assignee (PRD #11 §47)", async () => {
    const context = await loginAs("OWNER");
    const inactive = await prisma.companyMember.findFirst({
      where: { companyId: context.companyId, status: { not: "ACTIVE" } },
      select: { id: true },
    });

    if (!inactive) return;
    await expectError(
      tasks.createTask(context, createInput({ assigneeMemberId: inactive.id })),
      "VALIDATION_ERROR",
    );
  });

  /** Project work goes to the project team (PRD #11 §48, §97). */
  it("refuses to put project work on somebody who is not on the project", async () => {
    const context = await loginAs("OWNER");
    const outsider = await prisma.companyMember.findFirst({
      where: {
        companyId: context.companyId,
        status: "ACTIVE",
        projectMemberships: { none: { projectId: PROJECT.a } },
        managedProjects: { none: { id: PROJECT.a } },
      },
      select: { id: true },
    });

    expect(outsider).not.toBeNull();
    await expectError(
      tasks.createTask(
        context,
        createInput({ projectId: PROJECT.a, assigneeMemberId: outsider!.id }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("rejects a due date before the start date (PRD #11 §50)", () => {
    expect(() =>
      createTaskSchema.parse({
        title: "Backwards schedule",
        startDate: "2026-10-10",
        dueDate: "2026-10-01",
      }),
    ).toThrow();
  });
});

describe("status lifecycle (PRD #11 §209–§214)", () => {
  async function newTask() {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));
    return { context, task };
  }

  it("starts, completes and stamps completedAt on the server", async () => {
    const { context, task } = await newTask();

    const started = await tasks.startTask(context, task.id);
    expect(started.status).toBe("IN_PROGRESS");

    const completed = await tasks.completeTask(context, task.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.schedule.completedAt).not.toBeNull();
  });

  it("clears completedAt when the task is reopened (PRD #11 §212)", async () => {
    const { context, task } = await newTask();
    await tasks.completeTask(context, task.id);

    const reopened = await tasks.reopenTask(context, task.id);
    expect(reopened.status).toBe("TODO");
    expect(reopened.schedule.completedAt).toBeNull();
  });

  it("refuses to reopen a task that was never completed", async () => {
    const { context, task } = await newTask();
    await expectError(tasks.reopenTask(context, task.id), "CONFLICT");
  });

  it("refuses to complete an already-completed task (PRD #11 §69)", async () => {
    const { context, task } = await newTask();
    await tasks.completeTask(context, task.id);
    await expectError(tasks.completeTask(context, task.id), "CONFLICT");
  });

  it("blocks with a reason and unblocks, clearing it (PRD #38 §44)", async () => {
    const { context, task } = await newTask();
    await expectError(tasks.blockTask(context, task.id, "  "), "VALIDATION_ERROR");

    const blocked = await tasks.blockTask(context, task.id, "Waiting for the structural drawings");
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.blocked).toMatchObject({ reason: "Waiting for the structural drawings", byMemberId: context.membershipId });

    const started = await tasks.startTask(context, task.id);
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.blocked).toBeNull();
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.blockedReason).toBeNull();
  });

  it("does not let the edit form move a task into BLOCKED without a reason", async () => {
    const { context, task } = await newTask();
    const current = await tasks.getTask(context, task.id);
    await expectError(
      tasks.updateTask(context, task.id, {
        title: current.title,
        status: "BLOCKED",
        priority: current.priority,
      } as Parameters<typeof tasks.updateTask>[2]),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a Viewer every status action", async () => {
    const { task } = await newTask();
    const viewer = await loginAs("VIEWER");

    await expectError(tasks.startTask(viewer, task.id), "FORBIDDEN");
    await expectError(tasks.completeTask(viewer, task.id), "FORBIDDEN");
    await expectError(tasks.archiveTask(viewer, task.id), "FORBIDDEN");
  });
});

describe("archive and restore (PRD #11 §213, §214)", () => {
  it("remembers the pre-archive status and puts it back", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));

    await tasks.startTask(context, task.id);
    await tasks.archiveTask(context, task.id);

    const archived = await tasks.getTask(context, task.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.preArchiveStatus).toBe("IN_PROGRESS");
    expect(archived.archivedAt).not.toBeNull();

    await tasks.restoreTask(context, task.id);
    const restored = await tasks.getTask(context, task.id);
    expect(restored.status).toBe("IN_PROGRESS");
    expect(restored.archivedAt).toBeNull();
    expect(restored.preArchiveStatus).toBeNull();
  });

  it("keeps an archived task read-only until it is restored (PRD #11 §72)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));
    await tasks.archiveTask(context, task.id);

    await expectError(tasks.updateTask(context, task.id, updateInput()), "CONFLICT");
    await expectError(tasks.startTask(context, task.id), "CONFLICT");
    await expectError(tasks.archiveTask(context, task.id), "CONFLICT");
  });

  it("refuses to restore a task that is not archived", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));
    await expectError(tasks.restoreTask(context, task.id), "CONFLICT");
  });
});

describe("update (PRD #11 §207)", () => {
  it("refuses a stale write rather than overwriting another edit", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));

    await expectError(
      tasks.updateTask(
        context,
        task.id,
        updateInput({ title: "Stale", versionUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      ),
      "CONFLICT",
    );
  });

  it("records the status change as its own activity entry", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const task = await track(tasks.createTask(context, createInput()));

    await tasks.updateTask(context, task.id, updateInput({ status: "IN_PROGRESS" }));

    const activity = await tasks.listActivity(context, task.id, { page: 1, limit: 25 });
    const actions = activity.data.map((entry) => entry.action);
    expect(actions).toContain("TASK_CREATED");
    expect(actions).toContain("TASK_STATUS_CHANGED");
  });
});

describe("activity (PRD #11 §219)", () => {
  it("refuses activity for a task outside scope", async () => {
    const architect = await loginAs("ARCHITECT");
    const hidden = await prisma.task.findFirst({
      where: {
        companyId: architect.companyId,
        projectId: OTHER_PROJECT,
        assigneeMemberId: { not: architect.membershipId },
      },
      select: { id: true },
    });

    await expectError(
      tasks.listActivity(architect, hidden!.id, { page: 1, limit: 25 }),
      "NOT_FOUND",
    );
  });
});

describe("tasks raised from another module's record (PRD #38 §45-§47, §137)", () => {
  it("keeps a Sales task's trusted parent: listed under the opportunity, linked back from the task", async () => {
    const sales = await loginAs("SALES");
    const opportunity = await prisma.opportunity.findFirstOrThrow({
      where: { companyId: sales.companyId, archivedAt: null, ownerMemberId: sales.membershipId },
      select: { id: true, name: true },
    });

    const task = await track(
      tasks.createTaskFromContext(sales, {
        ...createInput({ title: "Send the revised quote" }),
        parentType: "opportunity",
        parentId: opportunity.id,
      }),
    );

    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ module: "sales", entityType: "opportunity", entityId: opportunity.id });

    const listed = await tasks.listTasks(
      sales,
      taskListQuerySchema.parse({ moduleKey: "sales", entityType: "opportunity", entityId: opportunity.id, limit: 100 }),
    );
    expect(listed.data.map((item) => item.id)).toContain(task.id);

    const detail = await tasks.getTask(sales, task.id);
    expect(detail.parent).toMatchObject({ type: "opportunity", href: `/sales/opportunities/${opportunity.id}` });
  });

  it("refuses a parent the creator cannot open, or one from another company", async () => {
    const engineer = await loginAs("ENGINEER");
    const sales = await loginAs("SALES");
    const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { companyId: sales.companyId } });
    const foreign = await prisma.opportunity.findFirst({ where: { companyId: { not: sales.companyId } } });

    // No Sales access at all: the module's task grant is missing.
    await expectError(
      tasks.createTaskFromContext(engineer, { ...createInput(), parentType: "opportunity", parentId: opportunity.id }),
      "FORBIDDEN",
    );
    if (foreign) {
      await expectError(
        tasks.createTaskFromContext(sales, { ...createInput(), parentType: "opportunity", parentId: foreign.id }),
        "VALIDATION_ERROR",
      );
    }
    await expectError(
      tasks.createTaskFromContext(sales, { ...createInput(), parentType: "not_a_record", parentId: "x" }),
      "VALIDATION_ERROR",
    );
  });

  it("hides the parent's name from a reader of the task who cannot open the parent", async () => {
    const owner = await loginAs("OWNER");
    const opportunity = await prisma.opportunity.findFirstOrThrow({ where: { companyId: owner.companyId, archivedAt: null } });
    const engineer = await loginAs("ENGINEER");
    const task = await track(
      tasks.createTaskFromContext(owner, {
        ...createInput({ title: "Parent visibility", assigneeMemberId: engineer.membershipId }),
        parentType: "opportunity",
        parentId: opportunity.id,
      }),
    );
    const seenByEngineer = await tasks.getTask(engineer, task.id);
    expect(seenByEngineer.parent).toBeNull();
  });
});
