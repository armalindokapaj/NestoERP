import { appendFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as collaboration from "@/lib/core/collaboration/collaboration.service";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { createActionItem } from "@/lib/modules/meetings/meeting.actions";
import { createMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { createMeeting, startMeeting } from "@/lib/modules/meetings/meeting.service";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma, taskVersion } from "../../helpers";

/**
 * Task reliability (AUD-02 §10): the version contract, the atomic mutation and
 * its side effects, against the real database.
 *
 * Races use a barrier, not timing. A second connection takes the task's row
 * lock and holds it; the commands under test are started and the test waits
 * until Postgres itself reports each of them blocked behind that lock
 * (`pg_blocking_pids`); then the lock is released and they proceed in the
 * order the database gives them. Every command reached the point of deciding
 * against the same version, which is exactly the situation the old
 * read-then-write code lost updates in. Each race asserts the outcome whichever
 * command won, from the rows: the task, its version, its activity, its outbox
 * events and any linked meeting action.
 */

const PREFIX = "aud02_";
const created = new Set<string>();
const locker = new PrismaClient();

afterEach(async () => {
  if (created.size === 0) return;
  const ids = [...created];
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.comment.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.meetingActionItem.updateMany({ where: { linkedTaskId: { in: ids } }, data: { linkedTaskId: null } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  created.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

/**
 * Starts every command while the task's row is locked elsewhere, waits until
 * Postgres shows each one blocked behind that lock, then lets them all go.
 */
async function race<T>(taskId: string, commands: Array<() => Promise<T>>): Promise<Settled<T>[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => (holding = resolve));

  const holder = locker.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${taskId} FOR UPDATE`;
      holding(pid);
      await gate;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const pid = await holderPid;
  const running = commands.map((command) => settle(command()));
  await waitForBlocked(pid, commands.length);
  release();
  await holder;
  return Promise.all(running);
}

/**
 * Polls the database's own lock graph: synchronisation on an observed state,
 * not a sleep. Postgres queues a second waiter behind the first rather than
 * behind the holder, so the count follows the whole chain rooted at it.
 */
async function waitForBlocked(holderPid: number, count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
      WITH RECURSIVE "chain"("pid") AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "chain" c ON c."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "blocked" FROM "chain"`;
    if (blocked >= count) return;
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} commands reached the task lock`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof AccessError)) return undefined;
  return (error.details as { code?: string } | undefined)?.code ?? error.code;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<AccessError> {
  const outcome = await settle(promise);
  expect(outcome.ok, `expected ${code}`).toBe(false);
  const error = (outcome as { error: unknown }).error;
  expect(error).toBeInstanceOf(AccessError);
  expect(codeOf(error)).toBe(code);
  return error as AccessError;
}

async function personalTask(context: UserContext, overrides: Record<string, unknown> = {}) {
  const task = await tasks.createTask(context, createTaskSchema.parse({ title: `${PREFIX}task`, ...overrides }));
  created.add(task.id);
  return task;
}

function edit(overrides: Record<string, unknown>) {
  return updateTaskSchema.parse({ title: `${PREFIX}task`, priority: "MEDIUM", status: "TODO", ...overrides });
}

async function row(taskId: string) {
  return prisma.task.findUniqueOrThrow({ where: { id: taskId } });
}

async function activity(taskId: string, action?: string) {
  return prisma.activity.findMany({ where: { entityId: taskId, ...(action ? { action } : {}) }, orderBy: { createdAt: "asc" } });
}

async function outbox(taskId: string, eventType?: string) {
  return prisma.notificationEventOutbox.findMany({ where: { entityId: taskId, ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: "asc" } });
}

async function activeColleague(context: UserContext, exclude: string[] = []) {
  return prisma.companyMember.findFirstOrThrow({
    where: { companyId: context.companyId, status: "ACTIVE", id: { notIn: [context.membershipId, ...exclude] }, user: { status: "ACTIVE" } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
}

/** A failure raised by the database itself, for writes that match `condition`, while `run` runs. */
async function failingWrites(table: string, condition: string, run: () => Promise<void>): Promise<void> {
  const name = `aud02_fail_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'injected failure (AUD-02)'; END IF; RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

/* -------------------------------------------------------------------------- */
/* TR-01, TR-02                                                                */
/* -------------------------------------------------------------------------- */

describe("the version (TR-01, TR-02)", () => {
  it("starts every task at 1, and every existing task has one", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    expect(task.version).toBe(1);
    expect((await row(task.id)).version).toBe(1);
    expect(await prisma.task.count({ where: { version: { lt: 1 } } })).toBe(0);
    // The page a person edits from carries it.
    expect((await tasks.getTask(pm, task.id)).version).toBe(1);
  });

  it("commits an edit at the current version once, with one increment and truthful history", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const colleague = await activeColleague(pm);
    const task = await personalTask(pm);

    const result = await tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}renamed`, priority: "HIGH", assigneeMemberId: colleague.id, expectedVersion: 1 }));
    expect(result.meta).toMatchObject({ taskId: task.id, changed: true, version: 2 });
    const after = await row(task.id);
    expect(after).toMatchObject({ version: 2, title: `${PREFIX}renamed`, priority: "HIGH", assigneeMemberId: colleague.id });

    const updated = await activity(task.id, "TASK_UPDATED");
    expect(updated).toHaveLength(1);
    expect(updated[0].metadata).toMatchObject({ version: { from: 1, to: 2 }, fields: expect.arrayContaining(["title", "priority", "assigneeMemberId"]) });
    // Which fields, never what the description said.
    expect(JSON.stringify(updated[0].metadata)).not.toContain(`${PREFIX}renamed`);
    expect(await activity(task.id, "TASK_ASSIGNED")).toHaveLength(1);
    expect(await activity(task.id, "TASK_STATUS_CHANGED")).toHaveLength(0);

    const assigned = await outbox(task.id, "TASK_ASSIGNED");
    expect(assigned).toHaveLength(1);
    // The dedupe identity is the committed version, not the wall clock (AUD-02 §8).
    expect(assigned[0].payloadJson).toMatchObject({ assigneeMemberId: colleague.id, assignmentVersion: "v2" });
    expect(await outbox(task.id, "TASK_STATUS_CHANGED")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* TR-03 … TR-06: races                                                        */
/* -------------------------------------------------------------------------- */

describe("two changes from the same version (TR-03 – TR-06)", () => {
  it("TR-03: of two edits released together, exactly one commits and the other changes nothing", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    const results = await race(task.id, [
      () => tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}by A`, expectedVersion: 1 })),
      () => tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}by B`, priority: "LOW", expectedVersion: 1 })),
    ]);

    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(codeOf((losers[0] as { error: unknown }).error)).toBe("TASK_VERSION_CONFLICT");

    const after = await row(task.id);
    expect(after.version).toBe(2);
    const winner = (winners[0] as { value: tasks.TaskMutationResponse }).value;
    expect(winner.meta.version).toBe(2);
    // The row is the winner's whole edit, not a mix of both.
    expect([`${PREFIX}by A`, `${PREFIX}by B`]).toContain(after.title);
    expect(after.priority).toBe(after.title === `${PREFIX}by B` ? "LOW" : "MEDIUM");
    expect(await activity(task.id, "TASK_UPDATED")).toHaveLength(1);
  });

  it("TR-04: an edit racing Complete cannot undo the completion", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    const [editResult, completeResult] = await race(task.id, [
      () => tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}edited`, status: "IN_PROGRESS", expectedVersion: 1 })),
      () => tasks.completeTask(pm, task.id, { expectedVersion: 1 }),
    ]);
    expect([editResult.ok, completeResult.ok].filter(Boolean)).toHaveLength(1);

    const after = await row(task.id);
    expect(after.version).toBe(2);
    if (completeResult.ok) {
      expect(codeOf((editResult as { error: unknown }).error)).toBe("TASK_VERSION_CONFLICT");
      expect(after.status).toBe("COMPLETED");
      expect(after.completedAt).not.toBeNull();
      expect(after.title).toBe(`${PREFIX}task`);
    } else {
      expect(codeOf((completeResult as { error: unknown }).error)).toBe("TASK_VERSION_CONFLICT");
      expect(after).toMatchObject({ status: "IN_PROGRESS", completedAt: null, title: `${PREFIX}edited` });
    }
    expect(await outbox(task.id, "TASK_COMPLETED")).toHaveLength(completeResult.ok ? 1 : 0);
  });

  it("TR-04: an edit racing Archive cannot resurrect archived work", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    const [editResult, archiveResult] = await race(task.id, [
      () => tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}edited`, expectedVersion: 1 })),
      () => tasks.archiveTask(pm, task.id, { expectedVersion: 1 }),
    ]);
    expect([editResult.ok, archiveResult.ok].filter(Boolean)).toHaveLength(1);

    const after = await row(task.id);
    expect(after.version).toBe(2);
    if (archiveResult.ok) {
      expect(after).toMatchObject({ status: "ARCHIVED", preArchiveStatus: "TODO", title: `${PREFIX}task` });
      // And the stale edit stays refused at the new version too.
      await expectCode(tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}again`, expectedVersion: 1 })), "TASK_VERSION_CONFLICT");
      await expectCode(tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}again`, expectedVersion: 2 })), "TASK_STATE_CONFLICT");
    } else {
      expect(after).toMatchObject({ status: "TODO", archivedAt: null, title: `${PREFIX}edited` });
    }
  });

  it("TR-05: Start racing Block leaves one valid state, with the blocker only if Block won", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    const [start, block] = await race(task.id, [
      () => tasks.startTask(pm, task.id, { expectedVersion: 1 }),
      () => tasks.blockTask(pm, task.id, { expectedVersion: 1, reason: "Waiting for the crane" }),
    ]);
    expect([start.ok, block.ok].filter(Boolean)).toHaveLength(1);

    const after = await row(task.id);
    expect(after.version).toBe(2);
    if (block.ok) {
      expect(after).toMatchObject({ status: "BLOCKED", blockedReason: "Waiting for the crane", blockedByMemberId: pm.membershipId });
      expect(after.blockedAt).not.toBeNull();
      expect(await outbox(task.id, "TASK_BLOCKED")).toHaveLength(1);
    } else {
      expect(after).toMatchObject({ status: "IN_PROGRESS", blockedReason: null, blockedAt: null, blockedByMemberId: null });
      expect(await outbox(task.id, "TASK_BLOCKED")).toHaveLength(0);
    }
  });

  it("TR-05: Complete racing a reassignment names the assignee the task actually has", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const first = await activeColleague(pm);
    const second = await activeColleague(pm, [first.id]);
    const task = await personalTask(pm, { assigneeMemberId: first.id });

    const [complete, reassign] = await race(task.id, [
      () => tasks.completeTask(pm, task.id, { expectedVersion: 1 }),
      () => tasks.updateTask(pm, task.id, edit({ assigneeMemberId: second.id, expectedVersion: 1 })),
    ]);
    expect([complete.ok, reassign.ok].filter(Boolean)).toHaveLength(1);

    const after = await row(task.id);
    expect(after.version).toBe(2);
    if (complete.ok) {
      expect(after).toMatchObject({ status: "COMPLETED", assigneeMemberId: first.id });
      const [event] = await outbox(task.id, "TASK_COMPLETED");
      expect(event.payloadJson).toMatchObject({ assigneeMemberId: first.id });
      // Only the create's assignment notice exists.
      expect(await outbox(task.id, "TASK_ASSIGNED")).toHaveLength(1);
    } else {
      expect(after).toMatchObject({ status: "TODO", assigneeMemberId: second.id });
      const assigned = await outbox(task.id, "TASK_ASSIGNED");
      expect(assigned.map((event) => (event.payloadJson as { assigneeMemberId: string }).assigneeMemberId)).toEqual([first.id, second.id]);
    }
  });

  it("TR-06: two archives make one change, remembering the status under the winning lock", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await tasks.startTask(pm, task.id, { expectedVersion: 1 });

    const results = await race(task.id, [
      () => tasks.archiveTask(pm, task.id, { expectedVersion: 2 }),
      () => tasks.archiveTask(pm, task.id, { expectedVersion: 2 }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(codeOf((results.find((result) => !result.ok) as { error: unknown }).error)).toBe("TASK_VERSION_CONFLICT");
    expect(await row(task.id)).toMatchObject({ version: 3, status: "ARCHIVED", preArchiveStatus: "IN_PROGRESS" });
    expect(await activity(task.id, "TASK_ARCHIVED")).toHaveLength(1);

    const restores = await race(task.id, [
      () => tasks.restoreTask(pm, task.id, { expectedVersion: 3 }),
      () => tasks.restoreTask(pm, task.id, { expectedVersion: 3 }),
    ]);
    expect(restores.filter((result) => result.ok)).toHaveLength(1);
    expect(await row(task.id)).toMatchObject({ version: 4, status: "IN_PROGRESS", preArchiveStatus: null, archivedAt: null });
    expect(await activity(task.id, "TASK_RESTORED")).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* TR-07, TR-08, TR-09, TR-10                                                  */
/* -------------------------------------------------------------------------- */

describe("archive and restore keep what restoring needs (TR-07)", () => {
  it("restores a completed task with its completion time, and a blocked one with its reason", async () => {
    const pm = await loginAs("PROJECT_MANAGER");

    const done = await personalTask(pm);
    await tasks.completeTask(pm, done.id, await taskVersion(done.id));
    const completedAt = (await row(done.id)).completedAt;
    await tasks.archiveTask(pm, done.id, await taskVersion(done.id));
    await tasks.restoreTask(pm, done.id, await taskVersion(done.id));
    expect(await row(done.id)).toMatchObject({ status: "COMPLETED", completedAt });

    const stuck = await personalTask(pm);
    await tasks.blockTask(pm, stuck.id, { ...(await taskVersion(stuck.id)), reason: "No access to level 3" });
    const blocked = await row(stuck.id);
    await tasks.archiveTask(pm, stuck.id, await taskVersion(stuck.id));
    await tasks.restoreTask(pm, stuck.id, await taskVersion(stuck.id));
    expect(await row(stuck.id)).toMatchObject({
      status: "BLOCKED",
      blockedReason: "No access to level 3",
      blockedAt: blocked.blockedAt,
      blockedByMemberId: pm.membershipId,
    });
  });

  it("restores a legacy archived task without a remembered status as To Do, and refuses a corrupted one", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const legacy = await personalTask(pm);
    await prisma.task.update({ where: { id: legacy.id }, data: { status: "ARCHIVED", archivedAt: new Date(), preArchiveStatus: null } });
    const version = (await row(legacy.id)).version;
    await tasks.restoreTask(pm, legacy.id, { expectedVersion: version });
    expect(await row(legacy.id)).toMatchObject({ status: "TODO", version: version + 1 });
    const [restored] = await activity(legacy.id, "TASK_RESTORED");
    expect(restored.metadata).toMatchObject({ restoredFrom: "LEGACY_TODO" });

    const corrupted = await personalTask(pm);
    await prisma.task.update({ where: { id: corrupted.id }, data: { status: "ARCHIVED", archivedAt: new Date(), preArchiveStatus: "ARCHIVED" } });
    const before = await row(corrupted.id);
    const error = await expectCode(tasks.restoreTask(pm, corrupted.id, { expectedVersion: before.version }), "TASK_STATE_CONFLICT");
    expect(error.details).toMatchObject({ reason: "INVALID_PRE_ARCHIVE_STATUS" });
    expect(await row(corrupted.id)).toMatchObject({ status: "ARCHIVED", version: before.version });
  });
});

describe("no-ops, stale no-ops and repeated commands (TR-08)", () => {
  it("answers an unchanged edit at the current version without a version, history or notification", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm, { dueDate: "2026-11-02" });
    // The stored time survives a form that can only say which day.
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: new Date("2026-11-02T15:30:00.000Z"), version: 2 } });
    const activityBefore = (await activity(task.id)).length;
    const outboxBefore = (await outbox(task.id)).length;

    const result = await tasks.updateTask(pm, task.id, edit({ dueDate: "2026-11-02", expectedVersion: 2 }));
    expect(result.meta).toMatchObject({ changed: false, version: 2 });
    expect(await row(task.id)).toMatchObject({ version: 2, dueDate: new Date("2026-11-02T15:30:00.000Z") });
    expect(await activity(task.id)).toHaveLength(activityBefore);
    expect(await outbox(task.id)).toHaveLength(outboxBefore);
  });

  it("still refuses an unchanged edit from a stale version", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await tasks.updateTask(pm, task.id, edit({ priority: "HIGH", expectedVersion: 1 }));
    // The same values the person saw at version 1 are no longer the task.
    await expectCode(tasks.updateTask(pm, task.id, edit({ expectedVersion: 1 })), "TASK_VERSION_CONFLICT");
    expect((await row(task.id)).priority).toBe("HIGH");
  });

  it("refuses a command repeated at the current version as a state conflict, changing nothing", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await tasks.completeTask(pm, task.id, { expectedVersion: 1 });
    await expectCode(tasks.completeTask(pm, task.id, { expectedVersion: 2 }), "TASK_STATE_CONFLICT");
    await expectCode(tasks.startTask(pm, task.id, { expectedVersion: 2 }), "TASK_STATE_CONFLICT");
    await expectCode(tasks.blockTask(pm, task.id, { expectedVersion: 2, reason: "Not now" }), "TASK_STATE_CONFLICT");
    expect(await row(task.id)).toMatchObject({ version: 2, status: "COMPLETED" });
    expect(await activity(task.id, "TASK_COMPLETED")).toHaveLength(1);
  });
});

describe("the precondition (TR-09)", () => {
  it("refuses a missing version with 428, a malformed one with 422, a forged one with 409", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    for (const missing of [undefined, null, ""]) {
      const error = await expectCode(tasks.completeTask(pm, task.id, { expectedVersion: missing }), "TASK_VERSION_REQUIRED");
      expect(error.status).toBe(428);
    }
    for (const malformed of [0, -1, 1.5, "1.5", "one", "0x1", true, {}, [1], 2 ** 31]) {
      const outcome = await settle(tasks.completeTask(pm, task.id, { expectedVersion: malformed }));
      expect(outcome.ok, String(malformed)).toBe(false);
      const error = (outcome as { error: AccessError }).error;
      expect(error.code, String(malformed)).toBe("VALIDATION_ERROR");
      expect(error.details).toHaveProperty("expectedVersion");
    }
    await expectCode(tasks.completeTask(pm, task.id, { expectedVersion: 7 }), "TASK_VERSION_CONFLICT");
    // The old timestamp stamp is not a version: a legacy edit is refused, not waved through.
    await expectCode(
      tasks.updateTask(pm, task.id, updateTaskSchema.parse({ title: `${PREFIX}legacy`, versionUpdatedAt: new Date().toISOString() })),
      "TASK_VERSION_REQUIRED",
    );
    expect(await row(task.id)).toMatchObject({ version: 1, status: "TODO", title: `${PREFIX}task` });
  });

  it("never lets a request write the version, the company or the server's stamps", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    const parsed = updateTaskSchema.parse({
      title: `${PREFIX}forged`,
      expectedVersion: 1,
      version: 99,
      companyId: COMPANY.b,
      completedAt: "2020-01-01",
      archivedAt: "2020-01-01",
      blockedByMemberId: "someone",
      createdByMemberId: "someone",
    });
    await tasks.updateTask(pm, task.id, parsed);
    expect(await row(task.id)).toMatchObject({ version: 2, companyId: pm.companyId, completedAt: null, archivedAt: null, blockedByMemberId: null, createdByMemberId: pm.membershipId });
  });

  it("answers 404 before 428 for a task the caller may not see", async () => {
    const owner = await loginAs("OWNER");
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const task = await personalTask(owner);
    await expectCode(tasks.completeTask(tenant, task.id, {}), "NOT_FOUND");
  });
});

describe("lifecycle rules, identical for every caller (TR-10)", () => {
  it("keeps BLOCKED behind the reason-bearing command, with the reason's bounds", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);

    const bypass = await settle(tasks.updateTask(pm, task.id, edit({ status: "BLOCKED", expectedVersion: 1 })));
    expect((bypass as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");

    for (const reason of ["", "  ", " ab ", "x".repeat(1001)]) {
      const outcome = await settle(tasks.blockTask(pm, task.id, { expectedVersion: 1, reason }));
      expect((outcome as { error: AccessError }).error.code, JSON.stringify(reason.slice(0, 5))).toBe("VALIDATION_ERROR");
    }
    await tasks.blockTask(pm, task.id, { expectedVersion: 1, reason: `  ${"y".repeat(1000)}  ` });
    expect((await row(task.id)).blockedReason).toBe("y".repeat(1000));

    await tasks.startTask(pm, task.id, { expectedVersion: 2 });
    await tasks.blockTask(pm, task.id, { expectedVersion: 3, reason: " abc " });
    expect(await row(task.id)).toMatchObject({ status: "BLOCKED", blockedReason: "abc" });
  });

  it("reopens only into an open status, and only a completed task", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await expectCode(tasks.reopenTask(pm, task.id, { expectedVersion: 1 }), "TASK_STATE_CONFLICT");
    await tasks.completeTask(pm, task.id, { expectedVersion: 1 });
    for (const status of ["BLOCKED", "COMPLETED", "ARCHIVED"] as const) {
      const outcome = await settle(tasks.reopenTask(pm, task.id, { expectedVersion: 2, status }));
      expect((outcome as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");
    }
    await tasks.reopenTask(pm, task.id, { expectedVersion: 2, status: "IN_PROGRESS" });
    expect(await row(task.id)).toMatchObject({ status: "IN_PROGRESS", completedAt: null, version: 3 });
  });

  it("keeps a completed task's completion time through an edit that keeps it completed", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await tasks.completeTask(pm, task.id, { expectedVersion: 1 });
    const { completedAt } = await row(task.id);
    await tasks.updateTask(pm, task.id, edit({ status: "COMPLETED", priority: "HIGH", expectedVersion: 2 }));
    expect(await row(task.id)).toMatchObject({ completedAt, priority: "HIGH", version: 3 });
  });

  it("needs task.complete to complete through the form, and task.reopen to leave COMPLETED", async () => {
    const owner = await loginAs("OWNER");
    const task = await personalTask(owner);
    const noComplete = { ...owner, permissions: owner.permissions.filter((permission) => permission !== "task.complete") } as UserContext;
    const outcome = await settle(tasks.updateTask(noComplete, task.id, edit({ status: "COMPLETED", expectedVersion: 1 })));
    expect((outcome as { error: AccessError }).error.code).toBe("FORBIDDEN");
    expect((await row(task.id)).version).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* TR-11, TR-12, TR-13                                                         */
/* -------------------------------------------------------------------------- */

describe("access comes first and leaks nothing (TR-11)", () => {
  it("refuses a foreign task, a disabled module, a viewer and a revoked membership, disclosing nothing", async () => {
    const owner = await loginAs("OWNER");
    const task = await personalTask(owner);
    await tasks.updateTask(owner, task.id, edit({ title: `${PREFIX}secret title`, expectedVersion: 1 }));

    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const foreign = await expectCode(tasks.updateTask(tenant, task.id, edit({ expectedVersion: 1 })), "NOT_FOUND");
    expect(JSON.stringify({ message: foreign.message, details: foreign.details ?? null })).not.toMatch(/secret|version|"2"/);

    const viewer = await loginAs("VIEWER");
    await expectCode(tasks.completeTask(viewer, task.id, { expectedVersion: 2 }), "FORBIDDEN");

    const disabled = { ...owner, moduleAccess: { ...owner.moduleAccess, tasks: { ...owner.moduleAccess.tasks, enabled: false } } } as UserContext;
    await expectCode(tasks.completeTask(disabled, task.id, { expectedVersion: 2 }), "MODULE_UNAVAILABLE");

    // The session was read while the membership was active; it is revoked before the write.
    const pm = await loginAs("PROJECT_MANAGER");
    const own = await personalTask(pm);
    await prisma.companyMember.update({ where: { id: pm.membershipId }, data: { status: "SUSPENDED" } });
    try {
      await expectCode(tasks.completeTask(pm, own.id, { expectedVersion: 1 }), "MEMBERSHIP_INACTIVE");
    } finally {
      await prisma.companyMember.update({ where: { id: pm.membershipId }, data: { status: "ACTIVE" } });
    }
    expect(await row(own.id)).toMatchObject({ version: 1, status: "TODO" });
    expect(await activity(task.id, "TASK_COMPLETED")).toHaveLength(0);
    expect(await row(task.id)).toMatchObject({ version: 2, status: "TODO" });
  });

  it("refuses another company's project on an edit", async () => {
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const task = await personalTask(tenant);
    const outcome = await settle(tasks.updateTask(tenant, task.id, edit({ projectId: PROJECT.a, expectedVersion: 1 })));
    expect((outcome as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");
    expect((outcome as { error: AccessError }).error.details).toHaveProperty("projectId");
    expect((await row(task.id)).version).toBe(1);
  });
});

describe("assignment (TR-12)", () => {
  it("of two reassignments, one wins and only its assignee is told", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const x = await activeColleague(pm);
    const y = await activeColleague(pm, [x.id]);
    const task = await personalTask(pm);

    const results = await race(task.id, [
      () => tasks.updateTask(pm, task.id, edit({ assigneeMemberId: x.id, expectedVersion: 1 })),
      () => tasks.updateTask(pm, task.id, edit({ assigneeMemberId: y.id, expectedVersion: 1 })),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const after = await row(task.id);
    const events = await outbox(task.id, "TASK_ASSIGNED");
    expect(events).toHaveLength(1);
    expect(events[0].payloadJson).toMatchObject({ assigneeMemberId: after.assigneeMemberId, assignmentVersion: "v2" });
  });

  it("refuses an inactive, foreign or off-project assignee, and assignment without task.assign", async () => {
    const owner = await loginAs("OWNER");
    const task = await personalTask(owner);

    const inactive = await prisma.companyMember.findFirst({ where: { companyId: owner.companyId, status: { not: "ACTIVE" } }, select: { id: true } });
    if (inactive) {
      const outcome = await settle(tasks.updateTask(owner, task.id, edit({ assigneeMemberId: inactive.id, expectedVersion: 1 })));
      expect((outcome as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");
    }
    const tenant = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    const foreign = await settle(tasks.updateTask(owner, task.id, edit({ assigneeMemberId: tenant.membershipId, expectedVersion: 1 })));
    expect((foreign as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");

    const outsider = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: owner.companyId, status: "ACTIVE", projectMemberships: { none: { projectId: PROJECT.a } }, managedProjects: { none: { id: PROJECT.a } } },
      select: { id: true },
    });
    const offProject = await settle(tasks.updateTask(owner, task.id, edit({ projectId: PROJECT.a, assigneeMemberId: outsider.id, expectedVersion: 1 })));
    expect((offProject as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");

    const architect = await loginAs("ARCHITECT");
    const own = await personalTask(architect);
    const colleague = await activeColleague(architect);
    await expectCode(tasks.updateTask(architect, own.id, edit({ assigneeMemberId: colleague.id, expectedVersion: 1 })), "FORBIDDEN");

    expect((await row(task.id)).version).toBe(1);
    expect(await outbox(task.id, "TASK_ASSIGNED")).toHaveLength(0);
    expect(await outbox(own.id, "TASK_ASSIGNED")).toHaveLength(0);
  });

  it("subscribes a new assignee in the same commit", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const colleague = await activeColleague(pm);
    const task = await personalTask(pm);
    await tasks.updateTask(pm, task.id, edit({ assigneeMemberId: colleague.id, expectedVersion: 1 }));
    const thread = await prisma.collaborationThread.findFirstOrThrow({ where: { parentType: "task", parentId: task.id } });
    const members = (await prisma.subscription.findMany({ where: { threadId: thread.id } })).map((subscription) => subscription.memberId);
    expect(members).toEqual(expect.arrayContaining([pm.membershipId, colleague.id]));
  });
});

describe("moving between projects (TR-13)", () => {
  it("refuses moving a task raised from a record, and moves an independent one, touching both projects", async () => {
    const owner = await loginAs("OWNER");
    const milestone = await prisma.projectMilestone.findFirstOrThrow({ where: { projectId: PROJECT.a, archivedAt: null }, select: { id: true } });
    const parented = await tasks.createTaskFromContext(owner, {
      ...createTaskSchema.parse({ title: `${PREFIX}parented`, projectId: PROJECT.a }),
      parentType: "project_milestone",
      parentId: milestone.id,
    });
    created.add(parented.id);
    const refused = await settle(tasks.updateTask(owner, parented.id, edit({ title: `${PREFIX}parented`, expectedVersion: 1 })));
    expect((refused as { error: AccessError }).error.code).toBe("VALIDATION_ERROR");
    expect((await row(parented.id)).projectId).toBe(PROJECT.a);

    const independent = await personalTask(owner, { projectId: PROJECT.a });
    const moved = await tasks.updateTask(owner, independent.id, edit({ projectId: undefined, expectedVersion: 1 }));
    expect(moved.effects.projectIds).toEqual([PROJECT.a]);
    const back = await tasks.updateTask(owner, independent.id, edit({ projectId: PROJECT.a, expectedVersion: 2 }));
    expect(back.effects.projectIds).toEqual([PROJECT.a]);
    expect(await activity(independent.id, "TASK_PROJECT_CHANGED")).toHaveLength(2);
    expect((await row(independent.id)).projectId).toBe(PROJECT.a);
  });
});

/* -------------------------------------------------------------------------- */
/* TR-14, TR-15, TR-16                                                         */
/* -------------------------------------------------------------------------- */

describe("the change and its side effects are one commit (TR-14)", () => {
  for (const [label, table, condition] of [
    ["activity", "activities", `NEW."entityId" = '%ID%'`],
    ["outbox", "notification_event_outbox", `NEW."entityId" = '%ID%'`],
    ["subscription", "collaboration_subscriptions", `NEW."threadId" IN (SELECT "id" FROM "collaboration_threads" WHERE "parentId" = '%ID%')`],
  ] as const) {
    it(`rolls the version back when the ${label} write fails, and a retry from the same version succeeds`, async () => {
      const pm = await loginAs("PROJECT_MANAGER");
      const colleague = await activeColleague(pm);
      const task = await personalTask(pm);
      const activityBefore = (await activity(task.id)).length;
      const outboxBefore = (await outbox(task.id)).length;

      await failingWrites(table, condition.replaceAll("%ID%", task.id), async () => {
        const outcome = await settle(tasks.updateTask(pm, task.id, edit({ assigneeMemberId: colleague.id, status: "IN_PROGRESS", expectedVersion: 1 })));
        expect(outcome.ok).toBe(false);
      });
      expect(await row(task.id)).toMatchObject({ version: 1, status: "TODO", assigneeMemberId: null });
      expect(await activity(task.id)).toHaveLength(activityBefore);
      expect(await outbox(task.id)).toHaveLength(outboxBefore);

      const retried = await tasks.updateTask(pm, task.id, edit({ assigneeMemberId: colleague.id, status: "IN_PROGRESS", expectedVersion: 1 }));
      expect(retried.meta.version).toBe(2);
    });
  }
});

describe("delivery after the commit (TR-15)", () => {
  it("keeps the task committed while a failed delivery is retried, and delivers once", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const colleague = await activeColleague(pm);
    const task = await personalTask(pm);
    const result = await tasks.updateTask(pm, task.id, edit({ assigneeMemberId: colleague.id, expectedVersion: 1 }));
    expect(result.meta).toMatchObject({ changed: true, version: 2 });
    const [event] = await outbox(task.id, "TASK_ASSIGNED");

    await failingWrites("notifications", `NEW."entityId" = '${task.id}'`, async () => {
      await dispatchNotifications();
    });
    const failed = await prisma.notificationEventOutbox.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed.status).toBe("PENDING");
    expect(failed.attemptCount).toBeGreaterThan(0);
    expect(await row(task.id)).toMatchObject({ version: 2, assigneeMemberId: colleague.id });

    await prisma.notificationEventOutbox.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(Date.now() - 60_000) } });
    await dispatchNotifications();
    await dispatchNotifications();
    expect(await prisma.notification.count({ where: { entityId: task.id, recipientMemberId: colleague.id, eventType: "TASK_ASSIGNED" } })).toBe(1);
    expect((await row(task.id)).version).toBe(2);
  });
});

describe("a replayed command commits at most once (TR-16)", () => {
  it("double click: the same command twice at once is one change", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    const results = await race(task.id, [
      () => tasks.completeTask(pm, task.id, { expectedVersion: 1 }),
      () => tasks.completeTask(pm, task.id, { expectedVersion: 1 }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await activity(task.id, "TASK_COMPLETED")).toHaveLength(1);
    expect(await outbox(task.id, "TASK_COMPLETED")).toHaveLength(1);
    expect((await row(task.id)).version).toBe(2);
  });

  it("lost response: resending the same command is refused, not repeated", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    await tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}sent once`, expectedVersion: 1 }));
    await expectCode(tasks.updateTask(pm, task.id, edit({ title: `${PREFIX}sent once`, expectedVersion: 1 })), "TASK_VERSION_CONFLICT");
    expect(await activity(task.id, "TASK_UPDATED")).toHaveLength(1);
    expect((await row(task.id)).version).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* TR-17 … TR-20, TR-23, TR-24                                                 */
/* -------------------------------------------------------------------------- */

describe("reviewing a conflict and reapplying (TR-17)", () => {
  it("reapplies only the chosen change on top of the latest, and conflicts again if it moved once more", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const owner = await loginAs("OWNER");
    const task = await personalTask(pm);

    // The PM opened version 1 and changed the priority; the Owner renamed it meanwhile.
    await tasks.updateTask(owner, task.id, edit({ title: `${PREFIX}renamed by owner`, expectedVersion: 1 }));
    await expectCode(tasks.updateTask(pm, task.id, edit({ priority: "CRITICAL", expectedVersion: 1 })), "TASK_VERSION_CONFLICT");

    // Review latest: a fresh read through the PM's own scope.
    const latest = await tasks.getTask(pm, task.id);
    expect(latest).toMatchObject({ version: 2, title: `${PREFIX}renamed by owner` });

    // Another change lands before the PM saves the reapplied edit.
    await tasks.updateTask(owner, task.id, edit({ title: `${PREFIX}renamed by owner`, dueDate: "2026-12-01", expectedVersion: 2 }));
    await expectCode(
      tasks.updateTask(pm, task.id, edit({ title: latest.title, priority: "CRITICAL", expectedVersion: latest.version })),
      "TASK_VERSION_CONFLICT",
    );

    const again = await tasks.getTask(pm, task.id);
    const saved = await tasks.updateTask(
      pm,
      task.id,
      edit({ title: again.title, dueDate: again.schedule.dueDate ?? undefined, priority: "CRITICAL", expectedVersion: again.version }),
    );
    expect(saved.meta.version).toBe(4);
    expect(await row(task.id)).toMatchObject({ title: `${PREFIX}renamed by owner`, priority: "CRITICAL", dueDate: new Date("2026-12-01T00:00:00.000Z") });
  });
});

describe("a change that takes the task out of the actor's sight (TR-18)", () => {
  it("answers a minimal acknowledgement and a safe destination, never the task", async () => {
    const owner = await loginAs("OWNER");
    const pm = await loginAs("PROJECT_MANAGER");
    const colleague = await activeColleague(pm, [owner.membershipId]);
    // The Owner's personal task, given to the PM, who hands it on.
    const task = await personalTask(owner, { assigneeMemberId: pm.membershipId });
    const result = await tasks.updateTask(pm, task.id, edit({ assigneeMemberId: colleague.id, expectedVersion: 1 }));
    expect(result).toMatchObject({ data: null, redirectTo: "/tasks", meta: { taskId: task.id, changed: true, version: 2 } });
    expect((await row(task.id)).assigneeMemberId).toBe(colleague.id);
    await expect(tasks.getTask(pm, task.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("discussion is not a task change (TR-19)", () => {
  it("lets an edit opened before a comment, a watch and a read save without a conflict", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const owner = await loginAs("OWNER");
    const task = await personalTask(pm);
    await collaboration.createComment(owner, "task", task.id, { body: "A question about the task" });
    await collaboration.setWatching(owner, "task", task.id, true);
    const notification = await prisma.notification.findFirst({ where: { recipientMemberId: pm.membershipId }, select: { id: true } });
    if (notification) await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });

    expect((await row(task.id)).version).toBe(1);
    const saved = await tasks.updateTask(pm, task.id, edit({ priority: "HIGH", expectedVersion: 1 }));
    expect(saved.meta.version).toBe(2);
  });
});

describe("a task handed off from a meeting (TR-20)", () => {
  const meetingIds = new Set<string>();

  afterEach(async () => {
    const ids = [...meetingIds];
    if (ids.length === 0) return;
    const reminders = await prisma.calendarReminder.findMany({ where: { meetingId: { in: ids } }, select: { id: true } });
    await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((reminder) => reminder.id) } } });
    await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: ids } } });
    await prisma.meetingActionItem.deleteMany({ where: { meetingId: { in: ids } } });
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: ids } } });
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
    const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
    await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((thread) => thread.id) } } });
    await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((thread) => thread.id) } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.meeting.deleteMany({ where: { id: { in: ids } } });
    meetingIds.clear();
  });

  it("starts the task at version 1 and moves the action with the task, committing or failing together", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await createMeeting(
      pm,
      createMeetingSchema.parse({
        title: `${PREFIX}meeting`,
        meetingType: "INTERNAL",
        visibility: "PROJECT",
        projectId: PROJECT.a,
        date: addLocalDays(localDate(new Date(), "Europe/Tirane"), 3),
        startTime: "10:00",
        endTime: "11:00",
        participants: [{ memberId: engineer.membershipId, role: "ATTENDEE" }],
      }),
    );
    meetingIds.add(meeting.id);
    await startMeeting(pm, meeting.id);
    const withAction = await createActionItem(pm, meeting.id, { title: `${PREFIX}action`, description: null, ownerMemberId: engineer.membershipId, createTask: true });
    const action = withAction.actions[0];
    const taskId = action.task!.id;
    created.add(taskId);
    const actionRow = () => prisma.meetingActionItem.findUniqueOrThrow({ where: { id: action.id } });

    expect((await row(taskId)).version).toBe(1);
    const completed = await tasks.completeTask(engineer, taskId, { expectedVersion: 1 });
    expect(completed.effects.meetingIds).toEqual([meeting.id]);
    expect((await actionRow()).status).toBe("DONE");

    // Archive leaves the action where it was; restore brings task and action back in step.
    await tasks.archiveTask(pm, taskId, { expectedVersion: 2 });
    expect((await actionRow()).status).toBe("DONE");
    await tasks.restoreTask(pm, taskId, { expectedVersion: 3 });
    expect((await row(taskId)).status).toBe("COMPLETED");
    expect((await actionRow()).status).toBe("DONE");

    await tasks.reopenTask(pm, taskId, { expectedVersion: 4 });
    expect((await actionRow()).status).toBe("OPEN");

    // A failure writing the action undoes the task's change too, version included.
    const title = (await row(taskId)).title;
    await failingWrites("meeting_action_items", `NEW."id" = '${action.id}'`, async () => {
      const outcome = await settle(tasks.updateTask(pm, taskId, edit({ title, projectId: PROJECT.a, assigneeMemberId: pm.membershipId, expectedVersion: 5 })));
      expect(outcome.ok).toBe(false);
    });
    expect(await row(taskId)).toMatchObject({ version: 5, assigneeMemberId: engineer.membershipId });
    expect((await actionRow()).ownerMemberId).toBe(engineer.membershipId);

    const saved = await tasks.updateTask(pm, taskId, edit({ title, projectId: PROJECT.a, assigneeMemberId: pm.membershipId, expectedVersion: 5 }));
    expect(saved.meta.version).toBe(6);
    expect((await actionRow()).ownerMemberId).toBe(pm.membershipId);
  });
});

describe("unrelated tasks do not wait for each other (TR-23)", () => {
  it("commits a change to one task while another task's row is locked", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const busy = await personalTask(pm);
    const free = await personalTask(pm);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const held = new Promise<void>((resolve) => (holding = resolve));
    const holder = locker.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${busy.id} FOR UPDATE`;
        holding();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    try {
      const result = await tasks.completeTask(pm, free.id, { expectedVersion: 1 });
      expect(result.meta.version).toBe(2);
    } finally {
      release();
      await holder;
    }
  });

  it("keeps thirty concurrent commands on thirty tasks independent", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const many = await Promise.all(Array.from({ length: 30 }, () => personalTask(pm)));
    const started = Date.now();
    const timings: number[] = [];
    const results = await Promise.all(
      many.map(async (task, index) => {
        const began = Date.now();
        const outcome = await settle(
          index % 2 === 0
            ? tasks.completeTask(pm, task.id, { expectedVersion: 1 })
            : tasks.updateTask(pm, task.id, edit({ priority: "HIGH", expectedVersion: 1 })),
        );
        timings.push(Date.now() - began);
        return outcome;
      }),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const versions = await prisma.task.findMany({ where: { id: { in: many.map((task) => task.id) } }, select: { version: true } });
    expect(versions.every((task) => task.version === 2)).toBe(true);
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95) - 1];
    // `AUD02_OUT=<dir>` keeps the timings as evidence.
    if (process.env.AUD02_OUT) {
      appendFileSync(`${process.env.AUD02_OUT}/task-load.txt`, `30 concurrent task commands on 30 tasks: total ${Date.now() - started} ms, p50 ${timings[14]} ms, p95 ${p95} ms, max ${timings[29]} ms\n`);
    }
  });
});

describe("no hidden writer keeps an old version (TR-24)", () => {
  it("bumps the version for a writer outside the service, so a page opened before it cannot save over it", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await personalTask(pm);
    // A repair script, a seed or raw SQL changing a protected field.
    await prisma.$executeRaw`UPDATE "tasks" SET "title" = ${`${PREFIX}repaired`} WHERE "id" = ${task.id}`;
    expect((await row(task.id)).version).toBe(2);
    await expectCode(tasks.updateTask(pm, task.id, edit({ expectedVersion: 1 })), "TASK_VERSION_CONFLICT");

    // A write that changes nothing protected keeps the version (seed reruns).
    await prisma.task.update({ where: { id: task.id }, data: { title: `${PREFIX}repaired`, updatedBy: "seed" } });
    expect((await row(task.id)).version).toBe(2);

    // Nobody may reset or jump it.
    await expect(prisma.task.update({ where: { id: task.id }, data: { version: 1 } })).rejects.toThrow();
    await expect(prisma.task.update({ where: { id: task.id }, data: { version: 9 } })).rejects.toThrow();
  });

  it("bumps the version when deleting a project clears a task's project", async () => {
    const owner = await loginAs("OWNER");
    const projectId = `${PREFIX}project_${crypto.randomUUID().slice(0, 8)}`;
    await prisma.project.create({ data: { id: projectId, companyId: owner.companyId, code: `A2-${projectId.slice(-4)}`, name: "AUD-02 throwaway", status: "ACTIVE", projectManagerMemberId: owner.membershipId, createdBy: "test" } });
    const task = await personalTask(owner, { projectId });
    await prisma.project.delete({ where: { id: projectId } });
    expect(await row(task.id)).toMatchObject({ projectId: null, version: 2 });
  });
});
