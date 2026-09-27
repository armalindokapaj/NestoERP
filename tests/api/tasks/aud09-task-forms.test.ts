import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

/**
 * AUD-09 — the task forms' payload contract, over the route and the server
 * action, against the real database (§3, §4, §5; FV-04, FV-05, FV-07, FV-08,
 * FV-09, FV-10, FV-22).
 *
 * Every refusal is paired with a positive control, and every expectation is
 * written down here rather than read back from the service: the row in
 * `tasks` is the oracle.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const { PATCH } = await import("@/app/api/tasks/[taskId]/route");
const { POST } = await import("@/app/api/tasks/route");
const actions = await import("@/lib/actions/tasks");

const PREFIX = "aud09b_";
const created = new Set<string>();
const restoreMembers: Array<{ id: string; status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "INVITED" }> = [];

afterEach(async () => {
  actAs(null);
  for (const member of restoreMembers.splice(0)) {
    await prisma.companyMember.update({ where: { id: member.id }, data: { status: member.status } });
  }
  const ids = [...created];
  if (ids.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function patch(taskId: string, body: unknown) {
  const response = await PATCH(
    new Request(`http://localhost/api/tasks/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ taskId }) },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function post(body: unknown) {
  const response = await POST(new Request("http://localhost/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const json = (await response.json()) as Json;
  if (response.status === 201) created.add(json.data.id);
  return { status: response.status, body: json };
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });

/** A task with every optional field filled, so an erasure would show. */
async function fullTask(context: UserContext) {
  const task = await tasks.createTask(
    context,
    createTaskSchema.parse({
      title: `${PREFIX}full`,
      description: "Pour the slab on level 3",
      projectId: PROJECT.a,
      assigneeMemberId: "member_engineer",
      status: "IN_PROGRESS",
      priority: "HIGH",
      startDate: "2031-03-02",
      dueDate: "2031-03-20",
    }),
  );
  created.add(task.id);
  return task;
}

describe("partial updates (FV-05, FV-10)", () => {
  it("a PATCH naming only the title changes only the title", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);

    const saved = await patch(task.id, { title: `${PREFIX}renamed`, expectedVersion: 1 });
    expect(saved.status).toBe(200);
    // Before AUD-09 the status fell back to TODO, the priority to MEDIUM, and
    // the description, project, assignee and dates were erased.
    expect(await row(task.id)).toMatchObject({
      title: `${PREFIX}renamed`,
      description: "Pour the slab on level 3",
      projectId: PROJECT.a,
      assigneeMemberId: "member_engineer",
      status: "IN_PROGRESS",
      priority: "HIGH",
      startDate: new Date("2031-03-02T00:00:00.000Z"),
      dueDate: new Date("2031-03-20T00:00:00.000Z"),
      version: 2,
    });
    // Only the title is recorded as changed.
    const activity = await prisma.activity.findFirstOrThrow({ where: { entityId: task.id, action: "TASK_UPDATED" } });
    expect((activity.metadata as { fields: string[] }).fields).toEqual(["title"]);
  });

  it("an explicit empty string or null clears; an omitted field is kept", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);

    expect((await patch(task.id, { description: "", expectedVersion: 1 })).status).toBe(200);
    expect(await row(task.id)).toMatchObject({ description: null, dueDate: new Date("2031-03-20T00:00:00.000Z"), assigneeMemberId: "member_engineer" });

    expect((await patch(task.id, { dueDate: null, assigneeMemberId: null, expectedVersion: 2 })).status).toBe(200);
    expect(await row(task.id)).toMatchObject({ dueDate: null, assigneeMemberId: null, startDate: new Date("2031-03-02T00:00:00.000Z"), projectId: PROJECT.a, priority: "HIGH" });

    const unassigned = await prisma.activity.count({ where: { entityId: task.id, action: "TASK_UNASSIGNED" } });
    expect(unassigned).toBe(1);
  });

  it("the edit form's server action keeps what its FormData did not carry", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);

    // A form whose status and priority controls were absent (hidden, disabled) sends neither.
    const result = await actions.updateTaskAction(task.id, form({ title: `${PREFIX}via form`, expectedVersion: "1" }));
    expect(result).toMatchObject({ ok: true, redirectTo: `/tasks/${task.id}` });
    expect(await row(task.id)).toMatchObject({ title: `${PREFIX}via form`, status: "IN_PROGRESS", priority: "HIGH", description: "Pour the slab on level 3" });

    // Positive control: a status the form does send is applied.
    expect(await actions.updateTaskAction(task.id, form({ status: "TODO", expectedVersion: "2" }))).toMatchObject({ ok: true });
    expect((await row(task.id)).status).toBe("TODO");
  });

  it("server-owned keys are stripped, never written, whatever the transport", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);
    const saved = await patch(task.id, { title: `${PREFIX}forged`, companyId: COMPANY.b, completedAt: "2020-01-01", createdByMemberId: "member_owner", version: 40, expectedVersion: 1 });
    expect(saved.status).toBe(200);
    expect(await row(task.id)).toMatchObject({ companyId: COMPANY.a, completedAt: null, createdByMemberId: pm.membershipId, version: 2 });
  });

  it("an untouched inactive assignee is kept; a new inactive one is refused (FV-10)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}legacy`, projectId: PROJECT.a, assigneeMemberId: "member_architect" }));
    created.add(task.id);
    restoreMembers.push({ id: "member_architect", status: "ACTIVE" });
    await prisma.companyMember.update({ where: { id: "member_architect" }, data: { status: "INACTIVE" } });
    actAs(pm);

    // The edit form shows the saved assignee and sends it back unchanged.
    const kept = await actions.updateTaskAction(task.id, form({ title: `${PREFIX}legacy kept`, projectId: PROJECT.a, assigneeMemberId: "member_architect", status: "TODO", priority: "MEDIUM", expectedVersion: "1" }));
    expect(kept).toMatchObject({ ok: true });
    expect(await row(task.id)).toMatchObject({ title: `${PREFIX}legacy kept`, assigneeMemberId: "member_architect" });

    // Choosing an inactive member anew is refused, on the field.
    const other = await tasks.createTask(pm, createTaskSchema.parse({ title: `${PREFIX}legacy other`, projectId: PROJECT.a }));
    created.add(other.id);
    const refused = await actions.updateTaskAction(other.id, form({ assigneeMemberId: "member_architect", expectedVersion: "1" }));
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { assigneeMemberId: [expect.any(String)] } });
    expect((await row(other.id)).assigneeMemberId).toBeNull();
  });
});

describe("dates and the schedule rule (FV-04, FV-07)", () => {
  it("refuses impossible and ambiguous dates on the field instead of rolling them over", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    actAs(pm);
    for (const dueDate of ["2031-02-30", "2031-13-01", "1", "02/03/2031", "tomorrow"]) {
      const refused = await post({ title: `${PREFIX}bad date`, dueDate });
      expect(refused.status, dueDate).toBe(422);
      expect(refused.body.error.details, dueDate).toHaveProperty("dueDate");
    }
    expect(await prisma.task.count({ where: { companyId: COMPANY.a, title: `${PREFIX}bad date` } })).toBe(0);

    // Positive controls: a real day (leap day included) and a full timestamp.
    const leap = await post({ title: `${PREFIX}leap`, dueDate: "2032-02-29" });
    expect(leap.status).toBe(201);
    expect((await row(leap.body.data.id)).dueDate).toEqual(new Date("2032-02-29T00:00:00.000Z"));
    const stamped = await post({ title: `${PREFIX}stamped`, dueDate: "2032-03-01T15:30:00+01:00" });
    expect(stamped.status).toBe(201);
    expect((await row(stamped.body.data.id)).dueDate).toEqual(new Date("2032-03-01T14:30:00.000Z"));
  });

  it("the same due-before-start rule on create, on edit and across the saved start", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    actAs(pm);

    const created = await actions.createTaskAction(form({ title: `${PREFIX}backwards`, startDate: "2031-05-10", dueDate: "2031-05-09" }));
    expect(created).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { dueDate: ["Due date must be on or after the start date."] } });
    expect(await prisma.task.count({ where: { companyId: COMPANY.a, title: `${PREFIX}backwards` } })).toBe(0);

    const task = await fullTask(pm); // 2031-03-02 → 2031-03-20
    // Only the due date is sent, and it is before the saved start.
    const refused = await patch(task.id, { dueDate: "2031-03-01", expectedVersion: 1 });
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toEqual({ dueDate: ["Due date must be on or after the start date."] });
    expect(await row(task.id)).toMatchObject({ version: 1, dueDate: new Date("2031-03-20T00:00:00.000Z") });

    // Positive control: the same day as the start is allowed.
    expect((await patch(task.id, { dueDate: "2031-03-02", expectedVersion: 1 })).status).toBe(200);
    expect((await row(task.id)).dueDate).toEqual(new Date("2031-03-02T00:00:00.000Z"));
  });

  it("refuses an invalid enum or an over-long title with a field error, and writes nothing", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);
    for (const [body, field] of [
      [{ status: "DONE" }, "status"],
      [{ priority: "" }, "priority"],
      [{ title: "x" }, "title"],
      [{ title: "t".repeat(201) }, "title"],
      [{ title: "   " }, "title"],
    ] as const) {
      const refused = await patch(task.id, { ...body, expectedVersion: 1 });
      expect(refused.status, JSON.stringify(body)).toBe(422);
      expect(refused.body.error.details, JSON.stringify(body)).toHaveProperty(field);
    }
    expect(await row(task.id)).toMatchObject({ version: 1, title: `${PREFIX}full`, status: "IN_PROGRESS", priority: "HIGH" });
  });
});

describe("dependent project → assignee picker (FV-08, FV-09)", () => {
  it("offers the chosen project's team, and nothing for a project out of reach", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    actAs(pm);

    const team = await prisma.projectMember.findMany({ where: { projectId: PROJECT.a, status: "ACTIVE", member: { status: "ACTIVE" } }, select: { companyMemberId: true } });
    const onA = await actions.taskAssigneeOptionsAction(PROJECT.a);
    expect(onA.ok).toBe(true);
    const offered = (onA as { options: Array<{ value: string }> }).options.map((option) => option.value).sort();
    expect(offered).toEqual([...new Set([...team.map((row) => row.companyMemberId), "member_pm"])].sort());
    // The Owner is in the company, not on project A's team: not offered for it.
    expect(offered).not.toContain("member_owner");

    // No project: the company's active members, the Owner among them.
    const none = await actions.taskAssigneeOptionsAction(null);
    expect((none as { options: Array<{ value: string }> }).options.map((option) => option.value)).toContain("member_owner");

    // Another company's project answers a refusal, not its team.
    expect(await actions.taskAssigneeOptionsAction(PROJECT.b)).toMatchObject({ ok: false, code: "PROJECT_UNAVAILABLE" });
    expect(await actions.taskAssigneeOptionsAction("project_does_not_exist")).toMatchObject({ ok: false, code: "PROJECT_UNAVAILABLE" });
  });

  it("refuses forged foreign ids on their fields, and the row is untouched", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);

    const foreignProject = await patch(task.id, { projectId: PROJECT.b, expectedVersion: 1 });
    expect(foreignProject.status).toBe(422);
    expect(foreignProject.body.error.details).toHaveProperty("projectId");

    const foreignMember = await patch(task.id, { assigneeMemberId: "member_owner__b", expectedVersion: 1 });
    expect(foreignMember.status).toBe(422);
    expect(foreignMember.body.error.details).toHaveProperty("assigneeMemberId");

    // In the company but not on the project's team.
    const offTeam = await actions.updateTaskAction(task.id, form({ assigneeMemberId: "member_owner", expectedVersion: "1" }));
    expect(offTeam).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { assigneeMemberId: [expect.stringContaining("project")] } });

    expect(await row(task.id)).toMatchObject({ version: 1, projectId: PROJECT.a, assigneeMemberId: "member_engineer" });

    // Positive control: a member of the team is accepted.
    expect(await actions.updateTaskAction(task.id, form({ assigneeMemberId: "member_qaqc", expectedVersion: "1" }))).toMatchObject({ ok: true });
    expect((await row(task.id)).assigneeMemberId).toBe("member_qaqc");
  });
});

describe("conflicts still go to the AUD-02 review (FV-13)", () => {
  it("a stale form save answers TASK_VERSION_CONFLICT and changes nothing", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const task = await fullTask(pm);
    actAs(pm);
    expect(await actions.updateTaskAction(task.id, form({ priority: "LOW", expectedVersion: "1" }))).toMatchObject({ ok: true });
    const stale = await actions.updateTaskAction(task.id, form({ title: `${PREFIX}stale`, expectedVersion: "1" }));
    expect(stale).toMatchObject({ ok: false, code: "TASK_VERSION_CONFLICT" });
    expect(await row(task.id)).toMatchObject({ version: 2, title: `${PREFIX}full`, priority: "LOW" });
  });
});
