import { Prisma, type CalendarParticipantStatus } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { canAccessProject } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { findConflicts } from "./calendar.availability";
import { describeWhen } from "./calendar.format";
import { parseRecurrence, recurrenceProblem, serializeRecurrence, seriesEndsAt } from "./calendar.recurrence";
import type { CreateEventInput, UpdateEventInput } from "./calendar.schema";
import { REMINDERS_MAX } from "./calendar.schema";
import { addLocalDays, instantFromLocal, isValidTimeZone, startOfLocalDay } from "./calendar.time";
import type { CalendarEventDetailDTO, ConflictDTO, RecurrenceInput } from "./calendar.types";
import { canArchiveEvent, canCreateEvent, canEditEvent, isCompanyWide, readableEventWhere } from "./calendar.visibility";

/**
 * Calendar-owned events (PRD #39 §36-§42, §68-§70, §147-§150).
 *
 * The only records the calendar keeps. Everything it writes is checked here,
 * on the server, whatever the drawer offered: the type and visibility against
 * the caller's permissions, the project against their scope, every participant
 * against the company, and the times against the company's zone.
 */

const MODULE = "calendar" as const;
const ENTITY = "CalendarEvent";
const DEFAULT_TIMED_MINUTES = 60;

export type CalendarSettings = {
  timezone: string;
  workingDayStart: string;
  workingDayEnd: string;
  workingDays: number[];
  defaultView: string;
};

export async function calendarSettings(companyId: string): Promise<CalendarSettings> {
  const row = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { timezone: true, workingDayStart: true, workingDayEnd: true, workingDays: true, defaultCalendarView: true },
  });
  const timezone = row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : "UTC";
  return {
    timezone,
    workingDayStart: row?.workingDayStart ?? "08:00",
    workingDayEnd: row?.workingDayEnd ?? "17:00",
    workingDays: row?.workingDays?.length ? row.workingDays : [1, 2, 3, 4, 5],
    defaultView: row?.defaultCalendarView ?? "week",
  };
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

function toInstants(
  input: Pick<CreateEventInput, "allDay" | "startDate" | "endDate" | "startTime" | "endTime">,
  zone: string,
): { startsAt: Date; endsAt: Date } {
  const endDate = input.endDate ?? input.startDate;
  if (input.allDay) {
    return { startsAt: startOfLocalDay(input.startDate, zone), endsAt: startOfLocalDay(addLocalDays(endDate, 1), zone) };
  }
  const startsAt = instantFromLocal(input.startDate, input.startTime!, zone);
  const endsAt = input.endTime
    ? instantFromLocal(endDate, input.endTime, zone)
    : new Date(startsAt.getTime() + DEFAULT_TIMED_MINUTES * 60_000);
  // A wall-clock end inside the skipped spring hour can land before its start.
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new AccessError("VALIDATION_ERROR", "The event cannot end before it starts.", { endDate: ["The event cannot end before it starts."] });
  }
  return { startsAt, endsAt };
}

function recurrenceFields(
  recurrence: RecurrenceInput | null | undefined,
  series: { startsAt: Date; endsAt: Date; allDay: boolean; timezone: string },
  startDate: string,
): { recurrenceRule: string | null; recurrenceEndsAt: Date | null } {
  if (!recurrence) return { recurrenceRule: null, recurrenceEndsAt: null };
  const problem = recurrenceProblem(recurrence, startDate);
  if (problem) throw new AccessError("VALIDATION_ERROR", problem, { recurrence: [problem] });
  return { recurrenceRule: serializeRecurrence(recurrence), recurrenceEndsAt: seriesEndsAt(series, recurrence) };
}

/** Active members of this company, or a validation error naming none of the others. */
async function requireMembers(context: UserContext, memberIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];
  const rows = await prisma.companyMember.findMany({
    where: { id: { in: unique }, companyId: context.companyId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (rows.length !== unique.length) {
    // The same answer for another company's member and for a typo, so the
    // endpoint cannot be used to discover who exists elsewhere.
    throw new AccessError("VALIDATION_ERROR", "Some of these people cannot be added.", {
      participantIds: ["Some of these people cannot be added."],
      code: "PARTICIPANT_NOT_ALLOWED",
    });
  }
  return unique;
}

async function requireProject(context: UserContext, projectId: string | null | undefined): Promise<string | null> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: context.companyId },
    select: { id: true, archivedAt: true, status: true },
  });
  if (!project || !canAccessModule(context, "projects") || !(await canAccessProject(context, projectId))) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", { projectId: ["That project does not exist."] });
  }
  if (project.archivedAt || project.status === "ARCHIVED") {
    throw new AccessError("VALIDATION_ERROR", "That project is archived.", { projectId: ["That project is archived."] });
  }
  return project.id;
}

async function requireDepartment(context: UserContext, departmentId: string | null | undefined): Promise<string | null> {
  if (!departmentId) return null;
  const department = await prisma.department.findFirst({
    where: { id: departmentId, companyId: context.companyId, archivedAt: null },
    select: { id: true },
  });
  if (!department) {
    throw new AccessError("VALIDATION_ERROR", "That department does not exist.", { departmentId: ["That department does not exist."] });
  }
  return department.id;
}

function assertCreate(context: UserContext, input: Pick<CreateEventInput, "eventType" | "visibility" | "departmentId">) {
  const check = canCreateEvent(context, input);
  if (!check.ok) throw new AccessError("FORBIDDEN", check.reason);
}

/** A private event names nobody in the audit trail; a published one may. */
function auditLabel(event: { visibility: string; title: string }): string | undefined {
  return event.visibility === "PRIVATE" || event.visibility === "SELECTED_MEMBERS" ? undefined : event.title;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const DETAIL_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  createdBy: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  participants: {
    orderBy: { createdAt: "asc" },
    select: { memberId: true, status: true, member: { select: { user: { select: { firstName: true, lastName: true } } } } },
  },
} satisfies Prisma.CalendarEventInclude;

type DetailRow = Prisma.CalendarEventGetPayload<{ include: typeof DETAIL_INCLUDE }>;

async function detailDTO(context: UserContext, row: DetailRow): Promise<CalendarEventDetailDTO> {
  const reminders = await prisma.calendarReminder.findMany({
    where: { eventId: row.id, memberId: context.membershipId, companyId: context.companyId },
    orderBy: { minutesBefore: "asc" },
    select: { id: true, minutesBefore: true, channel: true },
  });
  const mine = row.participants.find((participant) => participant.memberId === context.membershipId);
  const editable = canEditEvent(context, row);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    eventType: row.eventType,
    visibility: row.visibility,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    allDay: row.allDay,
    timezone: row.timezone,
    recurrence: row.recurrenceRule ? parseRecurrence(row.recurrenceRule) : null,
    // A project the reader cannot open is not named to them, even on an event
    // they were invited to (PRD #39 §46).
    project: row.project && (await projectReadable(context, row.project.id)) ? row.project : null,
    department: row.department,
    createdBy: { memberId: row.createdBy.id, fullName: `${row.createdBy.user.firstName} ${row.createdBy.user.lastName}` },
    participants: row.participants.map((participant) => ({
      memberId: participant.memberId,
      fullName: `${participant.member.user.firstName} ${participant.member.user.lastName}`,
      status: participant.status,
    })),
    reminders,
    archived: row.archivedAt !== null,
    capabilities: {
      canEdit: editable,
      canArchive: canArchiveEvent(context, row),
      canRespond: Boolean(mine) && row.archivedAt === null,
      canManageParticipants: editable,
    },
    myStatus: mine?.status ?? null,
    href: `/calendar?event=${row.id}`,
  };
}

async function projectReadable(context: UserContext, projectId: string): Promise<boolean> {
  return canAccessModule(context, "projects") && can(context, "project.view") && canAccessProject(context, projectId);
}

async function requireReadable(context: UserContext, eventId: string, options: { includeArchived?: boolean } = {}) {
  assertModule(context, MODULE);
  assertPermission(context, "calendar.view");
  const row = await prisma.calendarEvent.findFirst({
    where: { AND: [readableEventWhere(context), { id: eventId }, options.includeArchived ? {} : { archivedAt: null }] },
    include: DETAIL_INCLUDE,
  });
  if (!row) throw new AccessError("NOT_FOUND");
  return row;
}

export async function getEvent(context: UserContext, eventId: string): Promise<CalendarEventDetailDTO> {
  return detailDTO(context, await requireReadable(context, eventId, { includeArchived: true }));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export type EventWriteResult = { event: CalendarEventDetailDTO; conflicts: ConflictDTO[] };

export async function createEvent(context: UserContext, input: CreateEventInput): Promise<EventWriteResult> {
  assertModule(context, MODULE);
  assertPermission(context, "calendar.event.create");
  assertCreate(context, input);

  const settings = await calendarSettings(context.companyId);
  const zone = settings.timezone;
  const { startsAt, endsAt } = toInstants(input, zone);
  const projectId = await requireProject(context, input.projectId);
  const departmentId = await requireDepartment(context, input.departmentId);
  const participantIds = (await requireMembers(context, input.participantIds)).filter((id) => id !== context.membershipId);
  if (input.reminders.length > REMINDERS_MAX) throw new AccessError("VALIDATION_ERROR", `At most ${REMINDERS_MAX} reminders.`);
  if (input.reminders.length > 0 && !can(context, "calendar.reminder.manage")) throw new AccessError("FORBIDDEN");
  const recurrence = recurrenceFields(input.recurrence as RecurrenceInput | null | undefined, { startsAt, endsAt, allDay: input.allDay, timezone: zone }, input.startDate);

  const id = await prisma.$transaction(async (tx) => {
    const event = await tx.calendarEvent.create({
      data: {
        companyId: context.companyId,
        createdByMemberId: context.membershipId,
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        eventType: input.eventType,
        visibility: input.visibility,
        startsAt,
        endsAt,
        allDay: input.allDay,
        timezone: zone,
        projectId: input.visibility === "PROJECT" || projectId ? projectId : null,
        departmentId,
        ...recurrence,
        participants: {
          create: participantIds.map((memberId) => ({ memberId, companyId: context.companyId, addedByMemberId: context.membershipId })),
        },
        reminders: {
          create: dedupeReminders(input.reminders).map((reminder) => ({
            companyId: context.companyId,
            memberId: context.membershipId,
            minutesBefore: reminder.minutesBefore,
            channel: reminder.channel,
          })),
        },
      },
      select: { id: true, title: true, visibility: true, eventType: true },
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CALENDAR_EVENT_CREATED,
        entity: { type: ENTITY, id: event.id, label: auditLabel(event) },
        projectId,
        metadata: {
          eventType: input.eventType,
          visibility: input.visibility,
          allDay: input.allDay,
          recurring: Boolean(recurrence.recurrenceRule),
          projectId,
          departmentId,
          participantCount: participantIds.length,
        },
      },
      { tx },
    );

    // Activity only where an event is news to other people (PRD #39 §113).
    if (input.visibility === "COMPANY" || input.visibility === "PROJECT") {
      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: event.id,
        action: "CALENDAR_EVENT_CREATED",
        message: `scheduled ${event.title}`,
      });
    }

    const when = describeWhen(startsAt, endsAt, input.allDay, zone);
    if (participantIds.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_PARTICIPANT_ADDED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: event.id,
        actorMemberId: context.membershipId,
        projectId,
        payload: { memberIds: participantIds, actorName: context.fullName, when },
      });
    }
    if (input.eventType === "COMPANY_HOLIDAY" || input.eventType === "OFFICE_CLOSURE") {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_EVENT_CREATED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: event.id,
        actorMemberId: context.membershipId,
        payload: { announceToCompany: true, when },
      });
    }
    return event.id;
  });

  const conflicts = await findConflicts(context, participantIds, { startsAt, endsAt }, { excludeEventId: id, timezone: zone });
  return { event: await getEvent(context, id), conflicts };
}

export async function updateEvent(context: UserContext, eventId: string, input: UpdateEventInput): Promise<EventWriteResult> {
  const existing = await requireReadable(context, eventId);
  if (!canEditEvent(context, existing)) throw new AccessError("FORBIDDEN", "You cannot change this event.");
  // Changing type or visibility is creating it anew, as far as permission goes.
  assertCreate(context, input);
  // Moving a manager's company event into someone's private calendar is not an edit anybody holds.
  if (isCompanyWide(existing) && !isCompanyWide(input) && existing.createdByMemberId !== context.membershipId) {
    throw new AccessError("FORBIDDEN", "Only the person who created this event can make it private.");
  }

  const zone = existing.timezone;
  const { startsAt, endsAt } = toInstants(input, zone);
  const projectId = await requireProject(context, input.projectId);
  const departmentId = await requireDepartment(context, input.departmentId);
  const participantIds =
    input.participantIds === undefined
      ? undefined
      : (await requireMembers(context, input.participantIds)).filter((id) => id !== existing.createdByMemberId);
  const recurrence = recurrenceFields(input.recurrence as RecurrenceInput | null | undefined, { startsAt, endsAt, allDay: input.allDay, timezone: zone }, input.startDate);

  const visibilityChanged =
    existing.visibility !== input.visibility || existing.projectId !== projectId || existing.departmentId !== departmentId;

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({
      where: { id: eventId },
      data: {
        title: input.title,
        description: input.description || null,
        location: input.location || null,
        eventType: input.eventType,
        visibility: input.visibility,
        startsAt,
        endsAt,
        allDay: input.allDay,
        projectId,
        departmentId,
        ...recurrence,
        updatedByMemberId: context.membershipId,
      },
    });

    let added: string[] = [];
    if (participantIds) {
      const before = existing.participants.map((row) => row.memberId);
      added = participantIds.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !participantIds.includes(id));
      if (removed.length > 0) {
        await tx.calendarEventParticipant.deleteMany({ where: { eventId, memberId: { in: removed } } });
        await tx.calendarReminder.deleteMany({ where: { eventId, memberId: { in: removed } } });
        for (const memberId of removed) {
          await recordUserAction(context, { actionKey: AuditAction.CALENDAR_PARTICIPANT_REMOVED, entity: { type: ENTITY, id: eventId }, metadata: { memberId } }, { tx });
        }
      }
      if (added.length > 0) {
        await tx.calendarEventParticipant.createMany({
          data: added.map((memberId) => ({ eventId, memberId, companyId: context.companyId, addedByMemberId: context.membershipId })),
          skipDuplicates: true,
        });
        await recordUserAction(context, { actionKey: AuditAction.CALENDAR_PARTICIPANT_ADDED, entity: { type: ENTITY, id: eventId }, metadata: { memberIds: added, count: added.length } }, { tx });
      }
    }

    if (input.reminders) await replaceMyReminders(tx, context, eventId, input.reminders);

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CALENDAR_EVENT_UPDATED,
        entity: { type: ENTITY, id: eventId, label: auditLabel(input) },
        projectId,
        metadata: { eventType: input.eventType, allDay: input.allDay, recurring: Boolean(recurrence.recurrenceRule), projectId, departmentId },
      },
      { tx },
    );
    if (visibilityChanged) {
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.CALENDAR_VISIBILITY_CHANGED,
          entity: { type: ENTITY, id: eventId },
          metadata: { from: existing.visibility, to: input.visibility, projectId, departmentId },
        },
        { tx },
      );
    }

    const when = describeWhen(startsAt, endsAt, input.allDay, zone);
    const informed = (participantIds ?? existing.participants.map((row) => row.memberId)).filter((id) => !added.includes(id));
    if (informed.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_EVENT_UPDATED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: eventId,
        actorMemberId: context.membershipId,
        projectId,
        payload: { participantIds: informed, when },
      });
    }
    if (added.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_PARTICIPANT_ADDED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: eventId,
        actorMemberId: context.membershipId,
        projectId,
        payload: { memberIds: added, actorName: context.fullName, when },
      });
    }
  });

  const people = participantIds ?? existing.participants.map((row) => row.memberId);
  const conflicts = await findConflicts(context, people, { startsAt, endsAt }, { excludeEventId: eventId, timezone: zone });
  return { event: await getEvent(context, eventId), conflicts };
}

/**
 * Drag and resize (PRD #39 §82-§84). A single, non-recurring event only: moving
 * one occurrence of a series would silently move all of them.
 */
export async function moveEvent(
  context: UserContext,
  eventId: string,
  input: { startsAt: Date; endsAt?: Date },
): Promise<EventWriteResult> {
  const existing = await requireReadable(context, eventId);
  if (!canEditEvent(context, existing)) throw new AccessError("FORBIDDEN", "You cannot change this event.");
  if (existing.recurrenceRule) throw new AccessError("CONFLICT", "Edit a repeating event from its details, where the change applies to the whole series.");
  if (existing.allDay) throw new AccessError("CONFLICT", "All-day events are moved from their details.");

  const duration = (existing.endsAt ?? existing.startsAt).getTime() - existing.startsAt.getTime();
  const startsAt = input.startsAt;
  const endsAt = input.endsAt ?? new Date(startsAt.getTime() + duration);
  if (endsAt.getTime() < startsAt.getTime()) throw new AccessError("VALIDATION_ERROR", "The event cannot end before it starts.");
  if (Math.abs(startsAt.getTime() - existing.startsAt.getTime()) > 400 * 86_400_000) {
    throw new AccessError("VALIDATION_ERROR", "Move the event from its details for a change that large.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.calendarEvent.update({ where: { id: eventId }, data: { startsAt, endsAt, updatedByMemberId: context.membershipId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CALENDAR_EVENT_UPDATED,
        entity: { type: ENTITY, id: eventId, label: auditLabel(existing) },
        projectId: existing.projectId,
        metadata: { eventType: existing.eventType, allDay: false, recurring: false, projectId: existing.projectId, departmentId: existing.departmentId, moved: true },
      },
      { tx },
    );
    const participantIds = existing.participants.map((row) => row.memberId);
    if (participantIds.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_EVENT_UPDATED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: eventId,
        actorMemberId: context.membershipId,
        payload: { participantIds, when: describeWhen(startsAt, endsAt, false, existing.timezone) },
      });
    }
  });

  const conflicts = await findConflicts(context, existing.participants.map((row) => row.memberId), { startsAt, endsAt }, { excludeEventId: eventId, timezone: existing.timezone });
  return { event: await getEvent(context, eventId), conflicts };
}

/** DELETE means archive (PRD #39 §68, §114). */
export async function archiveEvent(context: UserContext, eventId: string): Promise<void> {
  const existing = await requireReadable(context, eventId);
  if (!canArchiveEvent(context, existing)) throw new AccessError("FORBIDDEN", "You cannot archive this event.");

  await prisma.$transaction(async (tx) => {
    const result = await tx.calendarEvent.updateMany({
      where: { id: eventId, archivedAt: null },
      data: { archivedAt: new Date(), archivedByMemberId: context.membershipId },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "This event is already archived.");

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CALENDAR_EVENT_ARCHIVED,
        entity: { type: ENTITY, id: eventId, label: auditLabel(existing) },
        projectId: existing.projectId,
        metadata: { eventType: existing.eventType, visibility: existing.visibility },
      },
      { tx },
    );
    const participantIds = existing.participants.map((row) => row.memberId);
    if (participantIds.length > 0) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_EVENT_CANCELLED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: eventId,
        actorMemberId: context.membershipId,
        payload: { participantIds, when: describeWhen(existing.startsAt, existing.endsAt, existing.allDay, existing.timezone) },
      });
    }
  });
}

export async function addParticipants(context: UserContext, eventId: string, memberIds: string[]): Promise<CalendarEventDetailDTO> {
  const existing = await requireReadable(context, eventId);
  if (!canEditEvent(context, existing)) throw new AccessError("FORBIDDEN", "You cannot change who is on this event.");
  const valid = (await requireMembers(context, memberIds)).filter((id) => id !== existing.createdByMemberId);
  const already = new Set(existing.participants.map((row) => row.memberId));
  const added = valid.filter((id) => !already.has(id));
  if (existing.participants.length + added.length > 250) throw new AccessError("VALIDATION_ERROR", "An event can have at most 250 participants.");

  if (added.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.calendarEventParticipant.createMany({
        data: added.map((memberId) => ({ eventId, memberId, companyId: context.companyId, addedByMemberId: context.membershipId })),
        skipDuplicates: true,
      });
      await recordUserAction(context, { actionKey: AuditAction.CALENDAR_PARTICIPANT_ADDED, entity: { type: ENTITY, id: eventId }, metadata: { memberIds: added, count: added.length } }, { tx });
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CALENDAR_PARTICIPANT_ADDED,
        moduleKey: MODULE,
        entityType: "calendar_event",
        entityId: eventId,
        actorMemberId: context.membershipId,
        payload: { memberIds: added, actorName: context.fullName, when: describeWhen(existing.startsAt, existing.endsAt, existing.allDay, existing.timezone) },
      });
    });
  }
  return getEvent(context, eventId);
}

/** The editor removes someone, or a participant takes themselves off. */
export async function removeParticipant(context: UserContext, eventId: string, memberId: string): Promise<void> {
  const existing = await requireReadable(context, eventId);
  const self = memberId === context.membershipId;
  if (!self && !canEditEvent(context, existing)) throw new AccessError("FORBIDDEN", "You cannot change who is on this event.");
  if (!existing.participants.some((row) => row.memberId === memberId)) throw new AccessError("NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.calendarEventParticipant.delete({ where: { eventId_memberId: { eventId, memberId } } });
    await tx.calendarReminder.deleteMany({ where: { eventId, memberId } });
    await recordUserAction(context, { actionKey: AuditAction.CALENDAR_PARTICIPANT_REMOVED, entity: { type: ENTITY, id: eventId }, metadata: { memberId } }, { tx });
  });
}

export async function respondToEvent(
  context: UserContext,
  eventId: string,
  status: Exclude<CalendarParticipantStatus, "INVITED">,
): Promise<CalendarEventDetailDTO> {
  const existing = await requireReadable(context, eventId);
  const result = await prisma.calendarEventParticipant.updateMany({
    where: { eventId: existing.id, memberId: context.membershipId, companyId: context.companyId },
    data: { status, respondedAt: new Date() },
  });
  if (result.count === 0) throw new AccessError("NOT_FOUND", "You are not on this event.");
  return getEvent(context, eventId);
}

function dedupeReminders<T extends { minutesBefore: number; channel: string }>(reminders: T[]): T[] {
  const seen = new Set<string>();
  return reminders.filter((reminder) => {
    const key = `${reminder.minutesBefore}:${reminder.channel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function replaceMyReminders(
  tx: Prisma.TransactionClient,
  context: UserContext,
  eventId: string,
  reminders: Array<{ minutesBefore: number; channel: "IN_APP" | "EMAIL" }>,
) {
  if (!can(context, "calendar.reminder.manage")) throw new AccessError("FORBIDDEN");
  const unique = dedupeReminders(reminders);
  if (unique.length > REMINDERS_MAX) throw new AccessError("VALIDATION_ERROR", `At most ${REMINDERS_MAX} reminders.`);
  await tx.calendarReminder.deleteMany({ where: { eventId, memberId: context.membershipId } });
  if (unique.length > 0) {
    await tx.calendarReminder.createMany({
      data: unique.map((reminder) => ({ companyId: context.companyId, eventId, memberId: context.membershipId, ...reminder })),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Reminders on a meeting (PRD #48 §72, §74)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reminders for participants of a meeting.
 *
 * The meeting is Meetings' record and its schedule is Meetings' to change;
 * `CalendarReminder` is Calendar's row, and it is the one thing on a meeting
 * that Calendar really owns — the same table, delivery worker and per-member
 * uniqueness that reminders on a calendar event use. So Meetings says who
 * should be reminded and when, and Calendar writes it (PRD #48 §74).
 *
 * Duplicates are skipped rather than refused: adding a participant to a series
 * re-offers reminders to people who already have them (PRD #48 §226).
 */
export async function setMeetingReminders(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: { meetingIds: readonly string[]; memberIds: readonly string[]; minutesBefore: readonly number[] },
): Promise<void> {
  if (input.meetingIds.length === 0 || input.memberIds.length === 0 || input.minutesBefore.length === 0) return;
  await tx.calendarReminder.createMany({
    data: input.meetingIds.flatMap((meetingId) =>
      input.memberIds.flatMap((memberId) =>
        input.minutesBefore.map((minutesBefore) => ({ companyId, meetingId, memberId, minutesBefore })),
      ),
    ),
    skipDuplicates: true,
  });
}

/** Reminders written from a series occurrence's own rows, channel and all. */
export async function copyMeetingReminders(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: { meetingIds: readonly string[]; reminders: readonly { memberId: string; minutesBefore: number; channel: "IN_APP" | "EMAIL" }[] },
): Promise<void> {
  if (input.meetingIds.length === 0 || input.reminders.length === 0) return;
  await tx.calendarReminder.createMany({
    data: input.meetingIds.flatMap((meetingId) => input.reminders.map((reminder) => ({ companyId, meetingId, ...reminder }))),
    skipDuplicates: true,
  });
}

/** Nobody is reminded of a meeting they are no longer in (PRD #40 §104). */
export async function clearMeetingReminders(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: { meetingIds: readonly string[]; memberId?: string },
): Promise<void> {
  if (input.meetingIds.length === 0) return;
  await tx.calendarReminder.deleteMany({
    where: { companyId, meetingId: { in: [...input.meetingIds] }, ...(input.memberId ? { memberId: input.memberId } : {}) },
  });
}

/** A reader's own reminder on an event they can see (PRD #39 §70). The target is always the caller. */
export async function addReminder(
  context: UserContext,
  eventId: string,
  input: { minutesBefore: number; channel: "IN_APP" | "EMAIL" },
): Promise<{ id: string }> {
  await requireReadable(context, eventId);
  assertPermission(context, "calendar.reminder.manage");
  const count = await prisma.calendarReminder.count({ where: { eventId, memberId: context.membershipId } });
  if (count >= REMINDERS_MAX) throw new AccessError("VALIDATION_ERROR", `At most ${REMINDERS_MAX} reminders per event.`, { code: "TOO_MANY_REMINDERS" });
  try {
    return await prisma.calendarReminder.create({
      data: { companyId: context.companyId, eventId, memberId: context.membershipId, minutesBefore: input.minutesBefore, channel: input.channel },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccessError("CONFLICT", "You already have that reminder.");
    }
    throw error;
  }
}

export async function removeReminder(context: UserContext, reminderId: string): Promise<void> {
  assertModule(context, MODULE);
  const result = await prisma.calendarReminder.deleteMany({
    where: { id: reminderId, memberId: context.membershipId, companyId: context.companyId },
  });
  // Somebody else's reminder is not found (PRD #39 §194).
  if (result.count === 0) throw new AccessError("NOT_FOUND");
}
