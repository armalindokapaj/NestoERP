import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { addLocalDays, localDate } from "@/lib/modules/calendar/calendar.time";
import { convertActionToTask, createActionItem, updateActionItem } from "@/lib/modules/meetings/meeting.actions";
import { createMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { createMeeting, startMeeting } from "@/lib/modules/meetings/meeting.service";
import { updateTaskSchema } from "@/lib/modules/tasks/task.schema";
import * as tasks from "@/lib/modules/tasks/task.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma, PROJECT } from "../../helpers";
import { expectRefusal, failingWrites, locker, orphanTaskHistory, raceBehindRow, removeTasks, settle } from "../tasks/aud10-support";

/**
 * AUD-10 §5 (CW-07..CW-11): a meeting action and its Task are one piece of
 * work, against the real database and the real services.
 *
 * Every expectation is written from the PRD's mapping table, not read back
 * from the code under test: TODO→OPEN, IN_PROGRESS/BLOCKED→IN_PROGRESS,
 * COMPLETED→DONE, assignee (incl. none)→owner, ARCHIVED→unchanged, a CANCELLED
 * action untouched. Races hold the contested row on a second connection until
 * Postgres shows every contender queued behind it. Assertions read the rows:
 * the action, the task, its version, history and outbox events.
 *
 * The meetings are on Riverside (PROJECT.a), organised by the Project Manager
 * with the Engineer attending; everything they leave is removed after each
 * test (owned prefix `aud10c_`).
 */

const PREFIX = "aud10c_";
const ZONE = "Europe/Tirane";
const meetings = new Set<string>();

let pm: UserContext;
let pm2: UserContext;
let engineer: UserContext;
let engineer2: UserContext;
let owner: UserContext;

beforeAll(async () => {
  [pm, pm2, engineer, engineer2, owner] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("PROJECT_MANAGER"), loginAs("ENGINEER"), loginAs("ENGINEER"), loginAs("OWNER")]);
});

afterEach(async () => {
  const ids = [...meetings];
  if (ids.length === 0) return;
  const linked = await prisma.meetingActionItem.findMany({ where: { meetingId: { in: ids }, linkedTaskId: { not: null } }, select: { linkedTaskId: true } });
  const raised = await prisma.task.findMany({ where: { entityType: "meeting", entityId: { in: ids } }, select: { id: true } });
  await removeTasks([...new Set([...linked.map((row) => row.linkedTaskId!), ...raised.map((row) => row.id)])]);
  await prisma.meetingActionItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: ids } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { id: { in: ids } } });
  meetings.clear();
});

afterAll(async () => {
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

const today = () => localDate(new Date(), ZONE);

async function heldMeeting(): Promise<string> {
  const { meeting } = await createMeeting(
    pm,
    createMeetingSchema.parse({
      title: `${PREFIX}meeting`,
      meetingType: "INTERNAL",
      visibility: "PROJECT",
      projectId: PROJECT.a,
      date: addLocalDays(today(), 3),
      startTime: "10:00",
      endTime: "11:00",
      participants: [{ memberId: engineer.membershipId, role: "ATTENDEE" }],
    }),
  );
  meetings.add(meeting.id);
  await startMeeting(pm, meeting.id);
  return meeting.id;
}

/** A standalone action on a held meeting, owned by the Engineer. */
async function standalone(meetingId: string, overrides: Record<string, unknown> = {}) {
  const detail = await createActionItem(pm, meetingId, { title: `${PREFIX}action`, description: null, ownerMemberId: engineer.membershipId, dueDate: addLocalDays(today(), 5), createTask: false, ...overrides });
  return detail.actions[detail.actions.length - 1];
}

/** An action handed to a Task on creation: the task is the Engineer's, on Riverside. */
async function linked(meetingId: string) {
  const detail = await createActionItem(pm, meetingId, { title: `${PREFIX}linked`, description: null, ownerMemberId: engineer.membershipId, dueDate: addLocalDays(today(), 5), createTask: true });
  const action = detail.actions[detail.actions.length - 1];
  expect(detail.taskHandoff).toEqual({ created: true, taskId: action.task!.id });
  return { actionId: action.id, taskId: action.task!.id };
}

const actionRow = (id: string) => prisma.meetingActionItem.findUniqueOrThrow({ where: { id } });
const taskRow = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const version = async (taskId: string) => ({ expectedVersion: (await taskRow(taskId)).version });
const meetingHistory = (meetingId: string, action: string) => prisma.activity.count({ where: { entityId: meetingId, action } });
const meetingEvents = (meetingId: string, eventType: string) => prisma.notificationEventOutbox.count({ where: { entityId: meetingId, eventType } });
const taskEvents = (taskId: string, eventType: string) => prisma.notificationEventOutbox.count({ where: { entityId: taskId, eventType } });

function edit(task: { title: string; priority: string; projectId: string | null; assigneeMemberId: string | null; dueDate: Date | null }, overrides: Record<string, unknown>) {
  return updateTaskSchema.parse({
    title: task.title,
    priority: task.priority,
    projectId: task.projectId ?? undefined,
    assigneeMemberId: task.assigneeMemberId ?? undefined,
    dueDate: task.dueDate?.toISOString().slice(0, 10),
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* CW-07                                                                       */
/* -------------------------------------------------------------------------- */

describe("action → task conversion (CW-07, gaps 1, 4, 5)", () => {
  it("two concurrent conversions create one canonical task and link; both callers are answered with it", async () => {
    const meetingId = await heldMeeting();
    const action = await standalone(meetingId);
    const since = new Date();

    const results = await raceBehindRow("meeting_action_items", action.id, [() => convertActionToTask(pm, meetingId, action.id), () => convertActionToTask(pm2, meetingId, action.id)]);

    expect(results.every((result) => result.ok), JSON.stringify(results.map((r) => (r.ok ? "ok" : String((r as { error: unknown }).error))))).toBe(true);
    const values = results.map((result) => (result as { value: Awaited<ReturnType<typeof convertActionToTask>> }).value);
    expect(values.map((value) => value.created).sort()).toEqual([false, true]);
    expect(values[0].taskId).toBe(values[1].taskId);

    const tasksForMeeting = await prisma.task.findMany({ where: { entityType: "meeting", entityId: meetingId } });
    expect(tasksForMeeting).toHaveLength(1);
    expect(tasksForMeeting[0]).toMatchObject({ id: values[0].taskId, assigneeMemberId: engineer.membershipId, projectId: PROJECT.a, status: "TODO", version: 1 });
    expect((await actionRow(action.id)).linkedTaskId).toBe(values[0].taskId);
    // The loser's task rolled back with everything it wrote.
    expect(await orphanTaskHistory(since)).toBe(0);
    expect(await prisma.activity.count({ where: { entityId: values[0].taskId, action: "TASK_CREATED" } })).toBe(1);
    expect(await taskEvents(values[0].taskId, "TASK_ASSIGNED")).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: meetingId, actionKey: "MEETING_ACTION_TASK_CREATED" } })).toBe(1);

    // A later retry: the same task, still one.
    const retry = await convertActionToTask(pm, meetingId, action.id);
    expect(retry).toMatchObject({ taskId: values[0].taskId, created: false });
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meetingId } })).toBe(1);
  });

  it("answers a retry by somebody who may not open the task with a neutral refusal that does not name it", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    const taskTitle = (await taskRow(taskId)).title;
    // The same organiser without the right to read tasks.
    const blind: UserContext = { ...pm, permissions: pm.permissions.filter((permission) => permission !== "task.view") };

    const refusal = await expectRefusal(convertActionToTask(blind, meetingId, actionId), "ACTION_ALREADY_CONVERTED");
    expect(JSON.stringify({ message: refusal.message, details: refusal.details })).not.toContain(taskTitle);
    expect(JSON.stringify(refusal.details)).not.toContain(taskId);
    // Positive control: the reader who may open it gets it back.
    expect(await convertActionToTask(pm, meetingId, actionId)).toMatchObject({ taskId, created: false });
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meetingId } })).toBe(1);
  });

  it("gives a cancelled action no task, including one cancelled while the conversion waits for it", async () => {
    const meetingId = await heldMeeting();
    const cancelled = await standalone(meetingId);
    await updateActionItem(pm, meetingId, cancelled.id, { status: "CANCELLED" });
    await expectRefusal(convertActionToTask(pm, meetingId, cancelled.id), "ACTION_CLOSED");

    const racing = await standalone(meetingId, { title: `${PREFIX}racing` });
    const since = new Date();
    const [outcome] = await raceBehindRow("meeting_action_items", racing.id, [() => convertActionToTask(pm, meetingId, racing.id)], async (tx) => {
      await tx.meetingActionItem.update({ where: { id: racing.id }, data: { status: "CANCELLED" } });
    });
    expect(outcome.ok).toBe(false);
    await expectRefusal(Promise.reject((outcome as { error: unknown }).error), "ACTION_CLOSED");
    expect(await actionRow(racing.id)).toMatchObject({ status: "CANCELLED", linkedTaskId: null });
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meetingId } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);

    // Positive control: an open action converts.
    const open = await standalone(meetingId, { title: `${PREFIX}open` });
    expect((await convertActionToTask(pm, meetingId, open.id)).created).toBe(true);
  });

  it("re-reads the actor at the commit boundary: a session ended after the decision writes nothing", async () => {
    const meetingId = await heldMeeting();
    const action = await standalone(meetingId);
    const ended = await loginAs("PROJECT_MANAGER");
    await prisma.session.delete({ where: { id: ended.sessionId! } });

    await expectRefusal(convertActionToTask(ended, meetingId, action.id), "UNAUTHENTICATED");
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meetingId } })).toBe(0);
    expect((await actionRow(action.id)).linkedTaskId).toBeNull();
    expect((await convertActionToTask(pm, meetingId, action.id)).created).toBe(true);
  });
});

describe("forged ids (CW-13)", () => {
  it("refuses an action of another meeting, and another company's person, before writing", async () => {
    const meetingId = await heldMeeting();
    const otherMeetingId = await heldMeeting();
    const action = await standalone(otherMeetingId);
    const since = new Date();

    // This meeting's page, the other meeting's action: not found here.
    await expectRefusal(convertActionToTask(pm, meetingId, action.id), "NOT_FOUND");
    await expectRefusal(updateActionItem(pm, meetingId, action.id, { status: "DONE" }), "NOT_FOUND");
    // Meridian's project manager naming Aurelia's meeting.
    const pmB = await loginAsEmail(DEMO_EMAIL.pmB);
    await expectRefusal(convertActionToTask(pmB, otherMeetingId, action.id), "NOT_FOUND");

    expect(await actionRow(action.id)).toMatchObject({ status: "OPEN", linkedTaskId: null });
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: { in: [meetingId, otherMeetingId] } } })).toBe(0);
    expect(await orphanTaskHistory(since)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Gap 6: add with "Create a task"                                             */
/* -------------------------------------------------------------------------- */

describe("adding an action with a task (gap 6)", () => {
  it("commits the action, the task and the link together, and the owner hears once — from the task", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    expect(await actionRow(actionId)).toMatchObject({ linkedTaskId: taskId, ownerMemberId: engineer.membershipId });
    expect(await meetingEvents(meetingId, "MEETING_ACTION_ASSIGNED")).toBe(0);
    expect(await taskEvents(taskId, "TASK_ASSIGNED")).toBe(1);
  });

  it("answers truthfully when the action committed but the task was refused, with the owner told in the same transaction", async () => {
    const meetingId = await heldMeeting();
    const sales = await loginAs("SALES");
    // Sales is not on Riverside's team, so the task service refuses the hand-off.
    const detail = await createActionItem(pm, meetingId, { title: `${PREFIX}offteam`, description: null, ownerMemberId: sales.membershipId, createTask: true });
    expect(detail.taskHandoff).toMatchObject({ created: false, code: "VALIDATION_ERROR" });
    expect((detail.taskHandoff as { message: string }).message).toMatch(/project/i);
    const action = detail.actions.find((row) => row.title === `${PREFIX}offteam`)!;
    expect(await actionRow(action.id)).toMatchObject({ linkedTaskId: null, ownerMemberId: sales.membershipId, status: "OPEN" });
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meetingId } })).toBe(0);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_ASSIGNED")).toBe(1);
    expect(await meetingHistory(meetingId, "MEETING_ACTION_CREATED")).toBe(1);
  });

  it("rolls the whole command back — action included — when the database fails mid-way", async () => {
    const meetingId = await heldMeeting();
    await failingWrites("tasks", `NEW."title" = '${PREFIX}boom'`, async () => {
      const outcome = await settle(createActionItem(pm, meetingId, { title: `${PREFIX}boom`, description: null, ownerMemberId: engineer.membershipId, createTask: true }));
      expect(outcome.ok).toBe(false);
    });
    expect(await prisma.meetingActionItem.count({ where: { meetingId } })).toBe(0);
    expect(await meetingHistory(meetingId, "MEETING_ACTION_CREATED")).toBe(0);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_ASSIGNED")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* CW-08                                                                       */
/* -------------------------------------------------------------------------- */

describe("task → action mapping through every Task writer (CW-08)", () => {
  it("follows start, block, complete, reopen, the edit form, reassignment, no assignee and the due date", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);

    await tasks.startTask(engineer, taskId, await version(taskId));
    expect(await actionRow(actionId)).toMatchObject({ status: "IN_PROGRESS", completedAt: null });

    await tasks.blockTask(engineer, taskId, { ...(await version(taskId)), reason: "Waiting for the crane" });
    expect((await taskRow(taskId)).status).toBe("BLOCKED");
    expect(await actionRow(actionId)).toMatchObject({ status: "IN_PROGRESS", completedAt: null });

    await tasks.completeTask(engineer, taskId, await version(taskId));
    const done = await actionRow(actionId);
    expect(done.status).toBe("DONE");
    expect(done.completedAt).toBeInstanceOf(Date);

    await tasks.reopenTask(owner, taskId, { ...(await version(taskId)), status: "IN_PROGRESS" });
    expect(await actionRow(actionId)).toMatchObject({ status: "IN_PROGRESS", completedAt: null });

    // The edit form: status to To Do, the assignee to the PM, a new due date.
    const newDue = addLocalDays(today(), 12);
    const current = await taskRow(taskId);
    await tasks.updateTask(pm, taskId, { ...edit(current, { status: "TODO", assigneeMemberId: pm.membershipId, dueDate: newDue }), ...(await version(taskId)) });
    const moved = await actionRow(actionId);
    expect(moved).toMatchObject({ status: "OPEN", ownerMemberId: pm.membershipId, completedAt: null });
    expect(moved.dueAt?.toISOString()).toBe(`${newDue}T12:00:00.000Z`);

    // Nobody assigned: the action has no owner either.
    const again = await taskRow(taskId);
    // Unassigning is an explicit clear (`null`); leaving the assignee out keeps it (AUD-09 §4, FV-05).
    await tasks.updateTask(pm, taskId, { ...edit(again, { status: "TODO", assigneeMemberId: null }), ...(await version(taskId)) });
    expect((await taskRow(taskId)).assigneeMemberId).toBeNull();
    expect((await actionRow(actionId)).ownerMemberId).toBeNull();

    // An edit touching none of the mapped fields leaves the action as it was.
    const before = await actionRow(actionId);
    const untouched = await taskRow(taskId);
    await tasks.updateTask(pm, taskId, { ...edit(untouched, { status: "TODO", priority: "HIGH", assigneeMemberId: null }), ...(await version(taskId)) });
    expect(await actionRow(actionId)).toMatchObject({ status: before.status, ownerMemberId: before.ownerMemberId, dueAt: before.dueAt, updatedAt: before.updatedAt });
  });
});

/* -------------------------------------------------------------------------- */
/* CW-09                                                                       */
/* -------------------------------------------------------------------------- */

describe("completion history (CW-09, gaps 3, 8)", () => {
  it("records each genuine completion through the task once — complete, reopen, complete is two — and a replay none", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);

    await tasks.completeTask(engineer, taskId, await version(taskId));
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);
    const history = await prisma.activity.findFirstOrThrow({ where: { entityId: meetingId, action: "MEETING_ACTION_COMPLETED" } });
    expect(history).toMatchObject({ actorMemberId: engineer.membershipId, module: "meetings", entityType: "Meeting" });
    expect(history.metadata).toMatchObject({ actionId, taskId });

    // Replays: the same command at the old version, and at the new one.
    await expectRefusal(tasks.completeTask(engineer, taskId, { expectedVersion: 1 }), "TASK_VERSION_CONFLICT");
    await expectRefusal(tasks.completeTask(engineer, taskId, await version(taskId)), "TASK_STATE_CONFLICT");
    // An edit that keeps it completed is not a second completion.
    const completed = await taskRow(taskId);
    await tasks.updateTask(pm, taskId, { ...edit(completed, { status: "COMPLETED", priority: "HIGH" }), ...(await version(taskId)) });
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);

    await tasks.reopenTask(owner, taskId, await version(taskId));
    expect((await actionRow(actionId)).status).toBe("OPEN");
    await tasks.completeTask(engineer, taskId, await version(taskId));
    expect((await actionRow(actionId)).status).toBe("DONE");
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(2);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(2);
    expect(await taskEvents(taskId, "TASK_COMPLETED")).toBe(2);
  });

  it("writes a standalone action's concurrent double completion once: one history row, one notification", async () => {
    const meetingId = await heldMeeting();
    const action = await standalone(meetingId);

    const results = await raceBehindRow("meeting_action_items", action.id, [
      () => updateActionItem(engineer, meetingId, action.id, { status: "DONE" }),
      () => updateActionItem(engineer2, meetingId, action.id, { status: "DONE" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const row = await actionRow(action.id);
    expect(row.status).toBe("DONE");
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(1);

    // Reopened and completed again is a new completion.
    await updateActionItem(engineer, meetingId, action.id, { status: "OPEN" });
    await updateActionItem(engineer, meetingId, action.id, { status: "DONE" });
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(2);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* CW-10                                                                       */
/* -------------------------------------------------------------------------- */

describe("cancelled actions, archive and restore (CW-10)", () => {
  it("never resurrects or reassigns a cancelled action through its task", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    // No product path cancels a linked action (its status is the task's); a
    // cancelled linked action is the sanctioned legacy state the sync must leave alone.
    await prisma.meetingActionItem.update({ where: { id: actionId }, data: { status: "CANCELLED" } });
    const cancelled = await actionRow(actionId);

    await tasks.completeTask(engineer, taskId, await version(taskId));
    await tasks.reopenTask(owner, taskId, await version(taskId));
    const current = await taskRow(taskId);
    await tasks.updateTask(pm, taskId, { ...edit(current, { status: "TODO", assigneeMemberId: pm.membershipId, dueDate: addLocalDays(today(), 20) }), ...(await version(taskId)) });

    expect((await taskRow(taskId)).assigneeMemberId).toBe(pm.membershipId);
    expect(await actionRow(actionId)).toMatchObject({ status: "CANCELLED", ownerMemberId: cancelled.ownerMemberId, dueAt: cancelled.dueAt, completedAt: null });
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(0);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(0);
  });

  it("archive leaves the action where it was; restore re-syncs it without resetting its owner", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    await tasks.startTask(engineer, taskId, await version(taskId));

    await tasks.archiveTask(pm, taskId, await version(taskId));
    expect(await actionRow(actionId)).toMatchObject({ status: "IN_PROGRESS", ownerMemberId: engineer.membershipId, linkedTaskId: taskId });

    // Drift while the task is archived (the action cannot be edited: it follows the task).
    await expectRefusal(updateActionItem(pm, meetingId, actionId, { status: "OPEN" }), "ACTION_FOLLOWS_TASK");
    await prisma.meetingActionItem.update({ where: { id: actionId }, data: { status: "OPEN" } });

    await tasks.restoreTask(pm, taskId, await version(taskId));
    expect((await taskRow(taskId)).status).toBe("IN_PROGRESS");
    expect(await actionRow(actionId)).toMatchObject({ status: "IN_PROGRESS", ownerMemberId: engineer.membershipId, linkedTaskId: taskId });
  });
});

/* -------------------------------------------------------------------------- */
/* CW-11                                                                       */
/* -------------------------------------------------------------------------- */

describe("task-owned fields and failed sync (CW-11, gap 2)", () => {
  it("refuses a direct change to a linked action's status, owner or due date, and allows its own fields", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    const before = await actionRow(actionId);
    const task = await taskRow(taskId);

    await expectRefusal(updateActionItem(pm, meetingId, actionId, { ownerMemberId: pm.membershipId }), "ACTION_FOLLOWS_TASK");
    await expectRefusal(updateActionItem(pm, meetingId, actionId, { ownerMemberId: null }), "ACTION_FOLLOWS_TASK");
    await expectRefusal(updateActionItem(pm, meetingId, actionId, { dueDate: addLocalDays(today(), 30) }), "ACTION_FOLLOWS_TASK");
    await expectRefusal(updateActionItem(pm, meetingId, actionId, { dueDate: null }), "ACTION_FOLLOWS_TASK");
    await expectRefusal(updateActionItem(pm, meetingId, actionId, { status: "DONE" }), "ACTION_FOLLOWS_TASK");
    // Nothing moved on either side.
    expect(await actionRow(actionId)).toMatchObject({ ownerMemberId: before.ownerMemberId, dueAt: before.dueAt, status: before.status });
    expect(await taskRow(taskId)).toMatchObject({ version: task.version, assigneeMemberId: task.assigneeMemberId });
    expect(await meetingEvents(meetingId, "MEETING_ACTION_ASSIGNED")).toBe(0);

    // Positive controls: the values it already has are not a change, and the title is the action's own.
    const due = before.dueAt!.toISOString().slice(0, 10);
    await updateActionItem(pm, meetingId, actionId, { ownerMemberId: engineer.membershipId, dueDate: due, status: before.status, title: `${PREFIX}renamed` });
    expect(await actionRow(actionId)).toMatchObject({ title: `${PREFIX}renamed`, ownerMemberId: engineer.membershipId });

    // A standalone action keeps today's behaviour: reassigned directly, the new owner told.
    const loose = await standalone(meetingId, { title: `${PREFIX}loose` });
    await updateActionItem(pm, meetingId, loose.id, { ownerMemberId: owner.membershipId, dueDate: addLocalDays(today(), 9) });
    expect(await actionRow(loose.id)).toMatchObject({ ownerMemberId: owner.membershipId });
    expect(await meetingEvents(meetingId, "MEETING_ACTION_ASSIGNED")).toBe(2);
  });

  it("keeps refusing somebody who neither manages nor owns the action (AUD-06 RP-09)", async () => {
    const meetingId = await heldMeeting();
    const action = await standalone(meetingId, { ownerMemberId: pm.membershipId });
    await expectRefusal(updateActionItem(engineer, meetingId, action.id, {}), "FORBIDDEN");
    await expectRefusal(updateActionItem(engineer, meetingId, action.id, { status: "DONE" }), "FORBIDDEN");
    expect((await actionRow(action.id)).status).toBe("OPEN");
  });

  it("rolls the task's change back — version, history and events — when writing its action fails", async () => {
    const meetingId = await heldMeeting();
    const { actionId, taskId } = await linked(meetingId);
    const before = await taskRow(taskId);

    await failingWrites("meeting_action_items", `NEW."id" = '${actionId}'`, async () => {
      const outcome = await settle(tasks.completeTask(engineer, taskId, { expectedVersion: before.version }));
      expect(outcome.ok).toBe(false);
    });
    expect(await taskRow(taskId)).toMatchObject({ status: "TODO", version: before.version, completedAt: null });
    expect(await prisma.activity.count({ where: { entityId: taskId, action: "TASK_COMPLETED" } })).toBe(0);
    expect(await taskEvents(taskId, "TASK_COMPLETED")).toBe(0);
    expect(await meetingHistory(meetingId, "MEETING_ACTION_COMPLETED")).toBe(0);
    expect(await meetingEvents(meetingId, "MEETING_ACTION_COMPLETED")).toBe(0);
    expect((await actionRow(actionId)).status).toBe("OPEN");

    // Positive control: without the failure the same command commits both.
    await tasks.completeTask(engineer, taskId, { expectedVersion: before.version });
    expect((await taskRow(taskId)).version).toBe(before.version + 1);
    expect((await actionRow(actionId)).status).toBe("DONE");
  });
});
