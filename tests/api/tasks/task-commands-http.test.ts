import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * The task command contract over both transports (AUD-02 §6, TR-09, TR-21).
 *
 * The route handlers and the server actions are called as the browser calls
 * them, with only the cookie half of the session resolver replaced
 * (`security/harness/actor`). Every command route is checked, not just PATCH:
 * refusals keep their order — access, then the precondition, then the version —
 * and the two transports answer the same codes, write the same history and
 * refresh the same views.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
  revalidateTag: () => undefined,
}));

class Redirected extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirected(url);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { PATCH } = await import("@/app/api/tasks/[taskId]/route");
const routes = {
  start: (await import("@/app/api/tasks/[taskId]/start/route")).POST,
  block: (await import("@/app/api/tasks/[taskId]/block/route")).POST,
  complete: (await import("@/app/api/tasks/[taskId]/complete/route")).POST,
  reopen: (await import("@/app/api/tasks/[taskId]/reopen/route")).POST,
  archive: (await import("@/app/api/tasks/[taskId]/archive/route")).POST,
  restore: (await import("@/app/api/tasks/[taskId]/restore/route")).POST,
};
const actions = await import("@/lib/actions/tasks");

const created = new Set<string>();

beforeEach(() => {
  revalidated.length = 0;
});

afterEach(async () => {
  actAs(null);
  const ids = [...created];
  if (ids.length === 0) return;
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentType: "task", parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.task.deleteMany({ where: { id: { in: ids } } });
  created.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function newTask(context: UserContext, overrides: Record<string, unknown> = {}) {
  const task = await tasks.createTask(context, createTaskSchema.parse({ title: "aud02h_task", ...overrides }));
  created.add(task.id);
  return task;
}

type Handler = (request: Request, context: { params: Promise<{ taskId: string }> }) => Promise<Response>;

async function call(handler: Handler, method: string, taskId: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "content-type": "application/json" } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const response = await handler(new Request(`http://localhost/api/tasks/${taskId}`, init), { params: Promise.resolve({ taskId }) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The body each command needs besides its version, and the state it can be applied from. */
const COMMANDS = {
  start: { extra: {}, prepare: async () => undefined },
  block: { extra: { reason: "Waiting for the survey" }, prepare: async () => undefined },
  complete: { extra: {}, prepare: async () => undefined },
  reopen: { extra: { status: "IN_PROGRESS" }, prepare: async (context: UserContext, taskId: string) => void (await tasks.completeTask(context, taskId, { expectedVersion: 1 })) },
  archive: { extra: {}, prepare: async () => undefined },
  restore: { extra: {}, prepare: async (context: UserContext, taskId: string) => void (await tasks.archiveTask(context, taskId, { expectedVersion: 1 })) },
} as const;

describe("every command route (TR-09)", () => {
  for (const [name, command] of Object.entries(COMMANDS) as Array<[keyof typeof COMMANDS, (typeof COMMANDS)[keyof typeof COMMANDS]]>) {
    it(`${name}: access first, then 428, 422, 409, and 200 with the committed version`, async () => {
      const pm = await loginAs("PROJECT_MANAGER");
      const task = await newTask(pm);
      await command.prepare(pm, task.id);
      const version = (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version;
      const handler = routes[name];

      // Access outranks every other refusal: the Viewer is refused, the other company never learns the task exists.
      actAs(await loginAs("VIEWER"));
      expect((await call(handler, "POST", task.id)).status).toBe(403);
      actAs(await loginAsEmail(DEMO_EMAIL.tenantOwner));
      expect((await call(handler, "POST", task.id, { ...command.extra, expectedVersion: version })).status).toBe(404);

      actAs(pm);
      const missing = await call(handler, "POST", task.id);
      expect(missing.status).toBe(428);
      expect(missing.body?.error).toMatchObject({ code: "PRECONDITION_REQUIRED", details: { code: "TASK_VERSION_REQUIRED" } });
      expect((await call(handler, "POST", task.id, { ...command.extra })).status).toBe(428);

      for (const malformed of [0, -3, 2.5, "two"]) {
        const refused = await call(handler, "POST", task.id, { ...command.extra, expectedVersion: malformed });
        expect(refused.status, String(malformed)).toBe(422);
        expect(refused.body?.error.details).toHaveProperty("expectedVersion");
      }
      expect((await call(handler, "POST", task.id, "not json")).status).toBe(422);

      const stale = await call(handler, "POST", task.id, { ...command.extra, expectedVersion: version + 4 });
      expect(stale.status).toBe(409);
      expect(stale.body?.error.details).toEqual({ code: "TASK_VERSION_CONFLICT" });

      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(version);
      const ok = await call(handler, "POST", task.id, { ...command.extra, expectedVersion: version });
      expect(ok.status).toBe(200);
      expect(ok.body?.meta).toMatchObject({ taskId: task.id, changed: true, version: version + 1 });
      expect(ok.body?.data).toMatchObject({ id: task.id, version: version + 1 });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).version).toBe(version + 1);
      expect(revalidated).toEqual(expect.arrayContaining(["/tasks", `/tasks/${task.id}`, "/dashboard"]));

      // The same command again, at the version it produced, is a state conflict.
      const again = await call(handler, "POST", task.id, { ...command.extra, expectedVersion: version + 1 });
      expect(again.status).toBe(409);
      expect(again.body?.error.details).toMatchObject({ code: "TASK_STATE_CONFLICT" });
    });
  }

  it("PATCH: access first, then 428 for a legacy timestamp, 409 when stale, 200 with meta", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await newTask(pm);
    const body = { title: "aud02h_renamed", priority: "HIGH", status: "TODO" };

    actAs(await loginAs("VIEWER"));
    expect((await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: 1 })).status).toBe(403);
    actAs(await loginAsEmail(DEMO_EMAIL.tenantOwner));
    expect((await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: 1 })).status).toBe(404);

    actAs(pm);
    expect((await call(PATCH, "PATCH", task.id, { ...body, versionUpdatedAt: task.updatedAt })).status).toBe(428);
    expect((await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: "1.0" })).status).toBe(422);
    const ok = await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body?.meta).toMatchObject({ changed: true, version: 2 });
    const unchanged = await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: 2 });
    expect(unchanged.body?.meta).toMatchObject({ changed: false, version: 2 });
    expect((await call(PATCH, "PATCH", task.id, { ...body, expectedVersion: 1 })).status).toBe(409);
  });
});

describe("the server actions answer as the routes do (TR-21)", () => {
  it("gives the same codes, the same history and the same refreshed views", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const viaRoute = await newTask(pm);
    const viaAction = await newTask(pm);
    actAs(pm);

    revalidated.length = 0;
    const routeResult = await call(routes.complete, "POST", viaRoute.id, { expectedVersion: 1 });
    const routePaths = revalidated.map((path) => path.replace(viaRoute.id, ":id"));
    revalidated.length = 0;
    const actionResult = await actions.taskCommandAction(viaAction.id, "complete", { expectedVersion: 1 });
    const actionPaths = revalidated.map((path) => path.replace(viaAction.id, ":id"));

    expect(routeResult.body?.meta).toMatchObject({ changed: true, version: 2 });
    expect(actionResult).toMatchObject({ ok: true, meta: { changed: true, version: 2 } });
    expect(actionPaths.sort()).toEqual(routePaths.sort());

    const history = async (taskId: string) => (await prisma.activity.findMany({ where: { entityId: taskId }, orderBy: { createdAt: "asc" } })).map((row) => row.action);
    expect(await history(viaAction.id)).toEqual(await history(viaRoute.id));

    // Refusals keep their codes, not one message for everything.
    expect(await actions.taskCommandAction(viaAction.id, "complete", { expectedVersion: 1 })).toMatchObject({ ok: false, code: "TASK_VERSION_CONFLICT" });
    expect(await actions.taskCommandAction(viaAction.id, "complete", { expectedVersion: 2 })).toMatchObject({ ok: false, code: "TASK_STATE_CONFLICT" });
    expect(await actions.taskCommandAction(viaAction.id, "block", { expectedVersion: 2, reason: "x" })).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
      fieldErrors: { reason: expect.any(Array) },
    });
    actAs(await loginAs("VIEWER"));
    expect(await actions.taskCommandAction(viaAction.id, "reopen", { expectedVersion: 2 })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("saves the edit form against its version, and says where to go when the task is out of sight", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const owner = await loginAs("OWNER");
    const task = await newTask(pm);
    actAs(pm);

    const form = (values: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({ title: "aud02h_form", priority: "MEDIUM", status: "TODO", ...values })) data.set(key, value);
      return data;
    };

    expect(await actions.updateTaskAction(task.id, form({}))).toMatchObject({ ok: false, code: "TASK_VERSION_REQUIRED" });
    // The form navigates itself once its unsaved-work guard has let go (AUD-03), so the action answers where to go.
    expect(await actions.updateTaskAction(task.id, form({ expectedVersion: "1" }))).toMatchObject({ ok: true, redirectTo: `/tasks/${task.id}`, meta: { version: 2 } });
    expect(await actions.updateTaskAction(task.id, form({ expectedVersion: "1", title: "aud02h_stale" }))).toMatchObject({ ok: false, code: "TASK_VERSION_CONFLICT" });

    // The Owner's own task, assigned to the PM, handed on by the PM: saved, and out of sight.
    const handed = await newTask(owner, { assigneeMemberId: pm.membershipId });
    const colleague = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: pm.companyId, status: "ACTIVE", id: { notIn: [pm.membershipId, owner.membershipId] } },
      select: { id: true },
    });
    const result = await actions.updateTaskAction(handed.id, form({ expectedVersion: "1", assigneeMemberId: colleague.id }));
    expect(result).toMatchObject({ ok: true, redirectTo: "/tasks", meta: { version: 2 } });
    expect(await actions.taskReviewSnapshotAction(handed.id)).toEqual({ access: "lost" });
  });

  it("reads the review snapshot through the person's own scope", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await newTask(pm, { priority: "HIGH" });
    actAs(pm);
    const snapshot = await actions.taskReviewSnapshotAction(task.id);
    expect(snapshot).toMatchObject({ access: "ok", task: { id: task.id, version: 1, archived: false, values: { priority: "HIGH", title: "aud02h_task" } } });

    actAs(await loginAsEmail(DEMO_EMAIL.tenantOwner));
    expect(await actions.taskReviewSnapshotAction(task.id)).toEqual({ access: "lost" });
  });
});
