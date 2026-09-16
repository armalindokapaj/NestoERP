import type { MeetingAttendanceStatus, MeetingResponseStatus } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { notifyInvited, notifyResponse } from "./meeting.notifications";
import { canManageParticipants, canRecordAttendance, canRespond } from "./meeting.permissions";
import { ENTITY, getMeeting, laterOccurrencesInReach, MODULE, RECORD, requireReadableMeeting, type MeetingDetailRow } from "./meeting.repository";
import { PARTICIPANTS_MAX } from "./meeting.schema";
import { requireMembers, type ParticipantInput } from "./meeting.service";
import type { MeetingDetailDTO } from "./meeting.types";

/**
 * Participants, replies and attendance (PRD #40 §18-§26, §112-§114, §132-§136).
 *
 * Only active members of the caller's company can be added — the check is on
 * the server, so a hand-written request cannot put somebody from another
 * company on a meeting (PRD #40 §232). A reply is always the caller's own.
 * The organizer is never removed, only replaced by an explicit transfer.
 */

/** The meeting's reminder offsets: those its organizer has. A person added later gets the same. */
async function reminderOffsets(meeting: Pick<MeetingDetailRow, "id" | "organizerMemberId">): Promise<number[]> {
  const rows = await prisma.calendarReminder.findMany({
    where: { meetingId: meeting.id, memberId: meeting.organizerMemberId },
    select: { minutesBefore: true },
  });
  return [...new Set(rows.map((row) => row.minutesBefore))];
}

/**
 * The later, still-to-happen meetings of the same series, for a "this and
 * later" change — only those whose people this caller could change one by one
 * (PRD #47 §20, §62). New occurrences copy the latest meeting's people, so a
 * later meeting out of reach keeps its own list.
 */
async function laterOccurrences(context: UserContext, meeting: MeetingDetailRow): Promise<string[]> {
  const later = await laterOccurrencesInReach(context, meeting, canManageParticipants);
  return later.meetings.map((row) => row.id);
}

export async function addParticipants(
  context: UserContext,
  meetingId: string,
  input: { participants: ParticipantInput[]; scope?: "THIS" | "FUTURE" },
): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (!canManageParticipants(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot change who is on this meeting.");

  const already = new Set(meeting.participants.map((row) => row.memberId));
  const wanted = input.participants.filter((participant, index, all) => all.findIndex((other) => other.memberId === participant.memberId) === index);
  const names = await requireMembers(context, wanted.map((participant) => participant.memberId));
  const added = wanted.filter((participant) => !already.has(participant.memberId));
  if (meeting.participants.length + added.length > PARTICIPANTS_MAX) {
    throw new AccessError("VALIDATION_ERROR", `A meeting can have at most ${PARTICIPANTS_MAX} participants.`, { code: "TOO_MANY_PARTICIPANTS" });
  }
  if (added.length === 0) return getMeeting(context, meetingId);

  const meetingIds = [meetingId, ...(input.scope === "FUTURE" ? await laterOccurrences(context, meeting) : [])];
  const offsets = await reminderOffsets(meeting);
  const invitedAt = meeting.status === "DRAFT" ? null : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.meetingParticipant.createMany({
      data: meetingIds.flatMap((id) =>
        added.map((participant) => ({
          meetingId: id,
          memberId: participant.memberId,
          companyId: context.companyId,
          role: participant.role,
          required: participant.required,
          displayName: names.get(participant.memberId)!,
          invitedAt,
        })),
      ),
      skipDuplicates: true,
    });
    if (offsets.length > 0) {
      await tx.calendarReminder.createMany({
        data: meetingIds.flatMap((id) =>
          added.flatMap((participant) => offsets.map((minutesBefore) => ({ companyId: context.companyId, meetingId: id, memberId: participant.memberId, minutesBefore }))),
        ),
        skipDuplicates: true,
      });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.MEETING_PARTICIPANT_ADDED,
        entity: { type: ENTITY, id: meetingId },
        projectId: meeting.projectId,
        metadata: { memberIds: added.map((participant) => participant.memberId), count: added.length },
      },
      { tx },
    );
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: meetingId,
      action: "MEETING_PARTICIPANT_ADDED",
      message: added.length === 1 ? `added ${names.get(added[0].memberId)}` : `added ${added.length} participants`,
    });
    if (meeting.status !== "DRAFT") await notifyInvited(tx, context, meeting, added.map((participant) => participant.memberId));
  });

  if (added.length <= 50) {
    await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: meetingId, memberIds: added.map((participant) => participant.memberId) });
  }
  return getMeeting(context, meetingId);
}

export async function updateParticipant(
  context: UserContext,
  meetingId: string,
  memberId: string,
  input: { role?: ParticipantInput["role"]; required?: boolean; attendance?: MeetingAttendanceStatus },
): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const participant = meeting.participants.find((row) => row.memberId === memberId);
  if (!participant) throw new AccessError("NOT_FOUND");

  if ((input.role !== undefined || input.required !== undefined) && !canManageParticipants(context, meeting)) {
    throw new AccessError("FORBIDDEN", "You cannot change who is on this meeting.");
  }
  if (input.attendance !== undefined && !canRecordAttendance(context, meeting)) {
    throw new AccessError("FORBIDDEN", "You cannot record attendance for this meeting.");
  }
  if (input.role !== undefined && participant.role === "ORGANIZER") {
    throw new AccessError("VALIDATION_ERROR", "Transfer the organizer role to someone else first.", { code: "ORGANIZER_ROLE_FIXED" });
  }

  await prisma.meetingParticipant.update({
    where: { meetingId_memberId: { meetingId, memberId } },
    data: {
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.attendance !== undefined ? { attendance: input.attendance } : {}),
    },
  });
  return getMeeting(context, meetingId);
}

export async function removeParticipant(context: UserContext, meetingId: string, memberId: string, scope: "THIS" | "FUTURE" = "THIS"): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (!canManageParticipants(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot change who is on this meeting.");
  const participant = meeting.participants.find((row) => row.memberId === memberId);
  if (!participant) throw new AccessError("NOT_FOUND");
  if (participant.role === "ORGANIZER" || meeting.organizerMemberId === memberId) {
    throw new AccessError("CONFLICT", "The organizer cannot be removed. Transfer the organizer role first.", { code: "ORGANIZER_NOT_REMOVABLE" });
  }

  const meetingIds = [meetingId, ...(scope === "FUTURE" ? await laterOccurrences(context, meeting) : [])];
  await prisma.$transaction(async (tx) => {
    await tx.meetingParticipant.deleteMany({ where: { meetingId: { in: meetingIds }, memberId, role: { not: "ORGANIZER" } } });
    await tx.calendarReminder.deleteMany({ where: { meetingId: { in: meetingIds }, memberId } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.MEETING_PARTICIPANT_REMOVED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { memberId } },
      { tx },
    );
  });
  return getMeeting(context, meetingId);
}

/**
 * RSVP (PRD #40 §132, §133, §163). Reauthorised on every call: the caller must
 * still be on the meeting, and may answer only for themselves. Declining keeps
 * them on it (PRD #40 §256).
 */
export async function respondToMeeting(context: UserContext, meetingId: string, response: Exclude<MeetingResponseStatus, "PENDING">): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  const mine = meeting.participants.find((row) => row.memberId === context.membershipId);
  if (!mine) throw new AccessError("NOT_FOUND", "You are not on this meeting.");
  if (!canRespond(context, meeting)) throw new AccessError("CONFLICT", "This meeting no longer takes replies.", { code: "RESPONSE_CLOSED" });
  if (mine.response === response) return getMeeting(context, meetingId);

  await prisma.$transaction(async (tx) => {
    await tx.meetingParticipant.update({
      where: { meetingId_memberId: { meetingId, memberId: context.membershipId } },
      data: { response, respondedAt: new Date() },
    });
    await notifyResponse(tx, context, meeting, response);
  });
  incrementCounter(Metric.MEETING_RSVP, { response: response.toLowerCase() });
  return getMeeting(context, meetingId);
}

/**
 * Organizer transfer (PRD #40 §136, §180): an explicit, audited command, to an
 * active member of the same company who can open meetings. The previous
 * organizer stays on as an attendee.
 */
export async function transferOrganizer(context: UserContext, meetingId: string, memberId: string): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (!canManageParticipants(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot change who organizes this meeting.");
  if (memberId === meeting.organizerMemberId) throw new AccessError("CONFLICT", "That person already organizes this meeting.");

  const names = await requireMembers(context, [memberId], "memberId");
  const target = (await buildMemberContexts(context.companyId, [memberId])).get(memberId);
  if (!target || !canAccessModule(target, "meetings") || !can(target, "meeting.view")) {
    throw new AccessError("VALIDATION_ERROR", "That person cannot open meetings, so they cannot organize one.", { memberId: ["That person cannot open meetings."], code: "ORGANIZER_NOT_ALLOWED" });
  }
  const previous = meeting.organizerMemberId;
  const offsets = await reminderOffsets(meeting);

  await prisma.$transaction(async (tx) => {
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, organizerMemberId: previous, archivedAt: null },
      data: { organizerMemberId: memberId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "This meeting has just changed. Reload it.");
    await tx.meetingParticipant.updateMany({ where: { meetingId, memberId: previous }, data: { role: "ATTENDEE" } });
    await tx.meetingParticipant.upsert({
      where: { meetingId_memberId: { meetingId, memberId } },
      update: { role: "ORGANIZER", response: "ACCEPTED", respondedAt: new Date() },
      create: { meetingId, memberId, companyId: context.companyId, role: "ORGANIZER", response: "ACCEPTED", displayName: names.get(memberId)!, invitedAt: new Date(), respondedAt: new Date() },
    });
    if (offsets.length > 0) {
      await tx.calendarReminder.createMany({
        data: offsets.map((minutesBefore) => ({ companyId: context.companyId, meetingId, memberId, minutesBefore })),
        skipDuplicates: true,
      });
    }
    await recordUserAction(
      context,
      { actionKey: AuditAction.MEETING_ORGANIZER_CHANGED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { from: previous, to: memberId } },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_ORGANIZER_CHANGED", message: `handed the meeting to ${names.get(memberId)}` });
    if (!meeting.participants.some((row) => row.memberId === memberId) && meeting.status !== "DRAFT") {
      await notifyInvited(tx, context, meeting, [memberId]);
    }
  });

  await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: meetingId, memberIds: [memberId] });
  return getMeeting(context, meetingId);
}
