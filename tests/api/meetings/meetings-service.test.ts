import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { attentionConditionDefinitions } from "@/lib/core/notifications/attention.conditions";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { globalSearch } from "@/lib/core/search/search.service";
import { findConflicts } from "@/lib/modules/calendar/calendar.availability";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { runCalendarReminders } from "@/lib/modules/calendar/calendar.reminders";
import { addLocalDays, instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import { addAgendaItem, applyAgendaTemplate, reorderAgenda, updateAgendaItem } from "@/lib/modules/meetings/meeting.agenda";
import { convertActionToTask, createActionItem, listActionItems, updateActionItem } from "@/lib/modules/meetings/meeting.actions";
import { archiveDecision, recordDecision } from "@/lib/modules/meetings/meeting.decisions";
import { addMinutesSection, finalizeMinutes, reopenMinutes, updateMinutesSection } from "@/lib/modules/meetings/meeting.minutes";
import { addParticipants, removeParticipant, respondToMeeting, transferOrganizer, updateParticipant } from "@/lib/modules/meetings/meeting.participants";
import { actionListQuerySchema, createMeetingSchema, meetingListQuerySchema, updateMeetingSchema } from "@/lib/modules/meetings/meeting.schema";
import { extendMeetingSeries } from "@/lib/modules/meetings/meeting.series";
import {
  cancelMeeting,
  completeMeeting,
  createMeeting,
  duplicateMeeting,
  getMeeting,
  listMeetings,
  scheduleMeeting,
  startMeeting,
  updateMeeting,
} from "@/lib/modules/meetings/meeting.service";
import { completeTask, reopenTask } from "@/lib/modules/tasks/task.service";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, prisma, PROJECT, taskVersion } from "../../helpers";

/**
 * Meetings, against the real database (PRD #40 §284-§296, §302).
 *
 * Calls the services the API routes call, so a pass here is a statement about
 * the running product.
 */

const ZONE = "Europe/Tirane";
const TITLE = "MTGTEST";
const meetings = new Set<string>();
const series = new Set<string>();
const tasks = new Set<string>();

async function cleanup() {
  const seriesIds = [...series];
  const seriesMeetings = seriesIds.length ? await prisma.meeting.findMany({ where: { seriesId: { in: seriesIds } }, select: { id: true } }) : [];
  const ids = [...new Set([...meetings, ...seriesMeetings.map((row) => row.id)])];
  const linked = await prisma.meetingActionItem.findMany({ where: { meetingId: { in: ids }, linkedTaskId: { not: null } }, select: { linkedTaskId: true } });
  const taskIds = [...new Set([...tasks, ...linked.map((row) => row.linkedTaskId!)])];
  const parents = [...ids, ...taskIds];

  const reminders = await prisma.calendarReminder.findMany({ where: { meetingId: { in: ids } }, select: { id: true } });
  await prisma.calendarReminderDelivery.deleteMany({ where: { reminderId: { in: reminders.map((row) => row.id) } } });
  await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingActionItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingDecision.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingMinutesSection.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: parents } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: parents } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: parents } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: parents } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threads.map((row) => row.id) } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threads.map((row) => row.id) } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: parents } } });
  await prisma.meeting.deleteMany({ where: { id: { in: ids } } });
  await prisma.meetingSeries.deleteMany({ where: { id: { in: seriesIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  meetings.clear();
  series.clear();
  tasks.clear();
}

afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const today = () => localDate(new Date(), ZONE);

async function make(context: UserContext, overrides: Record<string, unknown> = {}) {
  const input = createMeetingSchema.parse({
    title: `${TITLE} ${Math.random().toString(36).slice(2, 7)}`,
    meetingType: "INTERNAL",
    visibility: "PARTICIPANTS",
    date: addLocalDays(today(), 3),
    startTime: "10:00",
    endTime: "11:00",
    ...overrides,
  });
  const result = await createMeeting(context, input);
  meetings.add(result.meeting.id);
  if (result.meeting.series) series.add(result.meeting.series.id);
  return result;
}

function editInput(meeting: { title: string; meetingType: string; visibility: string; version: number; startsAt: string; endsAt: string; project: { id: string } | null }, overrides: Record<string, unknown> = {}) {
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return updateMeetingSchema.parse({
    title: meeting.title,
    meetingType: meeting.meetingType,
    visibility: meeting.visibility,
    date: localDate(new Date(meeting.startsAt), ZONE),
    startTime: time(meeting.startsAt),
    endTime: time(meeting.endsAt),
    projectId: meeting.project?.id ?? null,
    version: meeting.version,
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected ${code}`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  return error as AccessError;
}

async function heldMeeting(organizer: UserContext, participants: Array<{ memberId: string; role?: string }>, overrides: Record<string, unknown> = {}) {
  const { meeting } = await make(organizer, { participants: participants.map((row) => ({ role: "ATTENDEE", ...row })), ...overrides });
  await startMeeting(organizer, meeting.id);
  return meeting;
}

/* -------------------------------------------------------------------------- */

describe("validation (§169-§177, §238)", () => {
  it("accepts only an https online link", () => {
    const base = { title: "x", meetingType: "INTERNAL", visibility: "PARTICIPANTS", date: "2026-10-01", startTime: "10:00", endTime: "11:00" };
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "http://meet.example.com/a", "https://user:pw@meet.example.com", "not a url"]) {
      expect(createMeetingSchema.safeParse({ ...base, onlineUrl: bad }).success, bad).toBe(false);
    }
    expect(createMeetingSchema.safeParse({ ...base, onlineUrl: "https://meet.example.com/abc" }).success).toBe(true);
  });

  it("requires an end after the start, a title within 180 characters and a project for a project meeting", () => {
    const base = { title: "x", meetingType: "INTERNAL", visibility: "PARTICIPANTS", date: "2026-10-01", startTime: "10:00", endTime: "11:00" };
    expect(createMeetingSchema.safeParse({ ...base, endTime: "10:00" }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, title: "a".repeat(181) }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, visibility: "PROJECT" }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...base, participants: Array.from({ length: 251 }, (_, index) => ({ memberId: `m${index}` })) }).success).toBe(false);
  });
});

describe("create and read (§12, §18, §21, §89)", () => {
  it("makes the creator the organizer, invites participants, sets reminders and tells them once", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const { meeting } = await make(pm, {
      meetingType: "COORDINATION",
      visibility: "PROJECT",
      projectId: PROJECT.a,
      participants: [{ memberId: architect.membershipId, role: "SECRETARY" }],
      agendaTemplate: "project-coordination",
    });
    expect(meeting.organizer.memberId).toBe(pm.membershipId);
    expect(meeting.status).toBe("SCHEDULED");
    expect(meeting.participants.map((row) => [row.memberId, row.role])).toEqual([
      [pm.membershipId, "ORGANIZER"],
      [architect.membershipId, "SECRETARY"],
    ]);
    expect(meeting.agenda).toHaveLength(9);
    expect(meeting.reminders).toEqual([30]);
    expect(await prisma.calendarReminder.count({ where: { meetingId: meeting.id } })).toBe(2);

    const outbox = await prisma.notificationEventOutbox.findMany({ where: { entityId: meeting.id }, select: { eventType: true, payloadJson: true } });
    expect(outbox.map((row) => row.eventType)).toEqual(["MEETING_INVITED"]);
    expect((outbox[0].payloadJson as { memberIds: string[] }).memberIds).toEqual([architect.membershipId]);

    await dispatchNotifications(500);
    const delivered = await prisma.notification.findMany({ where: { entityId: meeting.id }, select: { recipientMemberId: true, eventType: true } });
    expect(delivered).toEqual([{ recipientMemberId: architect.membershipId, eventType: "MEETING_INVITED" }]);
    expect((await loadRecord(architect, "meeting", meeting.id))?.href).toBe(`/meetings/${meeting.id}`);
  });

  it("saves a draft that nobody else sees and nobody is told about, until it is scheduled", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { saveAsDraft: true, visibility: "COMPANY", participants: [{ memberId: engineer.membershipId }] });
    expect(meeting.status).toBe("DRAFT");
    await expectCode(getMeeting(engineer, meeting.id), "NOT_FOUND");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id } })).toBe(0);

    await scheduleMeeting(pm, meeting.id);
    expect((await getMeeting(engineer, meeting.id)).status).toBe("SCHEDULED");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_INVITED" } })).toBe(1);
  });

  it("lists upcoming, mine and past, and searches title and people but never minutes", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });
    const upcoming = await listMeetings(engineer, meetingListQuerySchema.parse({ section: "mine", q: meeting.title }));
    expect(upcoming.data.map((row) => row.id)).toEqual([meeting.id]);
    expect(upcoming.data[0].myRole).toBe("ATTENDEE");
    const past = await listMeetings(engineer, meetingListQuerySchema.parse({ section: "past", q: meeting.title }));
    expect(past.data).toHaveLength(0);

    const hits = await globalSearch(engineer, meeting.title);
    expect(hits.results.some((row) => row.entityType === "meeting" && row.entityId === meeting.id)).toBe(true);
    const outsider = await loginAs("FINANCE");
    expect((await globalSearch(outsider, meeting.title)).results.some((row) => row.entityId === meeting.id)).toBe(false);
  });

  it("finds a series once, at its next occurrence, rather than every week of it", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const { results } = await globalSearch(pm, "Riverside weekly coordination");
    const series = await prisma.meeting.findMany({ where: { seriesId: "meeting_series_riverside", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, select: { id: true } });
    const hits = results.filter((row) => row.entityType === "meeting" && row.title === "Riverside weekly coordination");
    expect(hits.map((row) => row.entityId)).toEqual([series[0].id]);
  });
});

describe("visibility (§80-§86, §291)", () => {
  it("shows a participants-only meeting to its people alone — in the list, the calendar, search and the registry", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const owner = await loginAs("OWNER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });

    const range = { from: instantFromLocal(today(), "00:00", ZONE), to: instantFromLocal(addLocalDays(today(), 7), "00:00", ZONE) };
    const seen = async (context: UserContext) => (await getCalendar(context, range, {})).events.some((row) => row.sourceType === "meeting" && row.sourceId === meeting.id);
    expect(await seen(pm)).toBe(true);
    expect(await seen(engineer)).toBe(true);
    // The architect shares the project, the Owner manages meetings: neither opens a participants-only meeting.
    expect(await seen(architect)).toBe(false);
    expect(await seen(owner)).toBe(false);
    await expectCode(getMeeting(architect, meeting.id), "NOT_FOUND");
    expect(await loadRecord(owner, "meeting", meeting.id)).toBeNull();

    // Seeing somebody busy never opens the meeting that makes them busy (§86).
    const conflicts = await findConflicts(architect, [engineer.membershipId], { startsAt: new Date(meeting.startsAt), endsAt: new Date(meeting.endsAt) }, { timezone: ZONE });
    expect(conflicts[0]?.busy.length).toBeGreaterThan(0);
    expect(JSON.stringify(conflicts)).not.toContain(meeting.title);
  });

  it("opens a project meeting to the project's people and nobody outside it, and hides the project from an invited outsider", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    // Inventory sees only its own projects; Group IT has no project access at all.
    const inventory = await loginAs("INVENTORY");
    const it = await loginAs("GROUP_IT");
    const { meeting } = await make(pm, { visibility: "PROJECT", projectId: PROJECT.a, meetingType: "PROJECT", participants: [{ memberId: it.membershipId }] });
    expect((await getMeeting(architect, meeting.id)).project?.id).toBe(PROJECT.a);
    await expectCode(getMeeting(inventory, meeting.id), "NOT_FOUND");
    const invited = await getMeeting(it, meeting.id);
    expect(invited.id).toBe(meeting.id);
    expect(invited.project).toBeNull();
  });

  it("opens a company meeting to every member with meeting access, read-only for a Viewer", async () => {
    const owner = await loginAs("OWNER");
    const viewer = await loginAs("VIEWER");
    const { meeting } = await make(owner, { visibility: "COMPANY", meetingType: "MANAGEMENT" });
    const read = await getMeeting(viewer, meeting.id);
    expect(read.capabilities.canEdit).toBe(false);
    expect(read.capabilities.canRespond).toBe(false);
    await expectCode(updateMeeting(viewer, meeting.id, editInput(read, { title: "Changed" })), "FORBIDDEN");
  });

  it("opens a department meeting to that department", async () => {
    const hr = await loginAs("HR");
    const finance = await loginAs("FINANCE");
    const department = await prisma.companyMember.findUniqueOrThrow({ where: { id: hr.membershipId }, select: { departmentId: true } });
    const { meeting } = await make(hr, { visibility: "DEPARTMENT", departmentId: department.departmentId, meetingType: "HR" });
    await expectCode(getMeeting(finance, meeting.id), "NOT_FOUND");
    await expectCode(make(finance, { visibility: "DEPARTMENT", departmentId: department.departmentId }), "FORBIDDEN");
  });
});

describe("company isolation (§231-§233, §292)", () => {
  it("refuses another company's participant, project and action owner, and another company's reader", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const ownerB = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expectCode(make(pm, { participants: [{ memberId: ownerB.membershipId }] }), "VALIDATION_ERROR");
    await expectCode(make(pm, { visibility: "PROJECT", projectId: PROJECT.companyB }), "VALIDATION_ERROR");

    const meeting = await heldMeeting(pm, []);
    await expectCode(createActionItem(pm, meeting.id, { title: "Cross company", description: null, ownerMemberId: ownerB.membershipId, createTask: false }), "VALIDATION_ERROR");
    await expectCode(addAgendaItem(pm, meeting.id, { title: "Item", description: null, presenterMemberId: ownerB.membershipId }), "VALIDATION_ERROR");
    await expectCode(addParticipants(pm, meeting.id, { participants: [{ memberId: ownerB.membershipId, role: "ATTENDEE", required: true }] }), "VALIDATION_ERROR");

    await expectCode(getMeeting(ownerB, meeting.id), "NOT_FOUND");
    await expectCode(respondToMeeting(ownerB, meeting.id, "ACCEPTED"), "NOT_FOUND");
    await expectCode(addMinutesSection(ownerB, meeting.id, { title: "x", body: "y" }), "NOT_FOUND");
    await expectCode(getMeeting(pm, "meeting_b_001"), "NOT_FOUND");
  });
});

describe("lifecycle (§99-§102, §178, §179, §285)", () => {
  it("moves SCHEDULED → IN_PROGRESS → COMPLETED on the organizer's word, and refuses everything else", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });

    await expectCode(completeMeeting(pm, meeting.id), "CONFLICT");
    await expectCode(startMeeting(engineer, meeting.id), "FORBIDDEN");
    const started = await startMeeting(pm, meeting.id);
    expect(started.meeting.status).toBe("IN_PROGRESS");
    expect(started.meeting.startedAt).not.toBeNull();
    await expectCode(startMeeting(pm, meeting.id), "CONFLICT");
    const completed = await completeMeeting(pm, meeting.id);
    expect(completed.meeting.status).toBe("COMPLETED");
    await expectCode(cancelMeeting(pm, meeting.id, { reason: null, scope: "THIS" }), "FORBIDDEN");

    const audit = await prisma.auditEvent.findMany({ where: { entityId: meeting.id }, select: { actionKey: true } });
    expect(audit.map((row) => row.actionKey)).toEqual(expect.arrayContaining(["MEETING_CREATED", "MEETING_STARTED", "MEETING_COMPLETED"]));
  });

  it("cancels with a reason, tells the participants, and never reactivates", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });
    await expectCode(cancelMeeting(engineer, meeting.id, { reason: null, scope: "THIS" }), "FORBIDDEN");
    const cancelled = await cancelMeeting(pm, meeting.id, { reason: "Client postponed", scope: "THIS" });
    expect(cancelled.meeting.status).toBe("CANCELLED");
    expect(cancelled.meeting.cancelReason).toBe("Client postponed");
    await expectCode(startMeeting(pm, meeting.id), "CONFLICT");
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_CANCELLED" } })).toBe(1);
  });

  it("refuses a stale edit with a conflict, and notifies only for a material change", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });

    const typo = await updateMeeting(pm, meeting.id, editInput(meeting, { description: "Fixed a typo" }));
    expect(typo.meeting.version).toBe(meeting.version + 1);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_UPDATED" } })).toBe(0);

    const stale = await expectCode(updateMeeting(pm, meeting.id, editInput(meeting, { title: "Stale" })), "CONFLICT");
    expect((stale.details as { code: string }).code).toBe("STALE_VERSION");

    await updateMeeting(pm, meeting.id, editInput(typo.meeting, { startTime: "14:00", endTime: "15:30" }));
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_UPDATED" } })).toBe(1);
  });

  it("duplicates type, people and agenda, but not minutes, decisions or actions", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const source = await heldMeeting(pm, [{ memberId: engineer.membershipId }], { agendaTemplate: "general" });
    await recordDecision(pm, source.id, { title: "Decided", description: null });
    await addMinutesSection(pm, source.id, { title: "Summary", body: "Text" });
    const copy = await duplicateMeeting(pm, source.id, { date: addLocalDays(today(), 10) });
    meetings.add(copy.meeting.id);
    expect(copy.meeting.status).toBe("SCHEDULED");
    expect(copy.meeting.participants.map((row) => row.memberId).sort()).toEqual([engineer.membershipId, pm.membershipId].sort());
    expect(copy.meeting.agenda.map((row) => row.title)).toEqual(source.agenda.map((row) => row.title));
    expect(copy.meeting.agenda.every((row) => row.status === "PENDING")).toBe(true);
    expect(copy.meeting.decisions).toHaveLength(0);
    expect(copy.meeting.minutes).toHaveLength(0);
  });
});

describe("participants, RSVP and attendance (§20-§23, §112-§114, §132-§136, §286)", () => {
  it("lets a participant reply for themselves only, tells the organizer, and keeps a decliner on the meeting", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }], visibility: "PROJECT", projectId: PROJECT.a });
    await expectCode(respondToMeeting(architect, meeting.id, "ACCEPTED"), "NOT_FOUND");
    const declined = await respondToMeeting(engineer, meeting.id, "DECLINED");
    expect(declined.myResponse).toBe("DECLINED");
    expect(declined.participants.some((row) => row.memberId === engineer.membershipId)).toBe(true);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_RESPONSE_CHANGED" } })).toBe(1);
    // A declined meeting does not make someone busy.
    expect(await findConflicts(pm, [engineer.membershipId], { startsAt: new Date(meeting.startsAt), endsAt: new Date(meeting.endsAt) }, { timezone: ZONE })).toEqual([]);
  });

  it("never removes the organizer; transfers the role explicitly and audits it", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });
    await expectCode(removeParticipant(pm, meeting.id, pm.membershipId), "CONFLICT");
    await expectCode(transferOrganizer(engineer, meeting.id, architect.membershipId), "FORBIDDEN");
    const transferred = await transferOrganizer(pm, meeting.id, architect.membershipId);
    expect(transferred.organizer.memberId).toBe(architect.membershipId);
    expect(transferred.participants.find((row) => row.memberId === pm.membershipId)?.role).toBe("ATTENDEE");
    expect(await prisma.auditEvent.count({ where: { entityId: meeting.id, actionKey: "MEETING_ORGANIZER_CHANGED" } })).toBe(1);
    // The former organizer can no longer change who is on it.
    await expectCode(removeParticipant(pm, meeting.id, engineer.membershipId), "FORBIDDEN");
    const removed = await removeParticipant(architect, meeting.id, engineer.membershipId);
    expect(removed.participants.some((row) => row.memberId === engineer.membershipId)).toBe(false);
    expect(await prisma.calendarReminder.count({ where: { meetingId: meeting.id, memberId: engineer.membershipId } })).toBe(0);
  });

  it("records attendance only once the meeting is under way, by whoever keeps the record", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const { meeting } = await make(pm, { participants: [{ memberId: engineer.membershipId }] });
    await expectCode(updateParticipant(pm, meeting.id, engineer.membershipId, { attendance: "PRESENT" }), "FORBIDDEN");
    await startMeeting(pm, meeting.id);
    await expectCode(updateParticipant(engineer, meeting.id, engineer.membershipId, { attendance: "PRESENT" }), "FORBIDDEN");
    const marked = await updateParticipant(pm, meeting.id, engineer.membershipId, { attendance: "PRESENT" });
    expect(marked.participants.find((row) => row.memberId === engineer.membershipId)?.attendance).toBe("PRESENT");
  });
});

describe("agenda (§34-§40, §287)", () => {
  it("adds, reorders against the full set only, and marks items once the meeting has started", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const { meeting } = await make(pm);
    await addAgendaItem(pm, meeting.id, { title: "One", description: null });
    await addAgendaItem(pm, meeting.id, { title: "Two", description: null, plannedMinutes: 10 });
    const withTemplate = await applyAgendaTemplate(pm, meeting.id, "hse");
    const ids = withTemplate.agenda.map((row) => row.id);
    await expectCode(reorderAgenda(pm, meeting.id, ids.slice(1)), "CONFLICT");
    const reordered = await reorderAgenda(pm, meeting.id, [...ids].reverse());
    expect(reordered.agenda.map((row) => row.id)).toEqual([...ids].reverse());
    await expectCode(updateAgendaItem(pm, meeting.id, ids[0], { status: "DISCUSSED" }), "CONFLICT");
    await startMeeting(pm, meeting.id);
    expect((await updateAgendaItem(pm, meeting.id, ids[0], { status: "DEFERRED" })).agenda.find((row) => row.id === ids[0])?.status).toBe("DEFERRED");
  });
});

describe("minutes (§42-§49, §235, §236, §288)", () => {
  it("lets the secretary write a draft, locks it when final, and reopens only with the reopen permission", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const architect = await loginAs("ARCHITECT");
    const owner = await loginAs("OWNER");
    const meeting = await heldMeeting(pm, [{ memberId: engineer.membershipId, role: "SECRETARY" }, { memberId: architect.membershipId }], { visibility: "COMPANY" });

    await expectCode(addMinutesSection(architect, meeting.id, { title: "Mine", body: "No pen" }), "FORBIDDEN");
    const drafted = await addMinutesSection(engineer, meeting.id, { title: "Summary", body: "Agreed the pour." });
    const sectionId = drafted.minutes[0].id;
    await expectCode(finalizeMinutes(pm, meeting.id), "CONFLICT");

    await completeMeeting(pm, meeting.id);
    await expectCode(finalizeMinutes(architect, meeting.id), "FORBIDDEN");
    const final = await finalizeMinutes(engineer, meeting.id);
    expect(final.minutesStatus).toBe("FINAL");
    expect(final.minutesFinalizedAt).not.toBeNull();

    await expectCode(updateMinutesSection(engineer, meeting.id, sectionId, { body: "Silent edit" }), "CONFLICT");
    await expectCode(recordDecision(pm, meeting.id, { title: "Late decision", description: null }), "CONFLICT");
    await expectCode(reopenMinutes(pm, meeting.id, "Correct a figure"), "FORBIDDEN");

    const reopened = await reopenMinutes(owner, meeting.id, "Correct a figure");
    expect(reopened.minutesStatus).toBe("DRAFT");
    await updateMinutesSection(engineer, meeting.id, sectionId, { body: "Agreed the pour on Tuesday." });
    expect((await finalizeMinutes(engineer, meeting.id)).minutesStatus).toBe("FINAL");

    const audit = await prisma.auditEvent.findMany({ where: { entityId: meeting.id, actionKey: { in: ["MEETING_MINUTES_FINALIZED", "MEETING_MINUTES_REOPENED"] } }, select: { actionKey: true, metadataJson: true } });
    expect(audit.map((row) => row.actionKey).sort()).toEqual(["MEETING_MINUTES_FINALIZED", "MEETING_MINUTES_FINALIZED", "MEETING_MINUTES_REOPENED"]);
    // Ids and counts, never the text of the minutes (§182).
    expect(JSON.stringify(audit)).not.toContain("Agreed the pour");

    await dispatchNotifications(500);
    const told = await prisma.notification.findMany({ where: { entityId: meeting.id, eventType: "MEETING_MINUTES_FINALIZED" }, select: { recipientMemberId: true } });
    expect(new Set(told.map((row) => row.recipientMemberId))).toEqual(new Set([pm.membershipId, architect.membershipId]));
  });
});

describe("decisions (§50-§52, §289)", () => {
  it("numbers decisions per meeting and never reuses a number", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const meeting = await heldMeeting(pm, []);
    await recordDecision(pm, meeting.id, { title: "Use option B", description: null });
    const second = await recordDecision(pm, meeting.id, { title: "Hold the pour", description: "Until rework" });
    expect(second.decisions.map((row) => row.label)).toEqual(["D-01", "D-02"]);
    await archiveDecision(pm, meeting.id, second.decisions[1].id);
    const third = await recordDecision(pm, meeting.id, { title: "Approve supplier X", description: null });
    expect(third.decisions.map((row) => row.label)).toEqual(["D-01", "D-03"]);
    expect(third.actions).toHaveLength(0);
  });
});

describe("action items and tasks (§53-§62, §233, §290, §298)", () => {
  it("converts an action to one canonical task, refuses a second, and finishes the action when the task is done", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const meeting = await heldMeeting(pm, [{ memberId: engineer.membershipId }], { visibility: "PROJECT", projectId: PROJECT.a });
    const withAction = await createActionItem(pm, meeting.id, {
      title: "Confirm crane booking",
      description: null,
      ownerMemberId: engineer.membershipId,
      dueDate: addLocalDays(today(), 5),
      createTask: true,
    });
    const action = withAction.actions[0];
    expect(action.task).not.toBeNull();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: action.task!.id } });
    tasks.add(task.id);
    expect(task).toMatchObject({ assigneeMemberId: engineer.membershipId, projectId: PROJECT.a, entityType: "meeting", entityId: meeting.id, module: "meetings" });
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe(addLocalDays(today(), 5));
    // The task's own assignment notice is the one the owner gets (§62).
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_ACTION_ASSIGNED" } })).toBe(0);

    // AUD-10 §5, CW-07 (deliberate change): retrying a finished conversion is
    // answered with the same canonical task, not CONFLICT and not a second task.
    const retry = await convertActionToTask(pm, meeting.id, action.id);
    expect(retry).toMatchObject({ taskId: task.id, created: false });
    expect(retry.meeting.actions[0].task?.id).toBe(task.id);
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meeting.id } })).toBe(1);
    await expectCode(updateActionItem(pm, meeting.id, action.id, { status: "DONE" }), "CONFLICT");

    await completeTask(engineer, task.id, await taskVersion(task.id));
    const done = (await getMeeting(pm, meeting.id)).actions[0];
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_ACTION_COMPLETED" } })).toBe(1);

    await reopenTask(await loginAs("OWNER"), task.id, await taskVersion(task.id));
    expect((await getMeeting(pm, meeting.id)).actions[0].status).toBe("OPEN");
  });

  it("refuses a task hand-off to somebody the caller may not assign work to, and keeps the action", async () => {
    const architect = await loginAs("ARCHITECT");
    const sales = await loginAs("SALES");
    const hse = await loginAs("HSE");
    // The architect runs a project meeting but may only assign project work to the project team, which Sales is not on.
    const meeting = await heldMeeting(architect, [{ memberId: hse.membershipId }], { visibility: "PROJECT", projectId: PROJECT.a });
    // AUD-10 §7 (deliberate change): the action commits and the answer says the
    // task did not, with the task service's reason — not an error that reads as
    // "nothing was saved". The owner hears about the action itself, once.
    const outcome = await createActionItem(architect, meeting.id, { title: "Check the site", description: null, ownerMemberId: sales.membershipId, createTask: true });
    expect(outcome.taskHandoff).toMatchObject({ created: false });
    expect(["FORBIDDEN", "VALIDATION_ERROR"]).toContain((outcome.taskHandoff as { code: string }).code);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_ACTION_ASSIGNED" } })).toBe(1);
    const after = await getMeeting(architect, meeting.id);
    expect(after.actions).toHaveLength(1);
    expect(after.actions[0].task).toBeNull();
    expect(await prisma.task.count({ where: { entityType: "meeting", entityId: meeting.id } })).toBe(0);
  });

  it("lets the owner move their own action along, lists it under their actions, and flags it when overdue", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const meeting = await heldMeeting(pm, [{ memberId: engineer.membershipId }]);
    const created = await createActionItem(pm, meeting.id, { title: "Send the survey", description: null, ownerMemberId: engineer.membershipId, dueDate: addLocalDays(today(), -3), createTask: false });
    const actionId = created.actions[0].id;
    expect(created.actions[0].overdue).toBe(true);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_ACTION_ASSIGNED" } })).toBe(1);

    const mine = await listActionItems(engineer, actionListQuerySchema.parse({}));
    expect(mine.data.some((row) => row.id === actionId)).toBe(true);

    const condition = attentionConditionDefinitions().find((row) => row.key === "MEETING_ACTION_OVERDUE")!;
    const candidates = await condition.collect("company_demo_a", new Date());
    expect(candidates.some((row) => row.entityId === meeting.id && row.recipients.includes(engineer.membershipId))).toBe(true);

    await expectCode(updateActionItem(engineer, meeting.id, actionId, { title: "Rename" }), "FORBIDDEN");
    await updateActionItem(engineer, meeting.id, actionId, { status: "DONE" });
    expect(await condition.holds("company_demo_a", "meeting", meeting.id, new Date())).toBe(false);
  });
});

describe("series (§222-§230, §296)", () => {
  it("creates a bounded run of real meetings, announces the series once, and changes this-and-later together", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const result = await make(pm, {
      participants: [{ memberId: engineer.membershipId }],
      recurrence: { frequency: "WEEKLY", interval: 1, count: 5 },
      agendaTemplate: "general",
    });
    expect(result.occurrences).toBe(5);
    const seriesId = result.meeting.series!.id;
    const occurrences = await prisma.meeting.findMany({ where: { seriesId }, orderBy: { occurrenceIndex: "asc" } });
    expect(occurrences.map((row) => row.occurrenceIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(await prisma.meetingAgendaItem.count({ where: { meetingId: { in: occurrences.map((row) => row.id) } } })).toBe(20);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: { in: occurrences.map((row) => row.id) }, eventType: "MEETING_INVITED" } })).toBe(1);

    // Minutes belong to one occurrence (§222).
    const second = await getMeeting(pm, occurrences[1].id);
    await startMeeting(pm, second.id);
    await addMinutesSection(pm, second.id, { title: "Summary", body: "Week two" });
    expect((await getMeeting(pm, occurrences[2].id)).minutes).toHaveLength(0);

    // This and later: the time moves on occurrences 2-4 only; occurrence 1, in progress, keeps its record.
    const third = await getMeeting(pm, occurrences[2].id);
    await updateMeeting(pm, third.id, editInput(third, { startTime: "15:00", endTime: "16:00", scope: "FUTURE" }));
    const moved = await prisma.meeting.findMany({ where: { seriesId }, orderBy: { occurrenceIndex: "asc" }, select: { startsAt: true } });
    const clock = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    expect(moved.map((row) => clock(row.startsAt))).toEqual(["10:00", "10:00", "15:00", "15:00", "15:00"]);
    await expectCode(updateMeeting(pm, third.id, editInput(await getMeeting(pm, third.id), { date: addLocalDays(today(), 30), scope: "FUTURE" })), "VALIDATION_ERROR");

    // Cancel this and later: the series stops, earlier meetings stay.
    await cancelMeeting(pm, occurrences[3].id, { reason: null, scope: "FUTURE" });
    const statuses = await prisma.meeting.findMany({ where: { seriesId }, orderBy: { occurrenceIndex: "asc" }, select: { status: true } });
    expect(statuses.map((row) => row.status)).toEqual(["SCHEDULED", "IN_PROGRESS", "SCHEDULED", "CANCELLED", "CANCELLED"]);
    expect((await prisma.meetingSeries.findUniqueOrThrow({ where: { id: seriesId } })).cancelledAt).not.toBeNull();
  });

  it("tops an open series up to the horizon, copying people and reminders, idempotently", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const result = await make(pm, { date: today(), startTime: "08:00", endTime: "08:30", participants: [{ memberId: engineer.membershipId }], recurrence: { frequency: "DAILY", interval: 1 } });
    const seriesId = result.meeting.series!.id;
    const initial = await prisma.meeting.count({ where: { seriesId } });
    expect(initial).toBeGreaterThan(80);
    expect(initial).toBeLessThanOrEqual(100);

    // Pretend the series was generated a month ago with a shorter horizon.
    const last = await prisma.meeting.findFirstOrThrow({ where: { seriesId }, orderBy: { occurrenceIndex: "desc" } });
    const cut = last.occurrenceIndex! - 30;
    const drop = await prisma.meeting.findMany({ where: { seriesId, occurrenceIndex: { gt: cut } }, select: { id: true } });
    const dropIds = drop.map((row) => row.id);
    await prisma.calendarReminder.deleteMany({ where: { meetingId: { in: dropIds } } });
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: { in: dropIds } } });
    await prisma.meetingAgendaItem.deleteMany({ where: { meetingId: { in: dropIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: dropIds } } });
    await prisma.meetingSeries.update({ where: { id: seriesId }, data: { generatedUntil: new Date(Date.now() + 40 * 86_400_000) } });

    const first = await extendMeetingSeries(new Date());
    expect(first.created).toBeGreaterThanOrEqual(30);
    const afterFirst = await prisma.meeting.count({ where: { seriesId } });
    const second = await extendMeetingSeries(new Date());
    expect(await prisma.meeting.count({ where: { seriesId } })).toBe(afterFirst);
    expect(second.created).toBe(0);

    const newest = await prisma.meeting.findFirstOrThrow({ where: { seriesId }, orderBy: { occurrenceIndex: "desc" }, include: { participants: true, reminders: true } });
    expect(newest.participants.map((row) => row.memberId).sort()).toEqual([engineer.membershipId, pm.membershipId].sort());
    expect(newest.reminders).toHaveLength(2);
    expect(newest.startsAt.getTime()).toBeLessThanOrEqual(Date.now() + 91 * 86_400_000);
  });
});

describe("reminders (§74, §187, §188)", () => {
  it("fires a meeting reminder through the calendar's reminder job, once", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const engineer = await loginAs("ENGINEER");
    const soon = new Date(Date.now() + 20 * 60_000);
    const clock = (date: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    const date = localDate(soon, ZONE);
    const end = new Date(soon.getTime() + 30 * 60_000);
    if (localDate(end, ZONE) !== date) return; // Too close to midnight for a same-day meeting.
    const { meeting } = await make(pm, { date, startTime: clock(soon), endTime: clock(end), participants: [{ memberId: engineer.membershipId }] });
    const firstRun = await runCalendarReminders(new Date());
    expect(firstRun.fired).toBeGreaterThanOrEqual(2);
    const secondRun = await runCalendarReminders(new Date());
    expect(await prisma.calendarReminderDelivery.count({ where: { reminder: { meetingId: meeting.id } } })).toBe(2);
    expect(secondRun.skipped + secondRun.fired).toBeGreaterThanOrEqual(0);
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: meeting.id, eventType: "MEETING_REMINDER" } })).toBe(2);
  });
});
