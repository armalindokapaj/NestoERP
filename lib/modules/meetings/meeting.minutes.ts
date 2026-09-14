import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { notifyMinutesFinalized } from "./meeting.notifications";
import { canEditMinutes, canFinalizeMinutes, canReopenMinutes } from "./meeting.permissions";
import { ENTITY, getMeeting, MODULE, requireReadableMeeting } from "./meeting.repository";
import { MINUTES_SECTIONS_MAX } from "./meeting.schema";
import type { MeetingDetailDTO } from "./meeting.types";

/**
 * Minutes (PRD #40 §42-§49, §108-§110, §235, §236, §250).
 *
 * The formal record, section by section, in plain text: nothing here is ever
 * rendered as HTML (PRD #40 §108, §237). A final record is locked; the only
 * way back is an explicit, audited reopen with a reason, after which it is
 * finalized again. The audit trail holds ids and counts, never the text
 * (PRD #40 §182).
 */

async function draftMinutes(context: UserContext, meetingId: string) {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus === "FINAL") {
    throw new AccessError("CONFLICT", "These minutes are final. Reopen them to make a change.", { code: "MINUTES_FINAL" });
  }
  if (!canEditMinutes(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot edit these minutes.");
  return meeting;
}

export async function addMinutesSection(context: UserContext, meetingId: string, input: { title: string; body: string }): Promise<MeetingDetailDTO> {
  const meeting = await draftMinutes(context, meetingId);
  if (meeting.minutesSections.length >= MINUTES_SECTIONS_MAX) {
    throw new AccessError("VALIDATION_ERROR", `Minutes can have at most ${MINUTES_SECTIONS_MAX} sections.`, { code: "TOO_MANY_SECTIONS" });
  }
  await prisma.meetingMinutesSection.create({
    data: {
      companyId: context.companyId,
      meetingId,
      sortOrder: (meeting.minutesSections.at(-1)?.sortOrder ?? -1) + 1,
      title: input.title,
      body: input.body,
      createdByMemberId: context.membershipId,
    },
  });
  return getMeeting(context, meetingId);
}

export async function updateMinutesSection(
  context: UserContext,
  meetingId: string,
  sectionId: string,
  input: { title?: string; body?: string },
): Promise<MeetingDetailDTO> {
  const meeting = await draftMinutes(context, meetingId);
  if (!meeting.minutesSections.some((section) => section.id === sectionId)) throw new AccessError("NOT_FOUND");
  // The status in the where clause closes the gap between the read above and a finalize in between.
  const result = await prisma.meetingMinutesSection.updateMany({
    where: { id: sectionId, meetingId, meeting: { minutesStatus: "DRAFT" } },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      updatedByMemberId: context.membershipId,
    },
  });
  if (result.count === 0) throw new AccessError("CONFLICT", "These minutes are final. Reopen them to make a change.", { code: "MINUTES_FINAL" });
  return getMeeting(context, meetingId);
}

export async function deleteMinutesSection(context: UserContext, meetingId: string, sectionId: string): Promise<MeetingDetailDTO> {
  const meeting = await draftMinutes(context, meetingId);
  if (!meeting.minutesSections.some((section) => section.id === sectionId)) throw new AccessError("NOT_FOUND");
  const result = await prisma.meetingMinutesSection.deleteMany({ where: { id: sectionId, meetingId, meeting: { minutesStatus: "DRAFT" } } });
  if (result.count === 0) throw new AccessError("CONFLICT", "These minutes are final. Reopen them to make a change.", { code: "MINUTES_FINAL" });
  return getMeeting(context, meetingId);
}

/** Finalize (PRD #40 §46, §48, §180): freeze, stamp, audit, tell the participants. */
export async function finalizeMinutes(context: UserContext, meetingId: string): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus === "FINAL") throw new AccessError("CONFLICT", "These minutes are already final.", { code: "MINUTES_FINAL" });
  if (meeting.status !== "COMPLETED") {
    throw new AccessError("CONFLICT", "Complete the meeting before finalizing its minutes.", { code: "MEETING_NOT_COMPLETED" });
  }
  if (!canFinalizeMinutes(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot finalize these minutes.");
  if (!meeting.minutesSections.some((section) => section.body.trim().length > 0)) {
    throw new AccessError("VALIDATION_ERROR", "Write at least one section of minutes before finalizing.", { code: "MINUTES_EMPTY" });
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, minutesStatus: "DRAFT", status: "COMPLETED", archivedAt: null },
      data: { minutesStatus: "FINAL", minutesFinalizedAt: new Date(), minutesFinalizedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "These minutes have just changed. Reload them.", { code: "MINUTES_FINAL" });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.MEETING_MINUTES_FINALIZED,
        entity: { type: ENTITY, id: meetingId, label: meeting.visibility === "PARTICIPANTS" ? undefined : meeting.title },
        projectId: meeting.projectId,
        metadata: { sections: meeting.minutesSections.length, decisions: meeting.decisions.length, actions: meeting.actionItems.length },
      },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_MINUTES_FINALIZED", message: "finalized the minutes" });
    await notifyMinutesFinalized(
      tx,
      context,
      meeting,
      meeting.participants.map((participant) => participant.memberId),
    );
  });
  incrementCounter(Metric.MEETING_MINUTES_FINALIZE);
  return getMeeting(context, meetingId);
}

/** Reopen (PRD #40 §47, §250): a reason, an audit entry, and the record is a draft again. */
export async function reopenMinutes(context: UserContext, meetingId: string, reason: string): Promise<MeetingDetailDTO> {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus !== "FINAL") throw new AccessError("CONFLICT", "These minutes are not final.", { code: "MINUTES_NOT_FINAL" });
  if (!canReopenMinutes(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot reopen these minutes.");

  await prisma.$transaction(async (tx) => {
    const result = await tx.meeting.updateMany({
      where: { id: meetingId, minutesStatus: "FINAL", archivedAt: null },
      data: { minutesStatus: "DRAFT", minutesFinalizedAt: null, minutesFinalizedByMemberId: null, version: { increment: 1 } },
    });
    if (result.count === 0) throw new AccessError("CONFLICT", "These minutes have just changed. Reload them.");
    await recordUserAction(
      context,
      { actionKey: AuditAction.MEETING_MINUTES_REOPENED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { reason: reason.slice(0, 500) } },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: ENTITY, entityId: meetingId, action: "MEETING_MINUTES_REOPENED", message: "reopened the minutes" });
  });
  return getMeeting(context, meetingId);
}
