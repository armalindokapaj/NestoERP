import { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { canRecordDecision } from "./meeting.permissions";
import { ENTITY, getMeeting, MODULE, requireReadableMeeting } from "./meeting.repository";
import { decisionLabel, type MeetingDetailDTO } from "./meeting.types";

/**
 * Decisions (PRD #40 §50-§52, §105, §167, §214).
 *
 * What was agreed — numbered per meeting, D-01 onwards, and never a task by
 * itself. Editable while the minutes are a draft; "deleting" one archives it,
 * and its number is not reused, so a D-03 quoted in an email stays D-03.
 */

async function capturable(context: UserContext, meetingId: string) {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (meeting.minutesStatus === "FINAL") {
    throw new AccessError("CONFLICT", "These minutes are final. Reopen them to change a decision.", { code: "MINUTES_FINAL" });
  }
  if (!canRecordDecision(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot record decisions on this meeting.");
  return meeting;
}

export async function recordDecision(context: UserContext, meetingId: string, input: { title: string; description: string | null }): Promise<MeetingDetailDTO> {
  const meeting = await capturable(context, meetingId);

  // Two people recording at once race for the same number; the unique index
  // settles it and the loser simply takes the next one.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const last = await tx.meetingDecision.aggregate({ where: { meetingId }, _max: { decisionNumber: true } });
        const decisionNumber = (last._max.decisionNumber ?? 0) + 1;
        const decision = await tx.meetingDecision.create({
          data: {
            companyId: context.companyId,
            meetingId,
            decisionNumber,
            title: input.title,
            description: input.description,
            decidedAt: new Date(),
            recordedByMemberId: context.membershipId,
          },
          select: { id: true },
        });
        await recordUserAction(
          context,
          { actionKey: AuditAction.MEETING_DECISION_CREATED, entity: { type: ENTITY, id: meetingId }, projectId: meeting.projectId, metadata: { decisionNumber } },
          { tx },
        );
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: meetingId,
          action: "MEETING_DECISION_CREATED",
          message: `recorded decision ${decisionLabel(decisionNumber)}`,
          metadata: { decisionId: decision.id },
        });
      });
      return getMeeting(context, meetingId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw new AccessError("CONFLICT", "The decision could not be numbered. Try again.");
}

export async function updateDecision(
  context: UserContext,
  meetingId: string,
  decisionId: string,
  input: { title?: string; description?: string | null },
): Promise<MeetingDetailDTO> {
  const meeting = await capturable(context, meetingId);
  if (!meeting.decisions.some((decision) => decision.id === decisionId)) throw new AccessError("NOT_FOUND");
  await prisma.meetingDecision.update({
    where: { id: decisionId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getMeeting(context, meetingId);
}

export async function archiveDecision(context: UserContext, meetingId: string, decisionId: string): Promise<MeetingDetailDTO> {
  const meeting = await capturable(context, meetingId);
  if (!meeting.decisions.some((decision) => decision.id === decisionId)) throw new AccessError("NOT_FOUND");
  await prisma.meetingDecision.update({ where: { id: decisionId }, data: { archivedAt: new Date() } });
  return getMeeting(context, meetingId);
}
