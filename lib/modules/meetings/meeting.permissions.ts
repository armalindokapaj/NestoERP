import type { MeetingParticipantRole, MeetingStatus, MeetingVisibility, MinutesStatus, Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import type { MeetingCapabilities } from "./meeting.types";

/**
 * Who sees a meeting and who may change it (PRD #40 §80-§86, §137, §249).
 *
 *   Company + meeting permission + visibility + project/department scope
 *   + the reader's part in the meeting + the meeting's state = allowed action
 *
 * Sight:
 *   PARTICIPANTS  the organizer and the people on it — nobody else
 *   PROJECT       also everyone who can open the project
 *   DEPARTMENT    also members of that department, and meeting managers
 *   COMPANY       also every member with `meeting.view`
 *
 * A draft is its organizer's until it is scheduled. After that, being on a
 * meeting always shows it: inviting somebody is showing it to them.
 * It grants nothing else — not the project, not the minutes pen. Free/busy in
 * the calendar never opens a meeting either (PRD #40 §86).
 *
 * Change: a permission is necessary and never sufficient. The organizer runs
 * the meeting; the secretary keeps the minutes; the chair runs the agenda; a
 * holder of `meeting.manage` may step in on any meeting they can see. Role
 * names alone grant nothing: a secretary without `meeting.minutes.edit` does
 * not write minutes (PRD #40 §137).
 */

export function meetingsOpen(context: UserContext): boolean {
  return canAccessModule(context, "meetings") && can(context, "meeting.view");
}

export function readableMeetingWhere(context: UserContext): Prisma.MeetingWhereInput {
  const doors: Prisma.MeetingWhereInput[] = [
    { participants: { some: { memberId: context.membershipId } } },
    { visibility: "COMPANY" },
  ];
  if (canAccessModule(context, "projects") && can(context, "project.view")) {
    doors.push({ visibility: "PROJECT", project: { is: buildProjectScopeWhere(context) } });
  }
  if (can(context, "meeting.manage")) {
    doors.push({ visibility: "DEPARTMENT" });
  } else if (context.department) {
    doors.push({ visibility: "DEPARTMENT", departmentId: context.department.id });
  }
  // A draft has invited nobody yet: until it is scheduled it is its organizer's alone.
  return {
    companyId: context.companyId,
    OR: [
      { organizerMemberId: context.membershipId },
      { createdByMemberId: context.membershipId },
      { status: { not: "DRAFT" }, OR: doors },
    ],
  };
}

export type MeetingRef = {
  organizerMemberId: string;
  status: MeetingStatus;
  minutesStatus: MinutesStatus;
  visibility: MeetingVisibility;
  departmentId: string | null;
  archivedAt: Date | null;
  participants: Array<{ memberId: string; role: MeetingParticipantRole }>;
};

export function myRole(context: UserContext, meeting: Pick<MeetingRef, "organizerMemberId" | "participants">): MeetingParticipantRole | null {
  if (meeting.organizerMemberId === context.membershipId) return "ORGANIZER";
  return meeting.participants.find((row) => row.memberId === context.membershipId)?.role ?? null;
}

const LIVE: MeetingStatus[] = ["DRAFT", "SCHEDULED", "IN_PROGRESS"];
const HELD: MeetingStatus[] = ["IN_PROGRESS", "COMPLETED"];

function active(context: UserContext, meeting: MeetingRef): boolean {
  return meeting.archivedAt === null && canAccessModule(context, "meetings");
}

function manager(context: UserContext): boolean {
  return can(context, "meeting.manage");
}

/** Title, time, place, visibility. After completion only a manager corrects the record (PRD #40 §249). */
export function canEditMeeting(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || meeting.status === "CANCELLED") return false;
  if (meeting.status === "COMPLETED") return manager(context) && meeting.minutesStatus === "DRAFT";
  return manager(context) || (myRole(context, meeting) === "ORGANIZER" && can(context, "meeting.edit"));
}

export function canCancelMeeting(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || !LIVE.includes(meeting.status)) return false;
  return manager(context) || (myRole(context, meeting) === "ORGANIZER" && can(context, "meeting.cancel"));
}

/** Start and complete belong to whoever runs the room: organizer or chair. */
export function canRunMeeting(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting)) return false;
  const role = myRole(context, meeting);
  return manager(context) || ((role === "ORGANIZER" || role === "CHAIR") && can(context, "meeting.edit"));
}

export function canManageParticipants(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || meeting.status === "CANCELLED") return false;
  if (meeting.status === "COMPLETED") return manager(context) && meeting.minutesStatus === "DRAFT";
  return manager(context) || (myRole(context, meeting) === "ORGANIZER" && can(context, "meeting.manage_participants"));
}

export function canManageAgenda(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || !LIVE.includes(meeting.status)) return false;
  const role = myRole(context, meeting);
  return manager(context) || ((role === "ORGANIZER" || role === "CHAIR" || role === "SECRETARY") && can(context, "meeting.agenda.manage"));
}

function recorder(context: UserContext, meeting: MeetingRef): boolean {
  const role = myRole(context, meeting);
  return role === "ORGANIZER" || role === "SECRETARY";
}

/** Minutes are written from the day of the meeting until they are final (PRD #40 §45). */
export function canEditMinutes(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || meeting.minutesStatus !== "DRAFT") return false;
  if (meeting.status === "DRAFT" || meeting.status === "CANCELLED") return false;
  return can(context, "meeting.minutes.edit") && (manager(context) || recorder(context, meeting));
}

/** Only a finished meeting's minutes become the record (PRD #40 §46, §100). */
export function canFinalizeMinutes(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || meeting.minutesStatus !== "DRAFT" || meeting.status !== "COMPLETED") return false;
  return can(context, "meeting.minutes.finalize") && (manager(context) || recorder(context, meeting));
}

export function canReopenMinutes(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || meeting.minutesStatus !== "FINAL") return false;
  return can(context, "meeting.minutes.reopen");
}

/** Decisions and actions are what a meeting produces — once it is under way, and until the record is final. */
function capturing(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || !HELD.includes(meeting.status) || meeting.minutesStatus !== "DRAFT") return false;
  const role = myRole(context, meeting);
  return manager(context) || role === "ORGANIZER" || role === "CHAIR" || role === "SECRETARY";
}

export function canRecordDecision(context: UserContext, meeting: MeetingRef): boolean {
  return capturing(context, meeting) && can(context, "meeting.decision.create");
}

export function canCreateAction(context: UserContext, meeting: MeetingRef): boolean {
  return capturing(context, meeting) && can(context, "meeting.action.create");
}

/**
 * Following up actions outlives the minutes: status and task hand-off stay
 * open after the record is final (PRD #40 §309 "track actions afterward").
 */
export function canManageActions(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || !HELD.includes(meeting.status)) return false;
  const role = myRole(context, meeting);
  return can(context, "meeting.action.manage") && (manager(context) || role === "ORGANIZER" || role === "CHAIR" || role === "SECRETARY");
}

export function canConvertToTask(context: UserContext, meeting: MeetingRef): boolean {
  return (
    canManageActions(context, meeting) &&
    can(context, "meeting.action.convert_to_task") &&
    canAccessModule(context, "tasks") &&
    can(context, "task.create")
  );
}

/** Attendance is taken in the room, by whoever keeps the record (PRD #40 §114). */
export function canRecordAttendance(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || !HELD.includes(meeting.status) || meeting.minutesStatus !== "DRAFT") return false;
  return manager(context) || (recorder(context, meeting) && (can(context, "meeting.minutes.edit") || can(context, "meeting.edit")));
}

/**
 * A participant may always answer an invitation, even with read-only access
 * otherwise (PRD #40 §154, §283). The organizer does not reply to themselves.
 */
export function canRespond(context: UserContext, meeting: MeetingRef): boolean {
  if (!active(context, meeting) || (meeting.status !== "SCHEDULED" && meeting.status !== "IN_PROGRESS")) return false;
  const role = myRole(context, meeting);
  return role !== null && role !== "ORGANIZER";
}

export function canCreateMeeting(context: UserContext): boolean {
  return meetingsOpen(context) && can(context, "meeting.create");
}

/** A department meeting for another department is a manager's call. */
export function visibilityProblem(
  context: UserContext,
  input: { visibility: MeetingVisibility; departmentId?: string | null },
): string | null {
  if (input.visibility === "DEPARTMENT" && input.departmentId !== context.department?.id && !manager(context)) {
    return "You can hold department meetings only for your own department.";
  }
  return null;
}

export function meetingCapabilities(context: UserContext, meeting: MeetingRef): MeetingCapabilities {
  const running = canRunMeeting(context, meeting);
  const documentsOpen = canAccessModule(context, "documents") && can(context, "document.view") && can(context, "meeting.document.view");
  return {
    canEdit: canEditMeeting(context, meeting),
    canSchedule: meeting.status === "DRAFT" && canEditMeeting(context, meeting),
    canStart: running && meeting.status === "SCHEDULED",
    canComplete: running && meeting.status === "IN_PROGRESS",
    canCancel: canCancelMeeting(context, meeting),
    canDuplicate: canCreateMeeting(context),
    canManageParticipants: canManageParticipants(context, meeting),
    canTransferOrganizer: canManageParticipants(context, meeting),
    canManageAgenda: canManageAgenda(context, meeting),
    canEditMinutes: canEditMinutes(context, meeting),
    canFinalizeMinutes: canFinalizeMinutes(context, meeting),
    canReopenMinutes: canReopenMinutes(context, meeting),
    canRecordDecision: canRecordDecision(context, meeting),
    canCreateAction: canCreateAction(context, meeting),
    canManageActions: canManageActions(context, meeting),
    canConvertToTask: canConvertToTask(context, meeting),
    canRecordAttendance: canRecordAttendance(context, meeting),
    canRespond: canRespond(context, meeting),
    canViewDocuments: documentsOpen,
    canUploadDocuments:
      documentsOpen && meeting.archivedAt === null && meeting.status !== "CANCELLED" && can(context, "document.create") && can(context, "meeting.document.create"),
  };
}
