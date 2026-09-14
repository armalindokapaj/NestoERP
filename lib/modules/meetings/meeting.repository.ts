import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { parseRecurrence } from "@/lib/modules/calendar/calendar.recurrence";
import { businessDate, isValidTimeZone } from "@/lib/modules/calendar/calendar.time";
import { meetingCapabilities, myRole, readableMeetingWhere } from "./meeting.permissions";
import type {
  MeetingActionItemDTO,
  MeetingDetailDTO,
  MeetingListItemDTO,
  MeetingPersonDTO,
} from "./meeting.types";
import { decisionLabel } from "./meeting.types";

/**
 * Meeting reads (PRD #40 §155, §157, §239).
 *
 * Every read starts from `readableMeetingWhere`, so a meeting in another
 * company, one the reader was never shown and one that does not exist answer
 * the same "not found" (PRD #40 §231).
 */

export const MODULE = "meetings" as const;
export const ENTITY = "Meeting";
/** The record registry type: what notifications, comments and documents call a meeting. */
export const RECORD = "meeting";

export async function meetingTimezone(companyId: string): Promise<string> {
  const row = await prisma.companySettings.findUnique({ where: { companyId }, select: { timezone: true } });
  return row?.timezone && isValidTimeZone(row.timezone) ? row.timezone : "UTC";
}

const PERSON = { select: { id: true, status: true, user: { select: { firstName: true, lastName: true, avatarUrl: true } } } } as const;

type PersonRow = { id: string; status: string; user: { firstName: string; lastName: string; avatarUrl: string | null } };

export function personDTO(row: PersonRow): MeetingPersonDTO {
  return { memberId: row.id, fullName: `${row.user.firstName} ${row.user.lastName}`, avatarUrl: row.user.avatarUrl };
}

const ROLE_ORDER = { ORGANIZER: 0, CHAIR: 1, SECRETARY: 2, ATTENDEE: 3, OBSERVER: 4 } as const;

export const DETAIL_INCLUDE = {
  project: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true } },
  organizer: PERSON,
  series: { select: { id: true, recurrenceRule: true, cancelledAt: true } },
  participants: {
    orderBy: [{ createdAt: "asc" }],
    select: {
      memberId: true,
      role: true,
      response: true,
      required: true,
      attendance: true,
      displayName: true,
      respondedAt: true,
      member: PERSON,
    },
  },
  agendaItems: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { presenter: PERSON },
  },
  minutesSections: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  decisions: { where: { archivedAt: null }, orderBy: { decisionNumber: "asc" } },
  actionItems: {
    orderBy: [{ createdAt: "asc" }],
    include: { owner: PERSON, linkedTask: { select: { id: true, title: true, status: true } } },
  },
} satisfies Prisma.MeetingInclude;

export type MeetingDetailRow = Prisma.MeetingGetPayload<{ include: typeof DETAIL_INCLUDE }>;

/** The meeting as this reader may see it, or NOT_FOUND. */
export async function requireReadableMeeting(context: UserContext, meetingId: string, options: { includeArchived?: boolean } = {}): Promise<MeetingDetailRow> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.view");
  const row = await prisma.meeting.findFirst({
    where: { AND: [readableMeetingWhere(context), { id: meetingId }, options.includeArchived ? {} : { archivedAt: null }] },
    include: DETAIL_INCLUDE,
  });
  if (!row) throw new AccessError("NOT_FOUND");
  return row;
}

/** The lighter reference permission checks need, for writes that do not return the whole meeting. */
export const REF_SELECT = {
  id: true,
  companyId: true,
  title: true,
  projectId: true,
  organizerMemberId: true,
  status: true,
  minutesStatus: true,
  visibility: true,
  departmentId: true,
  archivedAt: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  seriesId: true,
  occurrenceIndex: true,
  version: true,
  participants: { select: { memberId: true, role: true } },
} satisfies Prisma.MeetingSelect;

export type MeetingRefRow = Prisma.MeetingGetPayload<{ select: typeof REF_SELECT }>;

export async function requireMeetingRef(context: UserContext, meetingId: string): Promise<MeetingRefRow> {
  assertModule(context, MODULE);
  assertPermission(context, "meeting.view");
  const row = await prisma.meeting.findFirst({
    where: { AND: [readableMeetingWhere(context), { id: meetingId, archivedAt: null }] },
    select: REF_SELECT,
  });
  if (!row) throw new AccessError("NOT_FOUND");
  return row;
}

async function projectReadable(context: UserContext, projectId: string): Promise<boolean> {
  if (!canAccessModule(context, "projects") || !can(context, "project.view")) return false;
  const found = await prisma.project.findFirst({ where: { AND: [buildProjectScopeWhere(context), { id: projectId }] }, select: { id: true } });
  return Boolean(found);
}

/** Tasks among these ids the reader can open, in one query. */
async function readableTaskIds(context: UserContext, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0 || !canAccessModule(context, "tasks") || !can(context, "task.view")) return new Set();
  const rows = await prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { id: { in: taskIds } }] }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

export function isActionOverdue(action: { dueAt: Date | null; status: string }, today: string): boolean {
  return Boolean(action.dueAt) && (action.status === "OPEN" || action.status === "IN_PROGRESS") && businessDate(action.dueAt!) < today;
}

export function todayInZone(zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

type ActionRow = MeetingDetailRow["actionItems"][number];

export function actionDTO(
  context: UserContext,
  row: ActionRow,
  input: { today: string; readableTasks: Set<string>; canManage: boolean; canConvert: boolean; minutesFinal: boolean },
): MeetingActionItemDTO {
  const owner = row.ownerMemberId === context.membershipId;
  const linked = row.linkedTaskId !== null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    owner: row.owner ? personDTO(row.owner) : null,
    dueDate: row.dueAt ? businessDate(row.dueAt) : null,
    status: row.status,
    overdue: isActionOverdue(row, input.today),
    completedAt: row.completedAt?.toISOString() ?? null,
    task: row.linkedTask
      ? {
          id: row.linkedTask.id,
          // A task outside the reader's scope is acknowledged, never described (PRD #40 §198).
          title: input.readableTasks.has(row.linkedTask.id) ? row.linkedTask.title : "Linked task",
          status: row.linkedTask.status,
          href: input.readableTasks.has(row.linkedTask.id) ? `/tasks/${row.linkedTask.id}` : null,
        }
      : null,
    capabilities: {
      canEdit: input.canManage && !input.minutesFinal,
      // A linked action follows its task; its owner may move an unlinked one along.
      canChangeStatus: !linked && (input.canManage || owner),
      canConvertToTask: input.canConvert && !linked && row.status !== "CANCELLED" && row.status !== "DONE",
    },
  };
}

export async function toDetailDTO(context: UserContext, row: MeetingDetailRow): Promise<MeetingDetailDTO> {
  const capabilities = meetingCapabilities(context, row);
  const today = todayInZone(row.timezone);
  const [projectOpen, readableTasks, reminders] = await Promise.all([
    row.project ? projectReadable(context, row.project.id) : Promise.resolve(false),
    readableTaskIds(context, row.actionItems.map((action) => action.linkedTaskId).filter((id): id is string => Boolean(id))),
    prisma.calendarReminder.findMany({
      where: { meetingId: row.id, memberId: context.membershipId, companyId: context.companyId },
      orderBy: { minutesBefore: "asc" },
      select: { minutesBefore: true },
    }),
  ]);
  const mine = row.participants.find((participant) => participant.memberId === context.membershipId);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    meetingType: row.meetingType,
    status: row.status,
    minutesStatus: row.minutesStatus,
    minutesFinalizedAt: row.minutesFinalizedAt?.toISOString() ?? null,
    minutesFinalizedBy: row.minutesFinalizedByMemberId
      ? (row.participants.find((participant) => participant.memberId === row.minutesFinalizedByMemberId)?.displayName ?? (await memberName(row.minutesFinalizedByMemberId)))
      : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    locationType: row.locationType,
    locationText: row.locationText,
    onlineUrl: row.onlineUrl,
    visibility: row.visibility,
    // A project the reader cannot open is not named to them, even on a meeting
    // they were invited to — the calendar's rule (PRD #39 §46, PRD #40 §266).
    project: row.project && projectOpen ? { ...row.project, href: `/projects/${row.project.id}` } : null,
    department: row.department,
    organizer: personDTO(row.organizer),
    createdBy: row.createdByMemberId === row.organizerMemberId ? personDTO(row.organizer) : await memberPerson(row.createdByMemberId),
    participants: [...row.participants]
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.displayName.localeCompare(b.displayName))
      .map((participant) => ({
        memberId: participant.memberId,
        // The snapshot keeps a final record readable after someone leaves (PRD #40 §111).
        fullName: participant.member.status === "ACTIVE" ? personDTO(participant.member).fullName : participant.displayName,
        avatarUrl: participant.member.user.avatarUrl,
        role: participant.role,
        response: participant.response,
        required: participant.required,
        attendance: participant.attendance,
        active: participant.member.status === "ACTIVE",
        respondedAt: participant.respondedAt?.toISOString() ?? null,
      })),
    agenda: row.agendaItems.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      title: item.title,
      description: item.description,
      presenter: item.presenter ? personDTO(item.presenter) : null,
      plannedMinutes: item.plannedMinutes,
      status: item.status,
    })),
    minutes: row.minutesSections.map((section) => ({
      id: section.id,
      sortOrder: section.sortOrder,
      title: section.title,
      body: section.body,
      updatedAt: section.updatedAt.toISOString(),
      updatedBy: row.participants.find((participant) => participant.memberId === (section.updatedByMemberId ?? section.createdByMemberId))?.displayName ?? null,
    })),
    decisions: row.decisions.map((decision) => ({
      id: decision.id,
      decisionNumber: decision.decisionNumber,
      label: decisionLabel(decision.decisionNumber),
      title: decision.title,
      description: decision.description,
      decidedAt: decision.decidedAt.toISOString(),
      recordedBy: row.participants.find((participant) => participant.memberId === decision.recordedByMemberId)?.displayName ?? "—",
    })),
    actions: row.actionItems.map((action) =>
      actionDTO(context, action, {
        today,
        readableTasks,
        canManage: capabilities.canManageActions,
        canConvert: capabilities.canConvertToTask,
        minutesFinal: row.minutesStatus === "FINAL",
      }),
    ),
    series: row.series
      ? {
          id: row.series.id,
          occurrenceIndex: row.occurrenceIndex ?? 0,
          recurrence: safeRecurrence(row.series.recurrenceRule),
          cancelled: row.series.cancelledAt !== null,
        }
      : null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    archived: row.archivedAt !== null,
    version: row.version,
    reminders: reminders.map((reminder) => reminder.minutesBefore),
    myRole: myRole(context, row),
    myResponse: mine?.response ?? null,
    capabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function safeRecurrence(rule: string) {
  try {
    return parseRecurrence(rule);
  } catch {
    return null;
  }
}

async function memberPerson(memberId: string): Promise<MeetingPersonDTO> {
  const row = await prisma.companyMember.findUnique({ where: { id: memberId }, ...PERSON });
  return row ? personDTO(row) : { memberId, fullName: "Former member", avatarUrl: null };
}

async function memberName(memberId: string): Promise<string> {
  return (await memberPerson(memberId)).fullName;
}

export async function getMeeting(context: UserContext, meetingId: string): Promise<MeetingDetailDTO> {
  return toDetailDTO(context, await requireReadableMeeting(context, meetingId, { includeArchived: true }));
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

export const LIST_SELECT = {
  id: true,
  title: true,
  meetingType: true,
  status: true,
  minutesStatus: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  locationType: true,
  locationText: true,
  seriesId: true,
  organizerMemberId: true,
  project: { select: { id: true, name: true, code: true } },
  organizer: PERSON,
  participants: {
    orderBy: [{ createdAt: "asc" }],
    take: 6,
    select: { memberId: true, role: true, response: true, member: PERSON },
  },
  _count: { select: { participants: true, actionItems: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } } } },
} satisfies Prisma.MeetingSelect;

export type MeetingListRow = Prisma.MeetingGetPayload<{ select: typeof LIST_SELECT }>;

export async function listItemDTOs(context: UserContext, rows: MeetingListRow[]): Promise<MeetingListItemDTO[]> {
  const memberships = rows.length
    ? await prisma.meetingParticipant.findMany({
        where: { meetingId: { in: rows.map((row) => row.id) }, memberId: context.membershipId },
        select: { meetingId: true, role: true, response: true },
      })
    : [];
  const mine = new Map(memberships.map((row) => [row.meetingId, row]));
  const projectIds = [...new Set(rows.map((row) => row.project?.id).filter((id): id is string => Boolean(id)))];
  const openProjects =
    projectIds.length && canAccessModule(context, "projects") && can(context, "project.view")
      ? new Set((await prisma.project.findMany({ where: { AND: [buildProjectScopeWhere(context), { id: { in: projectIds } }] }, select: { id: true } })).map((row) => row.id))
      : new Set<string>();
  return rows.map((row) => {
    const me = mine.get(row.id);
    return {
      id: row.id,
      title: row.title,
      meetingType: row.meetingType,
      status: row.status,
      minutesStatus: row.minutesStatus,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      timezone: row.timezone,
      locationType: row.locationType,
      locationText: row.locationText,
      project: row.project && openProjects.has(row.project.id) ? row.project : null,
      organizer: personDTO(row.organizer),
      participantCount: row._count.participants,
      participantsPreview: row.participants.slice(0, 5).map((participant) => ({ ...personDTO(participant.member), response: participant.response })),
      myRole: row.organizerMemberId === context.membershipId ? "ORGANIZER" : (me?.role ?? null),
      myResponse: me?.response ?? null,
      recurring: row.seriesId !== null,
      openActionCount: row._count.actionItems,
      href: `/meetings/${row.id}`,
    };
  });
}
