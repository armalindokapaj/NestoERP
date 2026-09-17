import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { createCommentSchema, editCommentSchema, threadQuerySchema } from "@/lib/core/collaboration/collaboration.schema";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Contextual collaboration: comments, mentions, watchers (PRD #38 §39, §40,
 * §136, §148).
 *
 * Every test runs against a real task on a real project with the seeded
 * people, so "cannot see the record" means what it means in the product.
 */

const createdTasks: string[] = [];

async function taskOnProjectA(title = "Collaboration test task") {
  const pm = await loginAs("PROJECT_MANAGER");
  const engineer = await loginAs("ENGINEER");
  const task = await tasks.createTask(
    pm,
    createTaskSchema.parse({ title, projectId: PROJECT.a, assigneeMemberId: engineer.membershipId }),
  );
  createdTasks.push(task.id);
  return { pm, engineer, task };
}

const thread = (context: Parameters<typeof collaboration.getThread>[0], taskId: string) =>
  collaboration.getThread(context, "task", taskId, threadQuerySchema.parse({}));

const comment = (body: string) => createCommentSchema.parse({ body });

async function expectCode(promise: Promise<unknown>, code: string, message?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toBe(message);
}

afterEach(async () => {
  if (createdTasks.length === 0) return;
  const threads = await prisma.collaborationThread.findMany({
    where: { parentType: "task", parentId: { in: createdTasks } },
    select: { id: true },
  });
  const threadIds = threads.map((row) => row.id);
  const comments = await prisma.comment.findMany({ where: { threadId: { in: threadIds } }, select: { id: true } });
  const commentIds = comments.map((row) => row.id);
  await prisma.mention.deleteMany({ where: { commentId: { in: commentIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: commentIds } } });
  await prisma.comment.deleteMany({ where: { id: { in: commentIds } } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threadIds } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threadIds } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: createdTasks } } });
  await prisma.task.deleteMany({ where: { id: { in: createdTasks } } });
  createdTasks.length = 0;
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("comments on a record (PRD #38 §40)", () => {
  it("lets a project member comment, and shows the comment to others who can read the task", async () => {
    const { pm, engineer, task } = await taskOnProjectA();

    const created = await collaboration.createComment(pm, "task", task.id, comment("Please check the rebar spacing."));
    expect(created.segments).toEqual([{ type: "text", text: "Please check the rebar spacing." }]);
    expect(created.capabilities.canEdit).toBe(true);

    const seen = await thread(engineer, task.id);
    expect(seen.comments.map((row) => row.id)).toContain(created.id);
    expect(seen.comments.find((row) => row.id === created.id)?.capabilities.canEdit).toBe(false);
    expect(seen.parent).toMatchObject({ type: "task", href: `/tasks/${task.id}` });
  });

  it("subscribes the creator and the one accountable assignee when the task is created (PRD #38 §33)", async () => {
    const { pm, engineer, task } = await taskOnProjectA();
    const watchers = await collaboration.activeWatcherIds(pm.companyId, "task", task.id);
    expect(new Set(watchers)).toEqual(new Set([pm.membershipId, engineer.membershipId]));
  });

  it("renders an injected script as text, never as markup", async () => {
    const { pm, task } = await taskOnProjectA();
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const created = await collaboration.createComment(pm, "task", task.id, comment(payload));
    expect(created.segments).toEqual([{ type: "text", text: payload }]);
  });

  it("refuses an oversized or empty comment before it reaches the database", () => {
    expect(createCommentSchema.safeParse({ body: "x".repeat(5001) }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: "   \n  " }).success).toBe(false);
  });

  it("keeps the audit trail free of the comment text (PRD #38 §34, §156)", async () => {
    const { pm, task } = await taskOnProjectA();
    const created = await collaboration.createComment(pm, "task", task.id, comment("Confidential site note 7731"));
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actionKey: "COMMENT_CREATED", entityId: created.id } });
    expect(JSON.stringify(audit)).not.toContain("7731");
  });

  it("edits only your own comment, and archives rather than deletes", async () => {
    const { pm, engineer, task } = await taskOnProjectA();
    const created = await collaboration.createComment(pm, "task", task.id, comment("First draft"));

    await expectCode(collaboration.editComment(engineer, created.id, "Hijacked"), "FORBIDDEN");
    await expectCode(collaboration.archiveComment(engineer, created.id), "FORBIDDEN");

    const edited = await collaboration.editComment(pm, created.id, editCommentSchema.parse({ body: "Second draft" }).body);
    expect(edited.editedAt).not.toBeNull();

    await collaboration.archiveComment(pm, created.id);
    const after = await thread(engineer, task.id);
    const archived = after.comments.find((row) => row.id === created.id);
    expect(archived).toMatchObject({ archived: true, segments: null });
    expect(await prisma.comment.count({ where: { id: created.id } })).toBe(1);
  });
});

describe("parent authorisation is enforced on every call (PRD #38 §30, §39, §148)", () => {
  it("hides the thread from somebody who cannot read the task, as not found", async () => {
    const { pm, task } = await taskOnProjectA();
    await collaboration.createComment(pm, "task", task.id, comment("Only for the project team"));

    const sales = await loginAs("SALES");
    await expectCode(thread(sales, task.id), "NOT_FOUND");
    await expectCode(collaboration.createComment(sales, "task", task.id, comment("Can I?")), "NOT_FOUND");
    await expectCode(collaboration.setWatching(sales, "task", task.id, true), "NOT_FOUND");
  });

  it("refuses another company's record, its thread, its comments and a watch on it", async () => {
    const { pm, task } = await taskOnProjectA();
    const created = await collaboration.createComment(pm, "task", task.id, comment("Company A only"));

    const ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectCode(thread(ownerB, task.id), "NOT_FOUND");
    await expectCode(collaboration.createComment(ownerB, "task", task.id, comment("From B")), "NOT_FOUND");
    await expectCode(collaboration.editComment(ownerB, created.id, "From B"), "NOT_FOUND");
    await expectCode(collaboration.archiveComment(ownerB, created.id), "NOT_FOUND");
    await expectCode(collaboration.setWatching(ownerB, "task", task.id, true), "NOT_FOUND");
  });

  it("answers an unknown parent type exactly like a missing record", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    await expectCode(collaboration.getThread(pm, "nuclear_launch", "x", threadQuerySchema.parse({})), "NOT_FOUND");
    await expectCode(collaboration.getThread(pm, "task", "no-such-task", threadQuerySchema.parse({})), "NOT_FOUND");
  });

  it("closes the thread the moment access to the record is revoked, subscription or not", async () => {
    const owner = await loginAs("OWNER");
    const engineer = await loginAs("ENGINEER");
    const task = await tasks.createTask(
      owner,
      createTaskSchema.parse({ title: "Revocation test", projectId: PROJECT.a, assigneeMemberId: engineer.membershipId }),
    );
    createdTasks.push(task.id);
    await collaboration.createComment(owner, "task", task.id, comment("Before revocation"));
    expect((await thread(engineer, task.id)).watching).toBe(true);

    const membership = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: PROJECT.a, companyMemberId: engineer.membershipId },
    });
    await prisma.projectMember.update({ where: { id: membership.id }, data: { status: "INACTIVE" } });
    try {
      await expectCode(thread(engineer, task.id), "NOT_FOUND");
      await collaboration.createComment(owner, "task", task.id, comment("After revocation"));
      await dispatchNotifications(500);
      const told = await prisma.notification.count({
        where: { entityId: task.id, recipientMemberId: engineer.membershipId, eventType: "COMMENT_ADDED" },
      });
      expect(told).toBe(0);
    } finally {
      await prisma.projectMember.update({ where: { id: membership.id }, data: { status: membership.status } });
    }
  });

  it("keeps an archived task's discussion readable but closed to new comments", async () => {
    const { pm, engineer, task } = await taskOnProjectA();
    await collaboration.createComment(pm, "task", task.id, comment("Before archiving"));
    await tasks.archiveTask(pm, task.id);

    const archived = await thread(engineer, task.id);
    expect(archived.parent.archived).toBe(true);
    expect(archived.capabilities.canComment).toBe(false);
    await expectCode(collaboration.createComment(pm, "task", task.id, comment("After archiving")), "CONFLICT", "PARENT_ARCHIVED");
  });

  it("never lets the Viewer comment, though they may read and watch", async () => {
    const { pm, task } = await taskOnProjectA();
    await collaboration.createComment(pm, "task", task.id, comment("Visible to the viewer"));
    const viewer = await loginAs("VIEWER");

    const seen = await thread(viewer, task.id);
    expect(seen.capabilities).toEqual({ canComment: false, canWatch: true });
    await expectCode(collaboration.createComment(viewer, "task", task.id, comment("Viewer comment")), "FORBIDDEN");
    await expect(collaboration.setWatching(viewer, "task", task.id, true)).resolves.toEqual({ watching: true });
  });
});

describe("mentions (PRD #38 §31, §40, §148)", () => {
  it("notifies a mentioned member who can read the record, through the dispatcher", async () => {
    const { pm, task } = await taskOnProjectA();
    const architect = await loginAs("ARCHITECT");

    const created = await collaboration.createComment(
      pm,
      "task",
      task.id,
      comment(`@[Whatever label](${architect.membershipId}) please review the facade detail.`),
    );
    expect(created.segments?.[0]).toMatchObject({ type: "mention", memberId: architect.membershipId });
    // The name comes from the membership, not from the markup.
    expect((created.segments?.[0] as { name: string }).name).toBe(architect.fullName);

    await dispatchNotifications(500);
    const notification = await prisma.notification.findFirst({
      where: { recipientMemberId: architect.membershipId, eventType: "COMMENT_MENTIONED", entityId: task.id },
    });
    expect(notification).not.toBeNull();
    expect(notification?.category).toBe("mentions");

    // The mentioned member now watches the discussion.
    expect((await thread(architect, task.id)).watching).toBe(true);
  });

  it("refuses to mention somebody who cannot open the record", async () => {
    const { pm, task } = await taskOnProjectA();
    const sales = await loginAs("SALES");
    await expectCode(
      collaboration.createComment(pm, "task", task.id, comment(`@[Sales](${sales.membershipId}) look`)),
      "VALIDATION_ERROR",
      "MENTION_NOT_ALLOWED",
    );
  });

  it("refuses to mention a member of another company, whatever the markup claims", async () => {
    const { pm, task } = await taskOnProjectA();
    const ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectCode(
      collaboration.createComment(pm, "task", task.id, comment(`@[Owner](${ownerB.membershipId}) hello`)),
      "VALIDATION_ERROR",
      "MENTION_NOT_ALLOWED",
    );
  });

  it("offers in the picker only people who could open the record", async () => {
    const { pm, task } = await taskOnProjectA();
    const offered = await collaboration.listMentionableMembers(pm, "task", task.id, undefined);
    const ids = offered.map((row) => row.memberId);
    const sales = await loginAs("SALES");
    const architect = await loginAs("ARCHITECT");

    expect(ids).toContain(architect.membershipId);
    expect(ids).not.toContain(sales.membershipId);
    expect(ids).not.toContain(pm.membershipId);
  });
});
