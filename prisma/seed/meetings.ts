import type { MeetingParticipantRole, PrismaClient } from "@prisma/client";

import { serializeRecurrence } from "../../lib/modules/calendar/calendar.recurrence";
import { addLocalDays, instantFromLocal, localDate } from "../../lib/modules/calendar/calendar.time";
import { AGENDA_TEMPLATES } from "../../lib/modules/meetings/meeting.types";

/**
 * Meetings demo data (PRD #40 §306): a weekly project coordination series with
 * last week's meeting held, minuted and final; a management meeting; a QA/QC
 * coordination; and one meeting in Company B, so isolation has something to
 * refuse. Dated relative to the day the seed runs.
 */
type Members = Map<string, string>;

const COMPANY_A = "company_demo_a";
const COMPANY_B = "company_demo_b";

export async function seedMeetingRecords(prisma: PrismaClient, members: Members) {
  const zone = "Europe/Tirane";
  const today = localDate(new Date(), zone);
  const id = (user: string) => members.get(user)!;
  const names = new Map(
    (await prisma.companyMember.findMany({ select: { id: true, user: { select: { firstName: true, lastName: true } } } })).map((row) => [row.id, `${row.user.firstName} ${row.user.lastName}`]),
  );
  const timed = (date: string, from: string, to: string, tz = zone) => ({ startsAt: instantFromLocal(date, from, tz), endsAt: instantFromLocal(date, to, tz), timezone: tz });
  const template = (key: string) => AGENDA_TEMPLATES.find((row) => row.key === key)!.items;

  const pm = id("user_pm");
  const owner = id("user_owner");

  /* Weekly coordination series ------------------------------------------- */

  const seriesId = "meeting_series_riverside";
  const firstDate = addLocalDays(today, -7);
  const WEEKS = 12;
  const first = timed(firstDate, "09:30", "10:30");
  await prisma.meetingSeries.upsert({
    where: { id: seriesId },
    update: { firstStartsAt: first.startsAt, generatedUntil: instantFromLocal(addLocalDays(firstDate, 7 * WEEKS), "09:30", zone), cancelledAt: null },
    create: {
      id: seriesId,
      companyId: COMPANY_A,
      createdByMemberId: pm,
      title: "Riverside weekly coordination",
      description: "Design, site, procurement, QA/QC and HSE in one room, once a week.",
      meetingType: "COORDINATION",
      projectId: "project_a",
      visibility: "PROJECT",
      locationType: "IN_PERSON",
      locationText: "Site cabin 2",
      firstStartsAt: first.startsAt,
      durationMinutes: 60,
      timezone: zone,
      recurrenceRule: serializeRecurrence({ frequency: "WEEKLY", interval: 1 }),
      generatedUntil: instantFromLocal(addLocalDays(firstDate, 7 * WEEKS), "09:30", zone),
    },
  });

  type Seat = { memberId: string; role: MeetingParticipantRole; response?: "ACCEPTED" | "TENTATIVE" | "DECLINED" | "PENDING"; attendance?: "PRESENT" | "ABSENT" | "EXCUSED" | "UNKNOWN" };
  const riversideSeats: Seat[] = [
    { memberId: pm, role: "ORGANIZER", response: "ACCEPTED" },
    { memberId: id("user_architect"), role: "ATTENDEE", response: "ACCEPTED" },
    { memberId: id("user_engineer"), role: "SECRETARY", response: "ACCEPTED" },
    { memberId: id("user_qaqc"), role: "ATTENDEE", response: "TENTATIVE" },
    { memberId: id("user_hse"), role: "OBSERVER", response: "PENDING" },
  ];

  type MeetingSeed = {
    id: string;
    companyId: string;
    projectId: string | null;
    organizer: string;
    title: string;
    description?: string;
    meetingType: "COORDINATION" | "MANAGEMENT" | "QA_QC" | "INTERNAL";
    visibility: "PARTICIPANTS" | "PROJECT" | "COMPANY";
    status: "SCHEDULED" | "COMPLETED";
    times: { startsAt: Date; endsAt: Date; timezone: string };
    locationType: "IN_PERSON" | "ONLINE" | "HYBRID";
    locationText?: string;
    onlineUrl?: string;
    seriesId?: string;
    occurrenceIndex?: number;
    seats: Seat[];
    agenda: Array<{ title: string; plannedMinutes?: number }>;
    held?: boolean;
  };

  const meetings: MeetingSeed[] = [];
  for (let week = 0; week <= WEEKS; week += 1) {
    const held = week === 0;
    meetings.push({
      id: `meeting_riverside_${String(week).padStart(3, "0")}`,
      companyId: COMPANY_A,
      projectId: "project_a",
      organizer: pm,
      title: "Riverside weekly coordination",
      description: "Design, site, procurement, QA/QC and HSE in one room, once a week.",
      meetingType: "COORDINATION",
      visibility: "PROJECT",
      status: held ? "COMPLETED" : "SCHEDULED",
      times: timed(addLocalDays(firstDate, 7 * week), "09:30", "10:30"),
      locationType: "IN_PERSON",
      locationText: "Site cabin 2",
      seriesId,
      occurrenceIndex: week,
      seats: held ? riversideSeats.map((seat) => ({ ...seat, attendance: seat.role === "OBSERVER" ? "EXCUSED" : "PRESENT" })) : riversideSeats,
      agenda: template("project-coordination"),
      held,
    });
  }

  meetings.push(
    {
      id: "meeting_management_001",
      companyId: COMPANY_A,
      projectId: null,
      organizer: owner,
      title: "Monthly management review",
      description: "Portfolio, cash and people — and the decisions that need the leadership team.",
      meetingType: "MANAGEMENT",
      visibility: "PARTICIPANTS",
      status: "SCHEDULED",
      times: timed(addLocalDays(today, 3), "15:00", "16:30"),
      locationType: "HYBRID",
      locationText: "Board room",
      onlineUrl: "https://meet.example.com/nesto-management",
      seats: [
        { memberId: owner, role: "ORGANIZER", response: "ACCEPTED" },
        { memberId: id("user_ceo"), role: "CHAIR", response: "ACCEPTED" },
        { memberId: id("user_finance"), role: "ATTENDEE", response: "PENDING" },
        { memberId: id("user_hr"), role: "SECRETARY", response: "ACCEPTED" },
      ],
      agenda: template("management"),
    },
    {
      id: "meeting_qaqc_001",
      companyId: COMPANY_A,
      projectId: "project_b",
      organizer: id("user_qaqc"),
      title: "QA/QC coordination — Central Office Tower",
      meetingType: "QA_QC",
      visibility: "PROJECT",
      status: "SCHEDULED",
      times: timed(addLocalDays(today, 1), "11:00", "11:45"),
      locationType: "ONLINE",
      onlineUrl: "https://meet.example.com/nesto-qaqc",
      seats: [
        { memberId: id("user_qaqc"), role: "ORGANIZER", response: "ACCEPTED" },
        { memberId: pm, role: "ATTENDEE", response: "PENDING" },
        { memberId: id("user_hse"), role: "ATTENDEE", response: "ACCEPTED" },
      ],
      agenda: template("qa-qc"),
    },
  );

  const ownerB = members.get("user_owner_b");
  if (ownerB) {
    meetings.push({
      id: "meeting_b_001",
      companyId: COMPANY_B,
      projectId: null,
      organizer: ownerB,
      title: "Company B leadership sync",
      meetingType: "INTERNAL",
      visibility: "COMPANY",
      status: "SCHEDULED",
      times: timed(addLocalDays(localDate(new Date(), "Europe/Berlin"), 2), "10:00", "11:00", "Europe/Berlin"),
      locationType: "IN_PERSON",
      locationText: "Berlin office",
      seats: [{ memberId: ownerB, role: "ORGANIZER", response: "ACCEPTED" }],
      agenda: template("general"),
    });
  }

  for (const meeting of meetings) {
    const now = new Date();
    const data = {
      companyId: meeting.companyId,
      projectId: meeting.projectId,
      createdByMemberId: meeting.organizer,
      organizerMemberId: meeting.organizer,
      title: meeting.title,
      description: meeting.description ?? null,
      meetingType: meeting.meetingType,
      status: meeting.status,
      ...meeting.times,
      locationType: meeting.locationType,
      locationText: meeting.locationText ?? null,
      onlineUrl: meeting.onlineUrl ?? null,
      visibility: meeting.visibility,
      seriesId: meeting.seriesId ?? null,
      occurrenceIndex: meeting.occurrenceIndex ?? null,
      startedAt: meeting.held ? meeting.times.startsAt : null,
      completedAt: meeting.held ? meeting.times.endsAt : null,
      minutesStatus: meeting.held ? ("FINAL" as const) : ("DRAFT" as const),
      minutesFinalizedAt: meeting.held ? new Date(meeting.times.endsAt.getTime() + 3_600_000) : null,
      minutesFinalizedByMemberId: meeting.held ? meeting.organizer : null,
      archivedAt: null,
      cancelledAt: null,
    };
    await prisma.meeting.upsert({ where: { id: meeting.id }, update: data, create: { id: meeting.id, ...data } });

    for (const seat of meeting.seats) {
      await prisma.meetingParticipant.upsert({
        where: { meetingId_memberId: { meetingId: meeting.id, memberId: seat.memberId } },
        update: { role: seat.role, attendance: seat.attendance ?? "UNKNOWN" },
        create: {
          meetingId: meeting.id,
          memberId: seat.memberId,
          companyId: meeting.companyId,
          role: seat.role,
          response: seat.response ?? "PENDING",
          attendance: seat.attendance ?? "UNKNOWN",
          displayName: names.get(seat.memberId) ?? "Member",
          invitedAt: now,
          respondedAt: seat.response && seat.response !== "PENDING" ? now : null,
        },
      });
      if (!meeting.held) {
        await prisma.calendarReminder.upsert({
          where: { meetingId_memberId_minutesBefore_channel: { meetingId: meeting.id, memberId: seat.memberId, minutesBefore: 30, channel: "IN_APP" } },
          update: {},
          create: { companyId: meeting.companyId, meetingId: meeting.id, memberId: seat.memberId, minutesBefore: 30 },
        });
      }
    }

    if ((await prisma.meetingAgendaItem.count({ where: { meetingId: meeting.id } })) === 0) {
      await prisma.meetingAgendaItem.createMany({
        data: meeting.agenda.map((item, index) => ({
          companyId: meeting.companyId,
          meetingId: meeting.id,
          sortOrder: index,
          title: item.title,
          plannedMinutes: item.plannedMinutes ?? null,
          status: meeting.held ? (index === 4 ? ("DEFERRED" as const) : ("DISCUSSED" as const)) : ("PENDING" as const),
        })),
      });
    }
  }

  /* Last week's record: minutes, decisions, actions ----------------------- */

  const held = "meeting_riverside_000";
  const secretary = id("user_engineer");
  const sections = [
    { id: "meeting_minutes_riverside_001", title: "Summary", body: "Level 3 slab pour confirmed for next Tuesday. Façade mock-up approved subject to the south elevation finish. Procurement is chasing the lift supplier on the revised delivery window." },
    { id: "meeting_minutes_riverside_002", title: "Discussion", body: "The architect presented façade options A and B. Option B keeps the aluminium profile consistent with the podium and saves two weeks of fabrication.\n\nQA/QC raised two open NCRs on rebar spacing at grid C; the engineer confirmed rework is scheduled before the pour." },
    { id: "meeting_minutes_riverside_003", title: "Risks / Issues", body: "Lift delivery may slip three weeks. Crane availability on the pour day is not yet confirmed." },
  ];
  for (const [index, section] of sections.entries()) {
    await prisma.meetingMinutesSection.upsert({
      where: { id: section.id },
      update: {},
      create: { ...section, companyId: COMPANY_A, meetingId: held, sortOrder: index, createdByMemberId: secretary },
    });
  }
  const decidedAt = instantFromLocal(firstDate, "10:10", zone);
  const decisions = [
    { id: "meeting_decision_riverside_001", decisionNumber: 1, title: "Use façade option B for the south elevation.", description: "Aluminium finish A17, consistent with the podium." },
    { id: "meeting_decision_riverside_002", decisionNumber: 2, title: "Hold the level 3 pour until the grid C rework is signed off by QA/QC." },
  ];
  for (const decision of decisions) {
    await prisma.meetingDecision.upsert({
      where: { id: decision.id },
      update: {},
      create: { ...decision, description: decision.description ?? null, companyId: COMPANY_A, meetingId: held, decidedAt, recordedByMemberId: secretary },
    });
  }
  const due = (days: number) => new Date(`${addLocalDays(today, days)}T12:00:00.000Z`);
  const actions = [
    { id: "meeting_action_riverside_001", title: "Issue revised façade drawings for option B", ownerMemberId: id("user_architect"), dueAt: due(4), status: "IN_PROGRESS" as const },
    { id: "meeting_action_riverside_002", title: "Confirm crane booking for the level 3 pour", ownerMemberId: secretary, dueAt: due(-2), status: "OPEN" as const },
    { id: "meeting_action_riverside_003", title: "Close NCRs on grid C rebar spacing", ownerMemberId: id("user_qaqc"), dueAt: due(-1), status: "DONE" as const, completedAt: new Date() },
  ];
  for (const action of actions) {
    await prisma.meetingActionItem.upsert({
      where: { id: action.id },
      update: {},
      create: { ...action, companyId: COMPANY_A, meetingId: held, createdByMemberId: pm },
    });
  }

  return { meetings: meetings.length, series: 1 };
}
