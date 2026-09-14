import type { MeetingAgendaItemStatus } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { canManageAgenda } from "./meeting.permissions";
import { getMeeting, requireReadableMeeting } from "./meeting.repository";
import { AGENDA_ITEMS_MAX } from "./meeting.schema";
import { requireMembers } from "./meeting.service";
import { AGENDA_TEMPLATES, type MeetingDetailDTO } from "./meeting.types";

/**
 * The agenda (PRD #40 §34-§40, §96, §103, §104, §219).
 *
 * Structured topics prepared before the meeting and ticked off during it.
 * Order is a server-kept integer; a reorder must name every item exactly once,
 * so a stale screen cannot drop one. No activity is written for agenda edits
 * or reorders — that would be noise (PRD #40 §184).
 */

type AgendaInput = {
  title: string;
  description: string | null;
  presenterMemberId?: string | null;
  plannedMinutes?: number | null;
};

async function editableMeeting(context: UserContext, meetingId: string) {
  const meeting = await requireReadableMeeting(context, meetingId);
  if (!canManageAgenda(context, meeting)) throw new AccessError("FORBIDDEN", "You cannot change this agenda.");
  return meeting;
}

async function requirePresenter(context: UserContext, presenterMemberId: string | null | undefined): Promise<string | null | undefined> {
  if (presenterMemberId === undefined) return undefined;
  if (presenterMemberId === null || presenterMemberId === "") return null;
  await requireMembers(context, [presenterMemberId], "presenterMemberId");
  return presenterMemberId;
}

export async function addAgendaItem(context: UserContext, meetingId: string, input: AgendaInput): Promise<MeetingDetailDTO> {
  const meeting = await editableMeeting(context, meetingId);
  if (meeting.agendaItems.length >= AGENDA_ITEMS_MAX) {
    throw new AccessError("VALIDATION_ERROR", `An agenda can have at most ${AGENDA_ITEMS_MAX} items.`, { code: "TOO_MANY_AGENDA_ITEMS" });
  }
  const presenterMemberId = await requirePresenter(context, input.presenterMemberId);
  const last = meeting.agendaItems.at(-1)?.sortOrder ?? -1;
  await prisma.meetingAgendaItem.create({
    data: {
      companyId: context.companyId,
      meetingId,
      sortOrder: last + 1,
      title: input.title,
      description: input.description,
      presenterMemberId: presenterMemberId ?? null,
      plannedMinutes: input.plannedMinutes ?? null,
    },
  });
  return getMeeting(context, meetingId);
}

export async function updateAgendaItem(
  context: UserContext,
  meetingId: string,
  itemId: string,
  input: Partial<AgendaInput> & { status?: MeetingAgendaItemStatus },
): Promise<MeetingDetailDTO> {
  const meeting = await editableMeeting(context, meetingId);
  if (!meeting.agendaItems.some((item) => item.id === itemId)) throw new AccessError("NOT_FOUND");
  // Ticking items off belongs to the meeting itself (PRD #40 §103).
  if (input.status !== undefined && input.status !== "PENDING" && meeting.status !== "IN_PROGRESS" && meeting.status !== "COMPLETED") {
    throw new AccessError("CONFLICT", "Mark agenda items once the meeting has started.", { code: "MEETING_NOT_STARTED" });
  }
  const presenterMemberId = await requirePresenter(context, input.presenterMemberId);
  await prisma.meetingAgendaItem.update({
    where: { id: itemId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(presenterMemberId !== undefined ? { presenterMemberId } : {}),
      ...(input.plannedMinutes !== undefined ? { plannedMinutes: input.plannedMinutes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  return getMeeting(context, meetingId);
}

export async function deleteAgendaItem(context: UserContext, meetingId: string, itemId: string): Promise<MeetingDetailDTO> {
  const meeting = await editableMeeting(context, meetingId);
  if (!meeting.agendaItems.some((item) => item.id === itemId)) throw new AccessError("NOT_FOUND");
  await prisma.meetingAgendaItem.delete({ where: { id: itemId } });
  return getMeeting(context, meetingId);
}

export async function reorderAgenda(context: UserContext, meetingId: string, itemIds: string[]): Promise<MeetingDetailDTO> {
  const meeting = await editableMeeting(context, meetingId);
  const current = meeting.agendaItems.map((item) => item.id);
  const same = itemIds.length === current.length && new Set(itemIds).size === itemIds.length && itemIds.every((id) => current.includes(id));
  if (!same) {
    throw new AccessError("CONFLICT", "The agenda has changed since you opened it. Reload and try again.", { code: "AGENDA_CHANGED" });
  }
  await prisma.$transaction(itemIds.map((id, sortOrder) => prisma.meetingAgendaItem.update({ where: { id }, data: { sortOrder } })));
  return getMeeting(context, meetingId);
}

/** Appends a static template's items (PRD #40 §38, §39). */
export async function applyAgendaTemplate(context: UserContext, meetingId: string, templateKey: string): Promise<MeetingDetailDTO> {
  const meeting = await editableMeeting(context, meetingId);
  const template = AGENDA_TEMPLATES.find((candidate) => candidate.key === templateKey);
  if (!template) throw new AccessError("VALIDATION_ERROR", "Choose one of the agenda templates.", { template: ["Choose one of the agenda templates."] });
  if (meeting.agendaItems.length + template.items.length > AGENDA_ITEMS_MAX) {
    throw new AccessError("VALIDATION_ERROR", `An agenda can have at most ${AGENDA_ITEMS_MAX} items.`, { code: "TOO_MANY_AGENDA_ITEMS" });
  }
  const start = (meeting.agendaItems.at(-1)?.sortOrder ?? -1) + 1;
  await prisma.meetingAgendaItem.createMany({
    data: template.items.map((item, index) => ({
      companyId: context.companyId,
      meetingId,
      sortOrder: start + index,
      title: item.title,
      plannedMinutes: item.plannedMinutes ?? null,
    })),
  });
  return getMeeting(context, meetingId);
}
