import type { MeetingParticipantRole, MeetingStatus, Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere, canAccessProject } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { findConflicts } from "@/lib/modules/calendar/calendar.availability";
import { expandRecurrence, serializeRecurrence, seriesEndsAt } from "@/lib/modules/calendar/calendar.recurrence";
import { instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import type { RecurrenceInput } from "@/lib/modules/calendar/calendar.types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { notifyCancelled, notifyInvited, notifyUpdated } from "./meeting.notifications";
import {
  canCancelMeeting,
  canCreateMeeting,
  canEditMeeting,
  canRunMeeting,
  readableMeetingWhere,
  visibilityProblem,
} from "./meeting.permissions";
import {
  ENTITY,
  getMeeting,
  laterOccurrencesInReach,
  LIST_SELECT,
  listItemDTOs,
  meetingTimezone,
  MODULE,
  RECORD,
  requireReadableMeeting,
  type MeetingDetailRow,
} from "./meeting.repository";
import type { CreateMeetingInput, MeetingListQuery, MeetingRecurrence, UpdateMeetingInput } from "./meeting.schema";
import { DEFAULT_REMINDER_MINUTES, PARTICIPANTS_MAX, SERIES_OCCURRENCES_MAX } from "./meeting.schema";
import { AGENDA_TEMPLATES, type MeetingConflictDTO, type MeetingListItemDTO, type MeetingWriteResult } from "./meeting.types";

/**
 * Meetings (PRD #40 §99-§102, §155-§162, §178-§180, §221-§230).
 *
 * The meeting is the source of truth; the calendar only shows it. Every write
 * here re-reads the meeting in the caller's own scope, checks the caller's
 * part in it and the meeting's state, and happens in one transaction with its
 * audit entry and its notifications.
 */

export const SERIES_HORIZON_DAYS = 90;
const DAY_MS = 86_400_000;
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

export type ParticipantInput = { memberId: string; role: Exclude<MeetingParticipantRole, "ORGANIZER">; required: boolean };

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Active members of this company with their names, or one validation error
 * that names none of them — the same for another company's member and for a
 * typo (PRD #40 §25, §232).
 */
export async function requireMembers(context: UserContext, memberIds: readonly string[], field = "participants"): Promise<Map<string, string>> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.companyMember.findMany({
    where: { id: { in: unique }, companyId: context.companyId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  if (rows.length !== unique.length) {
    throw new AccessError("VALIDATION_ERROR", "Some of these people cannot be added.", {
      [field]: ["Some of these people cannot be added."],
      code: "PARTICIPANT_NOT_ALLOWED",
    });
  }
  return new Map(rows.map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]));
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

/** Wall-clock times in the company zone to instants (PRD #40 §170, §206). */
export function toInstants(date: string, startTime: string, endTime: string, zone: string): { startsAt: Date; endsAt: Date } {
  const startsAt = instantFromLocal(date, startTime, zone);
  const endsAt = instantFromLocal(date, endTime, zone);
  // An end inside the skipped spring hour can land on or before its start.
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new AccessError("VALIDATION_ERROR", "The meeting must end after it starts.", { endTime: ["The meeting must end after it starts."] });
  }
  return { startsAt, endsAt };
}

function assertVisibility(context: UserContext, input: { visibility: CreateMeetingInput["visibility"]; departmentId?: string | null }) {
  const problem = visibilityProblem(context, input);
  if (problem) throw new AccessError("FORBIDDEN", problem);
}

function uniqueParticipants(input: ParticipantInput[], organizerMemberId: string): ParticipantInput[] {
  const seen = new Set<string>([organizerMemberId]);
  const result: ParticipantInput[] = [];
  for (const participant of input) {
    if (seen.has(participant.memberId)) continue;
    seen.add(participant.memberId);
    result.push(participant);
  }
  return result;
}

function recurrenceInput(recurrence: MeetingRecurrence): RecurrenceInput {
  return {
    frequency: recurrence.frequency,
    interval: recurrence.interval,
    ...(recurrence.until ? { until: recurrence.until } : {}),
    ...(recurrence.count ? { count: recurrence.count } : {}),
  };
}

/**
 * The occurrences a series has inside its horizon (PRD #40 §224-§226): real
 * meetings, never virtual ones, because each keeps its own minutes. Bounded by
 * both the horizon and a hard count.
 */
export function planOccurrences(
  first: { startsAt: Date; endsAt: Date; timezone: string },
  rule: RecurrenceInput,
  horizon: Date,
): Array<{ startsAt: Date; endsAt: Date; occurrenceIndex: number }> {
  const all = expandRecurrence({ ...first, allDay: false }, rule, { from: first.startsAt, to: horizon }, 5_000);
  return all.map((occurrence, occurrenceIndex) => ({ ...occurrence, occurrenceIndex }));
}

async function conflictsFor(context: UserContext, meeting: { id: string; startsAt: Date; endsAt: Date; timezone: string; organizerMemberId: string }, memberIds: string[]): Promise<MeetingConflictDTO[]> {
  return findConflicts(context, [...new Set([meeting.organizerMemberId, ...memberIds])], meeting, { excludeMeetingId: meeting.id, timezone: meeting.timezone });
}

function participantIdsOf(row: Pick<MeetingDetailRow, "participants" | "organizerMemberId">): string[] {
  return row.participants.map((participant) => participant.memberId).filter((id) => id !== row.organizerMemberId);
}

/** The people who watch a meeting's discussion from the start (PRD #40 §67); a very large meeting only its leads. */
function stakeholders(organizerMemberId: string, participants: ParticipantInput[]): string[] {
  const leads = participants.filter((participant) => participant.role === "CHAIR" || participant.role === "SECRETARY").map((participant) => participant.memberId);
  return [organizerMemberId, ...(participants.length <= 50 ? participants.map((participant) => participant.memberId) : leads)];
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const LIVE: MeetingStatus[] = ["DRAFT", "SCHEDULED", "IN_PROGRESS"];

export async function listMeetings(context: UserContext, query: MeetingListQuery): Promise<{ data: MeetingListItemDTO[]; pagination: ReturnType<typeof paginationMeta> }> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.view");
  const now = new Date();
  const me = context.membershipId;

  const filters: Prisma.MeetingWhereInput[] = [readableMeetingWhere(context), { archivedAt: null }];
  const upcoming: Prisma.MeetingWhereInput = {
    OR: [{ status: "IN_PROGRESS" }, { status: { in: ["DRAFT", "SCHEDULED"] }, endsAt: { gte: now } }],
  };
  const past: Prisma.MeetingWhereInput = {
    OR: [{ status: { in: ["COMPLETED", "CANCELLED"] } }, { status: { in: ["DRAFT", "SCHEDULED"] }, endsAt: { lt: now } }],
  };
  const mine: Prisma.MeetingWhereInput = { OR: [{ organizerMemberId: me }, { participants: { some: { memberId: me } } }] };

  switch (query.section) {
    case "upcoming":
      filters.push(upcoming);
      break;
    case "mine":
      filters.push(mine, upcoming);
      break;
    case "past":
      filters.push(past);
      break;
    default:
      break;
  }
  if (query.myOnly && query.section !== "mine") filters.push(mine);
  if (query.from) filters.push({ endsAt: { gt: new Date(query.from) } });
  if (query.to) filters.push({ startsAt: { lt: new Date(query.to) } });
  /*
   * Filtering or searching by project reads the project, so it goes through the
   * project's own door: otherwise a guessed project id, or a typed project
   * name, sorts meetings the reader was invited to by a project they cannot
   * open — and says the project exists (PRD #40 §266, PRD #47 §175).
   */
  const projectDoor = canAccessModule(context, "projects") && can(context, "project.view") ? buildProjectScopeWhere(context) : null;
  if (query.projectId) filters.push(projectDoor ? { projectId: query.projectId, project: { is: projectDoor } } : { id: { in: [] } });
  if (query.type?.length) filters.push({ meetingType: { in: query.type } });
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.organizerId) filters.push({ organizerMemberId: query.organizerId });
  if (query.participantId) filters.push({ OR: [{ organizerMemberId: query.participantId }, { participants: { some: { memberId: query.participantId } } }] });
  if (query.q) {
    // Title, project, organizer and participant names — never minutes (PRD #40 §118).
    const term = { contains: query.q, mode: "insensitive" as const };
    filters.push({
      OR: [
        { title: term },
        ...(projectDoor ? [{ project: { is: { AND: [projectDoor, { OR: [{ name: term }, { code: term }] }] } } }] : []),
        { organizer: { user: { OR: [{ firstName: term }, { lastName: term }] } } },
        { participants: { some: { displayName: term } } },
      ],
    });
  }

  const where: Prisma.MeetingWhereInput = { AND: filters };
  const ascending = query.section === "upcoming" || query.section === "mine";
  const [rows, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: [{ startsAt: ascending ? "asc" : "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.meeting.count({ where }),
  ]);
  return { data: await listItemDTOs(context, rows), pagination: paginationMeta(total, query.page, query.limit) };
}

export { getMeeting };

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createMeeting(context: UserContext, input: CreateMeetingInput): Promise<MeetingWriteResult> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.create");
  try {
    const result = await createMeetingInner(context, input);
    incrementCounter(Metric.MEETING_CREATE_SUCCESS, { recurring: String(Boolean(input.recurrence)) });
    return result;
  } catch (error) {
    incrementCounter(Metric.MEETING_CREATE_FAILURE, { reason: error instanceof AccessError ? error.code : "error" });
    throw error;
  }
}

async function createMeetingInner(context: UserContext, input: CreateMeetingInput): Promise<MeetingWriteResult> {
  assertVisibility(context, input);
  if (input.recurrence && input.saveAsDraft) {
    throw new AccessError("VALIDATION_ERROR", "A repeating meeting is scheduled when it is saved.", { saveAsDraft: ["A repeating meeting is scheduled when it is saved."] });
  }

  const zone = await meetingTimezone(context.companyId);
  const { startsAt, endsAt } = toInstants(input.date, input.startTime, input.endTime, zone);
  const projectId = await requireProject(context, input.projectId);
  const departmentId = await requireDepartment(context, input.departmentId);
  const participants = uniqueParticipants(input.participants as ParticipantInput[], context.membershipId);
  if (participants.length + 1 > PARTICIPANTS_MAX) throw new AccessError("VALIDATION_ERROR", `A meeting can have at most ${PARTICIPANTS_MAX} participants.`);
  const names = await requireMembers(context, [context.membershipId, ...participants.map((participant) => participant.memberId)]);

  let template = null;
  if (input.agendaTemplate) {
    template = AGENDA_TEMPLATES.find((candidate) => candidate.key === input.agendaTemplate) ?? null;
    if (!template) throw new AccessError("VALIDATION_ERROR", "Choose one of the agenda templates.", { agendaTemplate: ["Choose one of the agenda templates."] });
  }

  const rule = input.recurrence ? recurrenceInput(input.recurrence) : null;
  const horizon = new Date(Math.max(Date.now(), startsAt.getTime()) + SERIES_HORIZON_DAYS * DAY_MS);
  const occurrences = rule
    ? planOccurrences({ startsAt, endsAt, timezone: zone }, rule, horizon).slice(0, SERIES_OCCURRENCES_MAX)
    : [{ startsAt, endsAt, occurrenceIndex: 0 }];
  if (occurrences.length === 0) {
    throw new AccessError("VALIDATION_ERROR", "This series has no meetings. Check when it ends.", { recurrence: ["This series has no meetings. Check when it ends."] });
  }

  const status: MeetingStatus = input.saveAsDraft ? "DRAFT" : "SCHEDULED";
  const reminders = [...new Set(input.reminders.length ? input.reminders : [])];
  const everyone = [context.membershipId, ...participants.map((participant) => participant.memberId)];

  const first = await prisma.$transaction(async (tx) => {
    const series = rule
      ? await tx.meetingSeries.create({
          data: {
            companyId: context.companyId,
            createdByMemberId: context.membershipId,
            title: input.title,
            description: input.description,
            meetingType: input.meetingType,
            projectId,
            departmentId,
            visibility: input.visibility,
            locationType: input.locationType,
            locationText: input.locationText,
            onlineUrl: input.onlineUrl,
            firstStartsAt: startsAt,
            durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
            timezone: zone,
            recurrenceRule: serializeRecurrence(rule),
            recurrenceEndsAt: seriesEndsAt({ startsAt, endsAt, allDay: false, timezone: zone }, rule),
            generatedUntil: occurrences.length >= SERIES_OCCURRENCES_MAX ? occurrences.at(-1)!.startsAt : horizon,
          },
          select: { id: true },
        })
      : null;

    const meetings = await tx.meeting.createManyAndReturn({
      data: occurrences.map((occurrence) => ({
        companyId: context.companyId,
        projectId,
        departmentId,
        createdByMemberId: context.membershipId,
        organizerMemberId: context.membershipId,
        title: input.title,
        description: input.description,
        meetingType: input.meetingType,
        status,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        timezone: zone,
        locationType: input.locationType,
        locationText: input.locationText,
        onlineUrl: input.onlineUrl,
        visibility: input.visibility,
        seriesId: series?.id ?? null,
        occurrenceIndex: series ? occurrence.occurrenceIndex : null,
      })),
      select: { id: true, startsAt: true, endsAt: true, occurrenceIndex: true },
    });
    meetings.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const invitedAt = status === "SCHEDULED" ? new Date() : null;

    await tx.meetingParticipant.createMany({
      data: meetings.flatMap((meeting) => [
        {
          meetingId: meeting.id,
          memberId: context.membershipId,
          companyId: context.companyId,
          role: "ORGANIZER" as const,
          response: "ACCEPTED" as const,
          displayName: names.get(context.membershipId)!,
          respondedAt: new Date(),
        },
        ...participants.map((participant) => ({
          meetingId: meeting.id,
          memberId: participant.memberId,
          companyId: context.companyId,
          role: participant.role,
          required: participant.required,
          displayName: names.get(participant.memberId)!,
          invitedAt,
        })),
      ]),
    });
    if (template) {
      await tx.meetingAgendaItem.createMany({
        data: meetings.flatMap((meeting) =>
          template.items.map((item, index) => ({
            companyId: context.companyId,
            meetingId: meeting.id,
            sortOrder: index,
            title: item.title,
            plannedMinutes: item.plannedMinutes ?? null,
          })),
        ),
      });
    }
    if (reminders.length > 0) {
      await tx.calendarReminder.createMany({
        data: meetings.flatMap((meeting) =>
          everyone.flatMap((memberId) => reminders.map((minutesBefore) => ({ companyId: context.companyId, meetingId: meeting.id, memberId, minutesBefore }))),
        ),
        skipDuplicates: true,
      });
    }

    const head = { ...meetings[0], projectId, timezone: zone };
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.MEETING_CREATED,
        entity: { type: ENTITY, id: head.id, label: input.visibility === "PARTICIPANTS" ? undefined : input.title },
        projectId,
        metadata: {
          meetingType: input.meetingType,
          visibility: input.visibility,
          status,
          projectId,
          departmentId,
          participantCount: participants.length,
          seriesId: series?.id ?? null,
          occurrences: meetings.length,
        },
      },
      { tx },
    );
    if (status === "SCHEDULED") {
      await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: head.id, action: "MEETING_SCHEDULED", message: `scheduled ${input.title}` });
      // One invitation for a whole series, never one per occurrence (PRD #40 §230).
      const seriesNote = series ? `Repeats ${rule!.frequency.toLowerCase()} · ${meetings.length} meetings scheduled` : undefined;
      await notifyInvited(tx, context, head, participants.map((participant) => participant.memberId), seriesNote);
    }
    return head;
  }, TX);

  await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: first.id, memberIds: stakeholders(context.membershipId, participants) });
  const conflicts = status === "SCHEDULED" ? await conflictsFor(context, { ...first, organizerMemberId: context.membershipId }, participants.map((participant) => participant.memberId)) : [];
  return { meeting: await getMeeting(context, first.id), conflicts, occurrences: occurrences.length };
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

function staleVersion(): AccessError {
  return new AccessError("CONFLICT", "This meeting was changed by someone else. Reload the latest version.", { code: "STALE_VERSION" });
}

export async function updateMeeting(context: UserContext, meetingId: string, input: UpdateMeetingInput): Promise<MeetingWriteResult> {
  const existing = await requireReadableMeeting(context, meetingId);
  if (!canEditMeeting(context, existing)) throw new AccessError("FORBIDDEN", "You cannot change this meeting.");
  if (existing.version !== input.version) throw staleVersion();
  assertVisibility(context, input);

  const zone = existing.timezone;
  const { startsAt, endsAt } = toInstants(input.date, input.startTime, input.endTime, zone);
  const projectId = input.projectId === existing.projectId ? existing.projectId : await requireProject(context, input.projectId);
  const departmentId = input.departmentId === existing.departmentId ? existing.departmentId : await requireDepartment(context, input.departmentId);
  const future = input.scope === "FUTURE" && existing.seriesId !== null && existing.status !== "COMPLETED";
  if (future && input.date !== localDate(existing.startsAt, zone)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "To move a repeating meeting to another day, change this meeting only.",
      { date: ["To move a repeating meeting to another day, change this meeting only."] },
    );
  }

  const changed: string[] = [];
  const compare = (field: string, before: unknown, after: unknown) => {
    if ((before ?? null) !== (after ?? null)) changed.push(field);
  };
  compare("title", existing.title, input.title);
  compare("description", existing.description, input.description);
  compare("meetingType", existing.meetingType, input.meetingType);
  compare("visibility", existing.visibility, input.visibility);
  compare("startsAt", existing.startsAt.getTime(), startsAt.getTime());
  compare("endsAt", existing.endsAt.getTime(), endsAt.getTime());
  compare("projectId", existing.projectId, projectId);
  compare("departmentId", existing.departmentId, departmentId);
  compare("locationType", existing.locationType, input.locationType);
  compare("locationText", existing.locationText, input.locationText);
  compare("onlineUrl", existing.onlineUrl, input.onlineUrl);
  // The fields people must act on (PRD #40 §252); a description typo is not one.
  const material = changed.some((field) => ["startsAt", "endsAt", "projectId", "locationType", "locationText", "onlineUrl"].includes(field));

  const fields = {
    title: input.title,
    description: input.description,
    meetingType: input.meetingType,
    visibility: input.visibility,
    projectId,
    departmentId,
    locationType: input.locationType,
    locationText: input.locationText,
    onlineUrl: input.onlineUrl,
  };

  const occurrences = await prisma.$transaction(async (tx) => {
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, version: input.version, archivedAt: null },
      data: { ...fields, startsAt, endsAt, version: { increment: 1 } },
    });
    if (result.count === 0) throw staleVersion();

    let count = 1;
    if (future) {
      // Only the later meetings this caller could change one by one (PRD #47 §20, §62).
      const later = await laterOccurrencesInReach(context, existing, canEditMeeting, tx);
      for (const occurrence of later.meetings) {
        const day = localDate(occurrence.startsAt, zone);
        const times = toInstants(day, input.startTime, input.endTime, zone);
        await tx.meeting.update({ where: { id: occurrence.id }, data: { ...fields, ...times, version: { increment: 1 } } });
      }
      count += later.meetings.length;
      // The series is the template for meetings not yet generated: it changes
      // only when this change reached every later meeting and the caller runs
      // the series, never on the word of one occurrence's organizer.
      if (later.complete && later.organizesSeries) {
        const series = await tx.meetingSeries.findUniqueOrThrow({ where: { id: existing.seriesId! }, select: { firstStartsAt: true } });
        await tx.meetingSeries.update({
          where: { id: existing.seriesId! },
          data: {
            ...fields,
            firstStartsAt: instantFromLocal(localDate(series.firstStartsAt, zone), input.startTime, zone),
            durationMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
          },
        });
      }
    }

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.MEETING_UPDATED,
        entity: { type: ENTITY, id: meetingId, label: input.visibility === "PARTICIPANTS" ? undefined : input.title },
        projectId,
        metadata: { fields: changed, scope: future ? "FUTURE" : "THIS", occurrences: count, afterCompletion: existing.status === "COMPLETED" },
      },
      { tx },
    );
    if (material && existing.status !== "DRAFT") {
      await notifyUpdated(tx, context, { id: meetingId, projectId, startsAt, endsAt, timezone: zone }, participantIdsOf(existing), future ? { series: "This and later meetings in the series" } : {});
    }
    return count;
  }, TX);

  const conflicts = material && existing.status !== "COMPLETED" ? await conflictsFor(context, { id: meetingId, startsAt, endsAt, timezone: zone, organizerMemberId: existing.organizerMemberId }, participantIdsOf(existing)) : [];
  return { meeting: await getMeeting(context, meetingId), conflicts, occurrences };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle (PRD #40 §99-§102)                                                */
/* -------------------------------------------------------------------------- */

async function transition(
  context: UserContext,
  meetingId: string,
  input: {
    from: MeetingStatus[];
    to: MeetingStatus;
    allowed: (row: MeetingDetailRow) => boolean;
    refusal: string;
    data: Prisma.MeetingUpdateManyMutationInput;
    audit: string;
    activity?: { action: string; message: string };
    after?: (tx: Prisma.TransactionClient, row: MeetingDetailRow) => Promise<void>;
  },
): Promise<MeetingDetailRow> {
  const existing = await requireReadableMeeting(context, meetingId);
  if (!input.allowed(existing)) throw new AccessError("FORBIDDEN", input.refusal);
  if (!input.from.includes(existing.status)) {
    throw new AccessError("CONFLICT", `This meeting is ${existing.status.toLowerCase().replace("_", " ")}.`, { code: "INVALID_TRANSITION" });
  }

  await prisma.$transaction(async (tx) => {
    // The status in the where clause makes a double click a conflict, not a second transition.
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, status: existing.status, archivedAt: null },
      data: { ...input.data, status: input.to, version: { increment: 1 } },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "This meeting has just changed. Reload it.", { code: "INVALID_TRANSITION" });
    await recordUserAction(
      context,
      {
        actionKey: input.audit as (typeof AuditAction)[keyof typeof AuditAction],
        entity: { type: ENTITY, id: meetingId, label: existing.visibility === "PARTICIPANTS" ? undefined : existing.title },
        projectId: existing.projectId,
        metadata: auditMetadata(input.audit, input.data),
      },
      { tx },
    );
    if (input.activity) {
      await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: input.activity.action, message: input.activity.message });
    }
    await input.after?.(tx, existing);
  });
  return existing;
}

function auditMetadata(action: string, data: Prisma.MeetingUpdateManyMutationInput): Record<string, unknown> {
  if (action === AuditAction.MEETING_STARTED) return { startedAt: (data.startedAt as Date).toISOString() };
  if (action === AuditAction.MEETING_COMPLETED) return { completedAt: (data.completedAt as Date).toISOString() };
  return {};
}

/** DRAFT → SCHEDULED: the invitations go out now (PRD #40 §102, §159). */
export async function scheduleMeeting(context: UserContext, meetingId: string): Promise<MeetingWriteResult> {
  const row = await transition(context, meetingId, {
    from: ["DRAFT"],
    to: "SCHEDULED",
    allowed: (meeting) => canEditMeeting(context, meeting),
    refusal: "You cannot schedule this meeting.",
    data: {},
    audit: AuditAction.MEETING_SCHEDULED,
    activity: { action: "MEETING_SCHEDULED", message: "scheduled the meeting" },
    after: async (tx, meeting) => {
      await tx.meetingParticipant.updateMany({ where: { meetingId, role: { not: "ORGANIZER" } }, data: { invitedAt: new Date() } });
      await notifyInvited(tx, context, meeting, participantIdsOf(meeting));
    },
  });
  const conflicts = await conflictsFor(context, row, participantIdsOf(row));
  return { meeting: await getMeeting(context, meetingId), conflicts };
}

export async function startMeeting(context: UserContext, meetingId: string): Promise<MeetingWriteResult> {
  await transition(context, meetingId, {
    from: ["SCHEDULED"],
    to: "IN_PROGRESS",
    allowed: (meeting) => canRunMeeting(context, meeting),
    refusal: "Only the organizer or chair can start this meeting.",
    data: { startedAt: new Date() },
    audit: AuditAction.MEETING_STARTED,
    activity: { action: "MEETING_STARTED", message: "started the meeting" },
  });
  return { meeting: await getMeeting(context, meetingId), conflicts: [] };
}

export async function completeMeeting(context: UserContext, meetingId: string): Promise<MeetingWriteResult> {
  await transition(context, meetingId, {
    from: ["IN_PROGRESS"],
    to: "COMPLETED",
    allowed: (meeting) => canRunMeeting(context, meeting),
    refusal: "Only the organizer or chair can complete this meeting.",
    data: { completedAt: new Date() },
    audit: AuditAction.MEETING_COMPLETED,
    activity: { action: "MEETING_COMPLETED", message: "completed the meeting" },
  });
  return { meeting: await getMeeting(context, meetingId), conflicts: [] };
}

/**
 * Cancel (PRD #40 §101, §228). For a series, "this and later" cancels every
 * later meeting still to happen and stops the series; earlier meetings and
 * their records are untouched. A cancelled meeting is never reactivated —
 * duplicate it instead (PRD #40 §102).
 */
export async function cancelMeeting(context: UserContext, meetingId: string, input: { reason: string | null; scope: "THIS" | "FUTURE" }): Promise<MeetingWriteResult> {
  const existing = await requireReadableMeeting(context, meetingId);
  if (!canCancelMeeting(context, existing)) throw new AccessError("FORBIDDEN", "You cannot cancel this meeting.");
  if (!LIVE.includes(existing.status)) throw new AccessError("CONFLICT", `This meeting is ${existing.status.toLowerCase()}.`, { code: "INVALID_TRANSITION" });
  const future = input.scope === "FUTURE" && existing.seriesId !== null;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, status: existing.status, archivedAt: null },
      data: { status: "CANCELLED", cancelledAt: now, cancelledByMemberId: context.membershipId, cancelReason: input.reason, version: { increment: 1 } },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "This meeting has just changed. Reload it.", { code: "INVALID_TRANSITION" });

    let occurrences = 1;
    if (future) {
      // Only the later meetings this caller could cancel one by one (PRD #47 §20, §62).
      const reach = await laterOccurrencesInReach(context, existing, canCancelMeeting, tx);
      const later = await tx.meeting.updateMany({
        where: { id: { in: reach.meetings.map((row) => row.id) }, companyId: context.companyId, status: { in: ["DRAFT", "SCHEDULED"] }, archivedAt: null },
        data: { status: "CANCELLED", cancelledAt: now, cancelledByMemberId: context.membershipId, cancelReason: input.reason, version: { increment: 1 } },
      });
      occurrences += later.count;
      // Stopping the series stops meetings not yet generated — somebody else's, if any later one was out of reach.
      if (reach.complete && reach.organizesSeries) {
        await tx.meetingSeries.update({ where: { id: existing.seriesId! }, data: { cancelledAt: now } });
      }
    }

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.MEETING_CANCELLED,
        entity: { type: ENTITY, id: meetingId, label: existing.visibility === "PARTICIPANTS" ? undefined : existing.title },
        projectId: existing.projectId,
        metadata: { scope: future ? "FUTURE" : "THIS", occurrences, hadReason: Boolean(input.reason) },
      },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_CANCELLED", message: "cancelled the meeting" });
    if (existing.status !== "DRAFT") await notifyCancelled(tx, context, existing, participantIdsOf(existing), input.reason);
  }, TX);

  return { meeting: await getMeeting(context, meetingId), conflicts: [] };
}

/**
 * Duplicate (PRD #40 §221): type, project, people, agenda and length carry
 * over; minutes, decisions, action outcomes and documents do not.
 */
export async function duplicateMeeting(context: UserContext, meetingId: string, input: { date: string; startTime?: string }): Promise<MeetingWriteResult> {
  const source = await requireReadableMeeting(context, meetingId, { includeArchived: true });
  if (!canCreateMeeting(context)) throw new AccessError("FORBIDDEN", "You cannot create meetings.");
  const zone = source.timezone;
  const startTime = input.startTime ?? new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(source.startsAt);
  const startsAt = instantFromLocal(input.date, startTime, zone);
  const endsAt = new Date(startsAt.getTime() + (source.endsAt.getTime() - source.startsAt.getTime()));
  const endTime = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(endsAt);
  if (localDate(endsAt, zone) !== input.date) {
    throw new AccessError("VALIDATION_ERROR", "The copy would run past midnight. Choose an earlier start.", { startTime: ["The copy would run past midnight. Choose an earlier start."] });
  }

  // Only the people who can still be invited, and a project the caller can still reach.
  const activeMembers = await prisma.companyMember.findMany({
    where: { id: { in: source.participants.map((row) => row.memberId) }, companyId: context.companyId, status: "ACTIVE", user: { status: "ACTIVE" } },
    select: { id: true },
  });
  const active = new Set(activeMembers.map((row) => row.id));
  const projectOpen = source.projectId && canAccessModule(context, "projects") && can(context, "project.view") ? await canAccessProject(context, source.projectId) : false;
  const visibility = source.visibility === "PROJECT" && !projectOpen ? "PARTICIPANTS" : source.visibility;

  const created = await createMeeting(context, {
    title: source.title,
    description: source.description,
    meetingType: source.meetingType,
    visibility,
    date: input.date,
    startTime,
    endTime,
    projectId: projectOpen ? source.projectId : null,
    departmentId: source.departmentId,
    locationType: source.locationType,
    locationText: source.locationText,
    onlineUrl: source.onlineUrl,
    participants: source.participants
      .filter((row) => row.role !== "ORGANIZER" && row.memberId !== context.membershipId && active.has(row.memberId))
      .map((row) => ({ memberId: row.memberId, role: row.role as ParticipantInput["role"], required: row.required })),
    agendaTemplate: null,
    reminders: [DEFAULT_REMINDER_MINUTES],
    recurrence: null,
    saveAsDraft: false,
  });

  if (source.agendaItems.length > 0) {
    await prisma.meetingAgendaItem.createMany({
      data: source.agendaItems.map((item, index) => ({
        companyId: context.companyId,
        meetingId: created.meeting.id,
        sortOrder: index,
        title: item.title,
        description: item.description,
        presenterMemberId: item.presenterMemberId && active.has(item.presenterMemberId) ? item.presenterMemberId : null,
        plannedMinutes: item.plannedMinutes,
      })),
    });
  }
  return { ...created, meeting: await getMeeting(context, created.meeting.id) };
}

/** Recent activity on one meeting, for its Activity tab (PRD #40 §183). */
export async function listMeetingActivity(context: UserContext, meetingId: string, limit = 30) {
  await requireReadableMeeting(context, meetingId, { includeArchived: true });
  const rows = await prisma.activity.findMany({
    where: { companyId: context.companyId, entityType: ENTITY, entityId: meetingId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: { id: true, action: true, message: true, createdAt: true, actorMember: { select: { user: { select: { firstName: true, lastName: true } } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}` : null,
    createdAt: row.createdAt.toISOString(),
  }));
}
