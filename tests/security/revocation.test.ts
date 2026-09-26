import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { ActionResult } from "@/lib/actions/tasks";
import { createTaskAction, updateTaskAction } from "@/lib/actions/tasks";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { ContextResult, UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { createTaskSchema, updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, loginAsMembership, PROJECT, prisma } from "../helpers";

/**
 * Revocation (AUD-06 §7, RP-15, RP-16).
 *
 * RP-15. Each way access is taken away — a role changed, a company membership
 * suspended, a project assignment ended, a module switched off, the account
 * deactivated, the session ended — is applied to a session that had ALREADY
 * resolved its context, on its next request: the context is resolved again
 * from the same session id, as the next request does, and the person acts. The
 * same person's outstanding form — a server action called with the payload a
 * page rendered before the revocation — is refused too. Every refusal is
 * paired with the same operation succeeding for the same person just before
 * the revocation (the positive control), and the database, not the service's
 * answer, is the oracle: no task row with that title exists afterwards.
 *
 * The server actions resolve their context through `resolveUserContext`; only
 * the cookie read is replaced here — the real resolver reads the real session
 * row on every call, exactly as tests/security/session-lifecycle.test.ts does.
 *
 * RP-16. A revocation committing concurrently with a mutation by the revoked
 * actor. The interleaving is forced by a barrier, not a sleep: a second
 * connection opens the revocation's transaction and holds its row lock, the
 * mutation is started and the test waits until Postgres itself reports it
 * blocked behind that lock (`pg_blocking_pids`), and only then is the
 * revocation committed. The outcome must be serial — the mutation committed
 * before the revocation, or refused with nothing written: no row, no activity,
 * no notification event.
 */

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/context/resolve-user-context", () => ({
  resolveUserContext: async (): Promise<ContextResult> =>
    session.id ? resolveContextForSession(session.id) : { ok: false, reason: "UNAUTHENTICATED" },
}));
// Revalidation needs a live Next request; outside one it is a no-op here.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const PREFIX = "aud06rv_";
const PM = "member_pm";
const ENGINEER = "member_engineer";
const MULTI_A = "member_multicompany_a";
const MULTI_D = "member_multicompany_d";

/** The barrier's own connection: never the application's pool. */
const locker = new PrismaClient();
const restore: Array<() => Promise<unknown>> = [];

beforeEach(() => {
  session.id = "";
});

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await removeTestRows();
});

afterAll(async () => {
  await removeTestRows();
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

/** Everything this file writes carries the prefix, or hangs off a task that does. */
async function removeTestRows(): Promise<void> {
  const owned = await prisma.task.findMany({ where: { title: { startsWith: PREFIX } }, select: { id: true } });
  const probes = await prisma.activity.findMany({ where: { entityId: { startsWith: PREFIX } }, select: { entityId: true } });
  const ids = [...owned.map((row) => row.id), ...probes.map((row) => row.entityId)];
  if (ids.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.comment.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
}

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

/** A session in one named membership, whose id the server actions will read. */
async function signedIn(membershipId: string): Promise<UserContext> {
  const context = await loginAsMembership(membershipId);
  session.id = context.sessionId;
  return context;
}

/** What the next request resolves from the same session id. */
function nextRequest(context: UserContext): Promise<ContextResult> {
  return resolveContextForSession(context.sessionId, { expectedUserId: context.userId });
}

async function nextContext(context: UserContext): Promise<UserContext> {
  const result = await nextRequest(context);
  if (!result.ok) throw new Error(`the session no longer resolves: ${result.reason}`);
  return result.context;
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** A task form as a page renders it: title, project, the defaults. */
function taskForm(title: string, projectId: string = PROJECT.a): FormData {
  return form({ title: `${PREFIX}${title}`, projectId, status: "TODO", priority: "MEDIUM" });
}

type ActionOutcome = { kind: "result"; result: ActionResult } | { kind: "redirect"; to: string };

/**
 * A server action's answer: its result, or where it sent the browser. A context
 * that no longer resolves is answered by `redirect()`, which throws the
 * NEXT_REDIRECT signal carrying the destination.
 */
async function act(run: () => Promise<ActionResult>): Promise<ActionOutcome> {
  try {
    return { kind: "result", result: await run() };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return { kind: "redirect", to: digest.split(";")[2] };
    throw error;
  }
}

async function taskTitled(title: string) {
  return prisma.task.findMany({ where: { title: `${PREFIX}${title}` }, select: { id: true, companyId: true, createdByMemberId: true, version: true } });
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AccessError ? error.code : undefined;
}

async function expectRefused(promise: Promise<unknown>, code: string): Promise<void> {
  const outcome = await settle(promise);
  expect(outcome.ok, `expected ${code}`).toBe(false);
  expect(codeOf((outcome as { error: unknown }).error)).toBe(code);
}

/** A task the Project Manager raised on Project A: not the engineer's own, so no SELF door. */
async function pmTaskOnProjectA(title: string) {
  const pm = await loginAsMembership(PM);
  return tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}${title}`, projectId: PROJECT.a }));
}

/* -------------------------------------------------------------------------- */
/* The barrier                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Opens `revoke` in its own transaction on the locker's connection and holds it
 * uncommitted; starts `mutation`; waits until Postgres shows the mutation
 * blocked behind the revocation's lock; then commits the revocation and lets
 * the mutation finish. The revocation has therefore committed before the
 * mutation's transaction could take the lock it was queued on.
 */
async function revocationCommitsFirst<T>(revoke: (tx: Prisma.TransactionClient) => Promise<unknown>, mutation: () => Promise<T>): Promise<Settled<T>> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => (holding = resolve));

  const holder = locker.$transaction(
    async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
      await revoke(tx);
      holding(pid);
      await gate;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  const pid = await holderPid;
  const running = settle(mutation());
  try {
    await waitForBlocked(pid, 1);
  } finally {
    release();
    await holder;
  }
  return running;
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
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} statements queued behind ${holderPid}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Whether `waiterPid` is waiting on a lock `holderPid` holds, right now. */
async function waitUntilBlockedBy(waiterPid: () => number | null, holderPid: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const pid = waiterPid();
    if (pid !== null) {
      const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT ${holderPid}::int = ANY(pg_blocking_pids(${pid}::int)) AS "blocked"`;
      if (blocked) return;
    }
    if (Date.now() > deadline) throw new Error(`the revocation never queued behind ${holderPid}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/* -------------------------------------------------------------------------- */
/* Revocations the tests apply, each with its undo                             */
/* -------------------------------------------------------------------------- */

async function roleId(key: string): Promise<string> {
  return (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
}

async function suspendMembership(membershipId: string): Promise<void> {
  await prisma.companyMember.update({ where: { id: membershipId }, data: { status: "SUSPENDED" } });
  restore.push(() => prisma.companyMember.update({ where: { id: membershipId }, data: { status: "ACTIVE" } }));
}

async function changeRole(membershipId: string, key: string): Promise<void> {
  const before = await prisma.companyMember.findUniqueOrThrow({ where: { id: membershipId }, select: { roleId: true } });
  await prisma.companyMember.update({ where: { id: membershipId }, data: { roleId: await roleId(key) } });
  restore.push(() => prisma.companyMember.update({ where: { id: membershipId }, data: { roleId: before.roleId } }));
}

async function endAssignment(projectId: string, membershipId: string): Promise<void> {
  const row = await prisma.projectMember.findFirstOrThrow({ where: { projectId, companyMemberId: membershipId, status: "ACTIVE" }, select: { id: true } });
  await prisma.projectMember.update({ where: { id: row.id }, data: { status: "INACTIVE" } });
  restore.push(() => prisma.projectMember.update({ where: { id: row.id }, data: { status: "ACTIVE" } }));
}

async function switchModuleOff(companyId: string, moduleKey: string): Promise<void> {
  const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId, module: { key: moduleKey } }, select: { id: true, enabled: true } });
  expect(row.enabled).toBe(true);
  await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
  restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
}

async function deactivateAccount(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status: "INACTIVE" } });
  restore.push(() => prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } }));
}

/* -------------------------------------------------------------------------- */
/* RP-15                                                                       */
/* -------------------------------------------------------------------------- */

describe("revocation reaches an already-resolved session and an outstanding form (RP-15)", () => {
  it("a role change: the Project Manager made a Viewer can no longer create or edit tasks", async () => {
    const pm = await signedIn(PM);
    // Positive control: the same form, the same person, before the change.
    expect(await act(() => createTaskAction(taskForm("role-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    expect(await taskTitled("role-before")).toEqual([expect.objectContaining({ companyId: COMPANY.a, createdByMemberId: PM })]);
    const existing = (await taskTitled("role-before"))[0];
    // Forms the page rendered while the role still held.
    const pendingCreate = taskForm("role-after");
    const pendingEdit = form({ title: `${PREFIX}role-edited`, projectId: PROJECT.a, status: "TODO", priority: "HIGH", expectedVersion: String(existing.version) });

    await changeRole(PM, "VIEWER");

    const next = await nextContext(pm);
    expect(next).toMatchObject({ userId: pm.userId, sessionId: pm.sessionId, membershipId: PM, role: "VIEWER" });
    expect(next.permissions).not.toContain("task.create");
    expect(next.permissions).not.toContain("task.update");
    await expectRefused(tasks.createTask(next, createTaskSchema.parse({ title: `${PREFIX}role-after`, projectId: PROJECT.a })), "FORBIDDEN");

    expect(await act(() => createTaskAction(pendingCreate))).toMatchObject({ kind: "result", result: { ok: false, code: "FORBIDDEN" } });
    expect(await act(() => updateTaskAction(existing.id, pendingEdit))).toMatchObject({ kind: "result", result: { ok: false } });
    expect(await taskTitled("role-after")).toEqual([]);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: existing.id }, select: { title: true, version: true } })).toEqual({ title: `${PREFIX}role-before`, version: existing.version });
  });

  it("a company membership suspended: the only workspace is gone, the form is sent away, nothing is written", async () => {
    const pm = await signedIn(PM);
    expect(await act(() => createTaskAction(taskForm("membership-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    const pending = taskForm("membership-after");

    await suspendMembership(PM);

    expect(await nextRequest(pm)).toEqual({ ok: false, reason: "MEMBERSHIP_INACTIVE" });
    expect(await act(() => createTaskAction(pending))).toEqual({ kind: "redirect", to: "/workspace-unavailable" });
    expect(await taskTitled("membership-after")).toEqual([]);
  });

  it("one of two memberships suspended: the session moves to the other company, and the old company's form writes nowhere", async () => {
    const architect = await signedIn(MULTI_A);
    expect(architect.companyId).toBe(COMPANY.a);
    expect(await act(() => createTaskAction(taskForm("multi-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    expect(await taskTitled("multi-before")).toEqual([expect.objectContaining({ companyId: COMPANY.a, createdByMemberId: MULTI_A })]);
    // Rendered in Aurelia, naming Aurelia's project.
    const pending = taskForm("multi-after");

    await suspendMembership(MULTI_A);

    // Same person, same session — now in Forma, the company still theirs (Workspace Context §82).
    const moved = await nextContext(architect);
    expect(moved).toMatchObject({ userId: architect.userId, sessionId: architect.sessionId, membershipId: MULTI_D, companyId: COMPANY.d });
    const outcome = await act(() => createTaskAction(pending));
    expect(outcome).toMatchObject({ kind: "result", result: { ok: false, code: "VALIDATION_ERROR" } });
    // Neither in Aurelia, where the membership is gone, nor in Forma, under Aurelia's project.
    expect(await taskTitled("multi-after")).toEqual([]);
  });

  it("a project assignment ended: the engineer loses the project's tasks and cannot file new work on it", async () => {
    const colleagues = await pmTaskOnProjectA("assignment-colleague");
    const engineer = await signedIn(ENGINEER);
    // Positive controls: while assigned, the engineer reads the colleague's task and files work on the project.
    expect((await tasks.getTask(engineer, colleagues.id)).id).toBe(colleagues.id);
    expect(await act(() => createTaskAction(taskForm("assignment-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    const pendingCreate = taskForm("assignment-after");
    const pendingEdit = form({ title: `${PREFIX}assignment-edited`, projectId: PROJECT.a, status: "TODO", priority: "HIGH", expectedVersion: String(colleagues.version) });

    await endAssignment(PROJECT.a, ENGINEER);

    const next = await nextContext(engineer);
    expect(next).toMatchObject({ sessionId: engineer.sessionId, membershipId: ENGINEER, role: "ENGINEER" });
    await expectRefused(tasks.getTask(next, colleagues.id), "NOT_FOUND");
    await expectRefused(tasks.createTask(next, createTaskSchema.parse({ title: `${PREFIX}assignment-after`, projectId: PROJECT.a })), "VALIDATION_ERROR");
    expect(await act(() => createTaskAction(pendingCreate))).toMatchObject({ kind: "result", result: { ok: false, code: "VALIDATION_ERROR" } });
    expect(await act(() => updateTaskAction(colleagues.id, pendingEdit))).toMatchObject({ kind: "result", result: { ok: false, code: "NOT_FOUND" } });
    expect(await taskTitled("assignment-after")).toEqual([]);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: colleagues.id }, select: { title: true, version: true } })).toEqual({ title: `${PREFIX}assignment-colleague`, version: colleagues.version });

    // The Project Manager, still assigned, does the same thing successfully afterwards.
    const pm = await loginAsMembership(PM);
    expect((await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}assignment-pm`, projectId: PROJECT.a }))).project?.id).toBe(PROJECT.a);
  });

  it("a module switched off: the Tasks module is unavailable to the open session and to its form", async () => {
    const pm = await signedIn(PM);
    expect(await act(() => createTaskAction(taskForm("module-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    const pending = taskForm("module-after");

    await switchModuleOff(COMPANY.a, "tasks");

    const next = await nextContext(pm);
    expect(next.enabledModules).not.toContain("tasks");
    expect(next.permissions.filter((permission) => permission.startsWith("task."))).toEqual([]);
    await expectRefused(tasks.createTask(next, createTaskSchema.parse({ title: `${PREFIX}module-after`, projectId: PROJECT.a })), "MODULE_UNAVAILABLE");
    expect(await act(() => createTaskAction(pending))).toMatchObject({ kind: "result", result: { ok: false, code: "MODULE_UNAVAILABLE" } });
    expect(await taskTitled("module-after")).toEqual([]);
  });

  it("an account deactivated: the session resolves to nobody and the form is sent to sign in", async () => {
    const pm = await signedIn(PM);
    expect(await act(() => createTaskAction(taskForm("account-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    const pending = taskForm("account-after");

    await deactivateAccount(pm.userId);

    expect(await nextRequest(pm)).toEqual({ ok: false, reason: "USER_INACTIVE" });
    expect(await act(() => createTaskAction(pending))).toEqual({ kind: "redirect", to: "/login?reason=account-unavailable" });
    expect(await taskTitled("account-after")).toEqual([]);
  });

  it("a session ended (sign-out, or a demo user switch away): the old session's form is sent to sign in", async () => {
    const pm = await signedIn(PM);
    expect(await act(() => createTaskAction(taskForm("session-before")))).toMatchObject({ kind: "result", result: { ok: true } });
    const pending = taskForm("session-after");

    await prisma.session.delete({ where: { id: pm.sessionId } });

    expect(await nextRequest(pm)).toEqual({ ok: false, reason: "SESSION_EXPIRED" });
    expect(await act(() => createTaskAction(pending))).toEqual({ kind: "redirect", to: "/login?reason=session-expired" });
    expect(await taskTitled("session-after")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* RP-16                                                                       */
/* -------------------------------------------------------------------------- */

const suspendInTx = (membershipId: string) => (tx: Prisma.TransactionClient) =>
  tx.$executeRaw`UPDATE "company_members" SET "status" = 'SUSPENDED' WHERE "id" = ${membershipId}`;

describe("a revocation racing a task edit is serial (RP-16)", () => {
  it("refuses an edit whose actor was suspended while it waited, and writes nothing — no version, activity or event", async () => {
    const pm = await loginAsMembership(PM);
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}race-edit`, projectId: PROJECT.a }));
    const activityBefore = await prisma.activity.count({ where: { entityId: task.id } });
    const outboxBefore = await prisma.notificationEventOutbox.count({ where: { entityId: task.id } });
    restore.push(() => prisma.companyMember.update({ where: { id: PM }, data: { status: "ACTIVE" } }));

    // The context was resolved while the membership was active; the edit
    // queues on the membership row the revocation holds, and runs after it commits.
    const outcome = await revocationCommitsFirst(suspendInTx(PM), () =>
      tasks.updateTask(pm, task.id, updateTaskSchema.parse({ title: `${PREFIX}race-edit-late`, projectId: PROJECT.a, status: "TODO", priority: "HIGH", expectedVersion: task.version })),
    );

    expect(outcome.ok).toBe(false);
    expect(codeOf((outcome as { error: unknown }).error)).toBe("MEMBERSHIP_INACTIVE");
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { title: true, version: true, priority: true } })).toEqual({ title: `${PREFIX}race-edit`, version: task.version, priority: "MEDIUM" });
    expect(await prisma.activity.count({ where: { entityId: task.id } })).toBe(activityBefore);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: task.id } })).toBe(outboxBefore);
  });

  it("commits an edit that locked the actor first, and makes the revocation wait for it; the next edit is refused", async () => {
    const pm = await loginAsMembership(PM);
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}race-first`, projectId: PROJECT.a }));
    restore.push(() => prisma.companyMember.update({ where: { id: PM }, data: { status: "ACTIVE" } }));

    // Hold the task row so the edit stops after taking its share lock on the
    // membership (the lock order is membership → task).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => (holding = resolve));
    const holder = locker.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
        await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ${task.id} FOR UPDATE`;
        holding(pid);
        await gate;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    const pid = await holderPid;
    const edit = settle(tasks.updateTask(pm, task.id, updateTaskSchema.parse({ title: `${PREFIX}race-first-edited`, projectId: PROJECT.a, status: "TODO", priority: "HIGH", expectedVersion: task.version })));
    await waitForBlocked(pid, 1);

    // The revocation, on a third connection: it queues behind the edit's share lock.
    const revoker = new PrismaClient();
    let revokerPid: number | null = null;
    const revocation = revoker.$transaction(async (tx) => {
      revokerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`)[0].pid;
      await suspendInTx(PM)(tx);
    });
    try {
      // Chain: the edit waits for the holder, the revocation for the edit.
      await waitForBlocked(pid, 2);
      const [{ editPid }] = await locker.$queryRaw<Array<{ editPid: number }>>`
        SELECT "pid" AS "editPid" FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids("pid")) LIMIT 1`;
      await waitUntilBlockedBy(() => revokerPid, editPid);
    } finally {
      release();
      await holder;
    }
    const [edited] = await Promise.all([edit, revocation]);
    await revoker.$disconnect();

    // Serial: the edit, then the revocation.
    expect(edited.ok).toBe(true);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { title: true, version: true } })).toEqual({ title: `${PREFIX}race-first-edited`, version: task.version + 1 });
    expect(await prisma.activity.count({ where: { entityId: task.id, action: "TASK_UPDATED" } })).toBe(1);
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: PM } })).status).toBe("SUSPENDED");
    // And after it, the same stale context is refused.
    await expectRefused(tasks.updateTask(pm, task.id, updateTaskSchema.parse({ title: `${PREFIX}race-first-again`, projectId: PROJECT.a, status: "TODO", priority: "LOW", expectedVersion: task.version + 1 })), "MEMBERSHIP_INACTIVE");
  });
});

describe("task creation re-reads the actor at the commit boundary (RP-16)", () => {
  /**
   * `createTask` resolves the context, prepares, then writes in one
   * transaction that first re-reads the actor (`assertActorCurrent`). Forced
   * here: the revocation takes the membership row FOR UPDATE and commits while
   * the create waits for it. The create then sees the suspension and writes
   * nothing — no task, no activity, no outbox event.
   *
   * Before AUD-06 the create had no such read and committed after the
   * revocation; this test asserted that gap until the fix landed.
   */
  it("refuses a create whose actor was suspended while it waited, and writes nothing", async () => {
    const pm = await loginAsMembership(PM);
    restore.push(() => prisma.companyMember.update({ where: { id: PM }, data: { status: "ACTIVE" } }));

    const outcome = await revocationCommitsFirst(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "company_members" WHERE "id" = ${PM} FOR UPDATE`;
        await suspendInTx(PM)(tx);
      },
      () => tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}race-create`, projectId: PROJECT.a, assigneeMemberId: ENGINEER })),
    );

    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: PM } })).status).toBe("SUSPENDED");
    expect(outcome.ok).toBe(false);
    expect(codeOf((outcome as { error: unknown }).error)).toBe("MEMBERSHIP_INACTIVE");
    expect(await taskTitled("race-create")).toHaveLength(0);
    expect(await prisma.activity.count({ where: { action: "TASK_CREATED", actorMemberId: PM, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBe(0);
    expect(await nextRequest(pm)).toEqual({ ok: false, reason: "MEMBERSHIP_INACTIVE" });
  });

  it("creates for a current actor (positive control)", async () => {
    const pm = await loginAsMembership(PM);
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}race-create-control`, projectId: PROJECT.a, assigneeMemberId: ENGINEER }));
    expect(await taskTitled("race-create-control")).toHaveLength(1);
    expect(await prisma.activity.count({ where: { entityId: task.id, action: "TASK_CREATED" } })).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The shared recheck: runInTransaction(..., { actor })                        */
/* -------------------------------------------------------------------------- */

/**
 * A write through the shared transaction helper with the actor it was decided
 * for: one activity row, standing in for any service's write, since the
 * recheck runs before the service's callback whatever it writes.
 */
function probe(context: UserContext, marker: string, inside?: (tx: Prisma.TransactionClient) => Promise<void>) {
  return runInTransaction(
    "aud06.revocation_probe",
    async (tx) => {
      await inside?.(tx);
      return tx.activity.create({
        data: { companyId: context.companyId, module: "tasks", entityType: "Task", entityId: `${PREFIX}${marker}`, action: "AUD06_PROBE", actorMemberId: context.membershipId },
        select: { id: true },
      });
    },
    { actor: context },
  );
}

const probeRows = (marker: string) => prisma.activity.count({ where: { entityId: `${PREFIX}${marker}` } });

describe("runInTransaction's actor recheck serialises every revocation it covers (RP-16)", () => {
  it("writes for a current actor (positive control)", async () => {
    const pm = await loginAsMembership(PM);
    await probe(pm, "current");
    expect(await probeRows("current")).toBe(1);
  });

  const cases: Array<{ name: string; code: string; revoke: (context: UserContext) => (tx: Prisma.TransactionClient) => Promise<unknown>; undo: (context: UserContext) => Promise<unknown> }> = [
    {
      name: "a membership suspended",
      code: "MEMBERSHIP_INACTIVE",
      revoke: (context) => suspendInTx(context.membershipId),
      undo: (context) => prisma.companyMember.update({ where: { id: context.membershipId }, data: { status: "ACTIVE" } }),
    },
    {
      name: "an account deactivated",
      code: "MEMBERSHIP_INACTIVE",
      revoke: (context) => (tx) => tx.$executeRaw`UPDATE "users" SET "status" = 'INACTIVE' WHERE "id" = ${context.userId}`,
      undo: (context) => prisma.user.update({ where: { id: context.userId }, data: { status: "ACTIVE" } }),
    },
    {
      name: "a role changed",
      code: "FORBIDDEN",
      revoke: (context) => async (tx) => {
        const [viewer] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "roles" WHERE "key" = 'VIEWER'`;
        await tx.$executeRaw`UPDATE "company_members" SET "roleId" = ${viewer.id} WHERE "id" = ${context.membershipId}`;
      },
      undo: async (context) => prisma.companyMember.update({ where: { id: context.membershipId }, data: { roleId: await roleId(context.role) } }),
    },
    {
      name: "the session ended (sign-out, demo user switch)",
      code: "UNAUTHENTICATED",
      revoke: (context) => (tx) => tx.$executeRaw`DELETE FROM "sessions" WHERE "id" = ${context.sessionId}`,
      undo: async () => undefined,
    },
  ];

  for (const { name, code, revoke, undo } of cases) {
    it(`refuses, with nothing written, a write whose actor lost access while it waited: ${name}`, async () => {
      const pm = await loginAsMembership(PM);
      restore.push(() => undo(pm));
      const marker = `refused-${code}-${name.length}`;
      const outcome = await revocationCommitsFirst(revoke(pm), () => probe(pm, marker));
      expect(outcome.ok).toBe(false);
      expect(codeOf((outcome as { error: unknown }).error)).toBe(code);
      expect(await probeRows(marker)).toBe(0);
    });
  }

  it("makes a revocation that arrives during the write wait for its commit", async () => {
    const pm = await loginAsMembership(PM);
    restore.push(() => prisma.companyMember.update({ where: { id: PM }, data: { status: "ACTIVE" } }));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inside!: (pid: number) => void;
    const writerPid = new Promise<number>((resolve) => (inside = resolve));
    // Stops inside the transaction, after the actor's share lock is taken.
    const write = settle(
      probe(pm, "first", async (tx) => {
        inside((await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`)[0].pid);
        await gate;
      }),
    );
    const pid = await writerPid;

    const revoker = new PrismaClient();
    let revokerPid: number | null = null;
    const revocation = revoker.$transaction(async (tx) => {
      revokerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`)[0].pid;
      await suspendInTx(PM)(tx);
    });
    try {
      await waitUntilBlockedBy(() => revokerPid, pid);
    } finally {
      release();
    }
    const [written] = await Promise.all([write, revocation]);
    await revoker.$disconnect();

    expect(written.ok).toBe(true);
    expect(await probeRows("first")).toBe(1);
    expect((await prisma.companyMember.findUniqueOrThrow({ where: { id: PM } })).status).toBe("SUSPENDED");
    // Once it has committed, the same actor is refused.
    await expectRefused(probe(pm, "after"), "MEMBERSHIP_INACTIVE");
    expect(await probeRows("after")).toBe(0);
  });
});
