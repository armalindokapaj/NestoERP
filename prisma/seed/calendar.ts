import type { PrismaClient } from "@prisma/client";

import { serializeRecurrence } from "../../lib/modules/calendar/calendar.recurrence";
import { addLocalDays, instantFromLocal, localDate, localWeekday, startOfLocalDay } from "../../lib/modules/calendar/calendar.time";
import type { SeedMembers } from "./constants";

/**
 * Calendar demo data (PRD #39 §200): a company holiday, a training, a weekly
 * project meeting, a team sync and a private personal event — dated relative to
 * the day the seed runs, so the calendar is never empty on the first visit.
 * Source-module dates (tasks, contracts, permits…) come from those modules.
 */
type Members = SeedMembers;

export async function seedCalendarRecords(prisma: PrismaClient, members: Members) {
  const zoneA = "Europe/Tirane";
  const zoneB = "Europe/Berlin";
  const today = localDate(new Date(), zoneA);
  const owner = members.get("user_owner")!;
  const pm = members.get("user_pm")!;
  const engineer = members.get("user_engineer")!;
  const architect = members.get("user_architect")!;
  const legal = members.get("user_legal")!;
  const finance = members.get("user_finance")!;
  const ownerB = members.get("user_owner_b");

  // Next Monday on or after today, for a series that has already begun.
  const weekday = localWeekday(startOfLocalDay(today, zoneA), zoneA);
  const lastMonday = addLocalDays(today, -(weekday - 1));

  const timed = (date: string, from: string, to: string, zone = zoneA) => ({
    startsAt: instantFromLocal(date, from, zone),
    endsAt: instantFromLocal(date, to, zone),
    allDay: false,
    timezone: zone,
  });
  const allDay = (date: string, zone = zoneA) => ({
    startsAt: startOfLocalDay(date, zone),
    endsAt: startOfLocalDay(addLocalDays(date, 1), zone),
    allDay: true,
    timezone: zone,
  });

  const events = [
    {
      id: "calendar_holiday_001",
      companyId: "company_demo_a",
      createdByMemberId: owner,
      title: "Founders' Day — office closed",
      eventType: "COMPANY_HOLIDAY" as const,
      visibility: "COMPANY" as const,
      ...allDay(addLocalDays(today, 9)),
    },
    {
      id: "calendar_training_001",
      companyId: "company_demo_a",
      createdByMemberId: owner,
      title: "Working at height refresher",
      description: "Mandatory for everyone who goes on site. Harnesses provided.",
      location: "Training room, head office",
      eventType: "TRAINING" as const,
      visibility: "COMPANY" as const,
      ...timed(addLocalDays(today, 2), "10:00", "12:00"),
    },
    {
      id: "calendar_project_001",
      companyId: "company_demo_a",
      createdByMemberId: pm,
      title: "Riverside coordination meeting",
      location: "Site cabin 2",
      eventType: "TEAM_EVENT" as const,
      visibility: "PROJECT" as const,
      projectId: "project_a",
      recurrenceRule: serializeRecurrence({ frequency: "WEEKLY", interval: 1, byDay: ["MO"] }),
      ...timed(lastMonday, "09:00", "10:00"),
      participants: [engineer, architect],
    },
    {
      id: "calendar_team_001",
      companyId: "company_demo_a",
      createdByMemberId: legal,
      title: "Contract cash-flow sync",
      eventType: "TEAM_EVENT" as const,
      visibility: "SELECTED_MEMBERS" as const,
      ...timed(addLocalDays(today, 1), "14:00", "14:45"),
      participants: [finance],
    },
    {
      id: "calendar_personal_001",
      companyId: "company_demo_a",
      createdByMemberId: engineer,
      title: "Dentist appointment",
      eventType: "PERSONAL_EVENT" as const,
      visibility: "PRIVATE" as const,
      ...timed(addLocalDays(today, 1), "16:00", "17:00"),
      reminderMinutes: 30,
    },
    ...(ownerB
      ? [
          {
            id: "calendar_b_holiday_001",
            companyId: "company_fixture_tenant",
            createdByMemberId: ownerB,
            title: "Company B works holiday",
            eventType: "COMPANY_HOLIDAY" as const,
            visibility: "COMPANY" as const,
            ...allDay(addLocalDays(localDate(new Date(), zoneB), 3), zoneB),
          },
        ]
      : []),
  ];

  for (const { participants, reminderMinutes, ...event } of events as Array<(typeof events)[number] & { participants?: string[]; reminderMinutes?: number }>) {
    await prisma.calendarEvent.upsert({
      where: { id: event.id },
      update: { ...event, archivedAt: null },
      create: event,
    });
    for (const memberId of participants ?? []) {
      await prisma.calendarEventParticipant.upsert({
        where: { eventId_memberId: { eventId: event.id, memberId } },
        update: {},
        create: { eventId: event.id, memberId, companyId: event.companyId, status: "ACCEPTED", addedByMemberId: event.createdByMemberId },
      });
    }
    if (reminderMinutes !== undefined) {
      await prisma.calendarReminder.upsert({
        where: { eventId_memberId_minutesBefore_channel: { eventId: event.id, memberId: event.createdByMemberId, minutesBefore: reminderMinutes, channel: "IN_APP" } },
        update: {},
        create: { companyId: event.companyId, eventId: event.id, memberId: event.createdByMemberId, minutesBefore: reminderMinutes },
      });
    }
  }

  return { events: events.length };
}
