import type { CalendarEventType, CalendarVisibility, Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Who sees and changes a Calendar-owned event (PRD #39 §44, §49-§53).
 *
 *   PRIVATE           the creator, and anyone explicitly added
 *   SELECTED_MEMBERS  the creator and the people chosen
 *   PROJECT           everyone who can open the project, through project scope
 *   DEPARTMENT        members of that department
 *   COMPANY           everyone in the company
 *
 * Participation always grants sight of the event: inviting somebody is the act
 * of showing it to them. It grants nothing else — a participant cannot edit
 * the event, see the project, or invite others.
 *
 * Every rule is a database clause, so a list is filtered where it is queried
 * and never fetched wide and trimmed in memory (PRD #39 §14).
 */

/** Event types a whole company is told about: publishing them is a manager's job (PRD #39 §50). */
export const COMPANY_EVENT_TYPES: CalendarEventType[] = ["COMPANY_EVENT", "COMPANY_HOLIDAY", "OFFICE_CLOSURE"];

export function readableEventWhere(context: UserContext): Prisma.CalendarEventWhereInput {
  const doors: Prisma.CalendarEventWhereInput[] = [
    { createdByMemberId: context.membershipId },
    { participants: { some: { memberId: context.membershipId } } },
    { visibility: "COMPANY" },
  ];

  // A project event is exactly as visible as its project (PRD #39 §51).
  if (canAccessModule(context, "projects") && can(context, "project.view")) {
    doors.push({ visibility: "PROJECT", project: { is: buildProjectScopeWhere(context) } });
  }
  if (context.department) {
    doors.push({ visibility: "DEPARTMENT", departmentId: context.department.id });
  }

  return { companyId: context.companyId, OR: doors };
}

type EventRef = {
  createdByMemberId: string;
  visibility: CalendarVisibility;
  eventType: CalendarEventType;
  archivedAt: Date | null;
};

/** A company-wide event is governed by the company-event permission, whoever created it. */
export function isCompanyWide(event: Pick<EventRef, "visibility" | "eventType">): boolean {
  return event.visibility === "COMPANY" || COMPANY_EVENT_TYPES.includes(event.eventType);
}

export function canEditEvent(context: UserContext, event: EventRef): boolean {
  if (event.archivedAt || !canAccessModule(context, "calendar")) return false;
  if (isCompanyWide(event)) return can(context, "calendar.company_event.manage");
  if (event.createdByMemberId !== context.membershipId) return false;
  return can(context, "calendar.event.edit") && (event.visibility !== "PRIVATE" || can(context, "calendar.private_event.manage"));
}

export function canArchiveEvent(context: UserContext, event: EventRef): boolean {
  if (event.archivedAt || !canAccessModule(context, "calendar")) return false;
  if (isCompanyWide(event)) return can(context, "calendar.company_event.manage");
  if (event.createdByMemberId !== context.membershipId) return false;
  return can(context, "calendar.event.archive");
}

export type CreateCheck = { ok: true } | { ok: false; reason: string };

/** Whether this reader may create an event of this type and visibility (PRD #39 §43, §148). */
export function canCreateEvent(
  context: UserContext,
  input: { eventType: CalendarEventType; visibility: CalendarVisibility; departmentId?: string | null },
): CreateCheck {
  if (!canAccessModule(context, "calendar") || !can(context, "calendar.event.create")) {
    return { ok: false, reason: "You cannot create calendar events." };
  }
  if (isCompanyWide(input) && !can(context, "calendar.company_event.manage")) {
    return { ok: false, reason: "Only people who manage company events can publish one to the whole company." };
  }
  if (input.visibility === "PRIVATE" && !can(context, "calendar.private_event.manage")) {
    return { ok: false, reason: "You cannot keep private events." };
  }
  if (
    input.visibility === "DEPARTMENT" &&
    input.departmentId !== context.department?.id &&
    !can(context, "calendar.company_event.manage")
  ) {
    return { ok: false, reason: "You can publish department events only to your own department." };
  }
  return { ok: true };
}

/** The visibility a type starts with (PRD #39 §148). */
export function defaultVisibility(eventType: CalendarEventType): CalendarVisibility {
  switch (eventType) {
    case "PERSONAL_EVENT":
      return "PRIVATE";
    case "TEAM_EVENT":
      return "SELECTED_MEMBERS";
    case "INTERNAL_DEADLINE":
    case "TRAINING":
      return "DEPARTMENT";
    default:
      return "COMPANY";
  }
}
