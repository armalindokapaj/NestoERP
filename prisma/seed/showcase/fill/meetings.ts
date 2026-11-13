/**
 * Meetings: the weekly site progress meeting on every project that is
 * building — six held, with who came, the agenda, decisions, actions and the
 * minutes signed off, and next week's already in the diary — plus a sales
 * review and a design review in each company.
 */
import type { MeetingType, PrismaClient } from "@prisma/client";

import { at, castOf, random, type Cast, type Clock, type Part } from "./kit";

const PROGRESS_PROJECTS = ["project_b", "project_c", "project_d", "project_e", "project_showcase_promenada"];

const DECISIONS = [
  "Pour the next slab on Thursday if the forecast holds",
  "Accept the façade contractor's revised programme",
  "Second tower crane to stay until the roof",
  "Use the alternative block supplier for the upper floors",
  "Night pours allowed twice a week with the municipality's consent",
  "Hold the show-flat finishes until the client signs off the samples",
];
const ACTIONS = [
  "Send the revised look-ahead to all subcontractors",
  "Chase the mill certificates for the last rebar delivery",
  "Book the supervising engineer for the pour inspection",
  "Price the extra edge protection for the upper floors",
  "Confirm the lift supplier's site date",
  "Agree the hoarding repair with the insurer",
];

export async function seedShowcaseMeetings(prisma: PrismaClient, clock: Clock) {
  let meetings = 0;
  for (const projectId of PROGRESS_PROJECTS) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { companyId: true, name: true } });
    const cast = await castOf(prisma, project.companyId!);
    const rand = random(`meetings:${projectId}`);
    const first = -6 * 7 - ((clock.now.getUTCDay() + 5) % 7);
    const series = await prisma.meetingSeries.create({ data: { companyId: cast.companyId, projectId, createdByMemberId: cast.member("pm"), title: `${project.name} — weekly progress`, description: "Site, procurement, QA/QC and HSE together, every week.", meetingType: "SITE", visibility: "PROJECT", locationType: "IN_PERSON", locationText: "Site office", firstStartsAt: at(clock, first, 9), durationMinutes: 60, timezone: "Europe/Tirane", recurrenceRule: "FREQ=WEEKLY;INTERVAL=1", generatedUntil: at(clock, first + 7 * 7, 9), createdAt: at(clock, first - 7) }, select: { id: true } });
    for (let week = 6; week >= -1; week -= 1) {
      const day = -week * 7 - ((clock.now.getUTCDay() + 5) % 7);
      const held = week >= 1;
      await meeting(prisma, clock, cast, {
        projectId, seriesId: series.id, occurrenceIndex: 6 - week,
        title: `${project.name} — weekly progress`, type: "SITE", day, held, location: "Site office",
        people: ["pm", "engineer", "hse", "qaqc", "procurement"], agenda: ["Safety: last week's walk and incidents", "Progress against the look-ahead", "Deliveries and procurement", "Quality: open NCRs and defects", "Next week"],
        decisions: held ? [rand.pick(DECISIONS)] : [], actions: held ? [rand.pick(ACTIONS), rand.pick(ACTIONS)].filter((value, index, all) => all.indexOf(value) === index) : [], doneActions: week >= 3,
        minutes: held ? [["Safety", `${rand.int(0, 2) === 0 ? "No incidents" : "One near miss, investigated"}; housekeeping on the upper slab to improve.`], ["Progress", `On programme except ${rand.pick(["the façade brackets", "the core walls", "the basement MEP", "the yard drainage"])}, about a week behind.`], ["Procurement", "Rebar and concrete deliveries confirmed for the next two pours."]] : [],
      });
      meetings += 1;
    }
  }
  for (const companyId of ["company_demo_a", "company_demo_b", "company_demo_c", "company_demo_d", "company_demo_e"]) {
    const cast = await castOf(prisma, companyId);
    await meeting(prisma, clock, cast, { projectId: null, seriesId: null, occurrenceIndex: null, title: "Monthly sales review", type: "MANAGEMENT", day: -9, held: true, location: "Head office", people: ["ceo", "salesHead", "sales", "finance"], agenda: ["Reservations and sales this month", "Collections and overdue installments", "Price list"], decisions: ["Keep prices on the sold-out floors; reprice the corner units +3%"], actions: ["Call every buyer more than 30 days late"], doneActions: false, minutes: [["Sales", "Ahead of plan on reservations; two contracts waiting on Legal."], ["Collections", "Overdue installments under 5% of the month's billing."]] });
    await meeting(prisma, clock, cast, { projectId: null, seriesId: null, occurrenceIndex: null, title: "Design review", type: "DESIGN_REVIEW", day: 3, held: false, location: "Online", people: ["architect", "engineer", "pm"], agenda: ["Open RFIs", "Drawings due this month"], decisions: [], actions: [], doneActions: false, minutes: [] });
    meetings += 2;
  }
  return { meetings };
}

async function meeting(
  prisma: PrismaClient,
  clock: Clock,
  cast: Cast,
  input: { projectId: string | null; seriesId: string | null; occurrenceIndex: number | null; title: string; type: MeetingType; day: number; held: boolean; location: string; people: Part[]; agenda: string[]; decisions: string[]; actions: string[]; doneActions: boolean; minutes: string[][] },
) {
  const startsAt = at(clock, input.day, 9);
  const endsAt = at(clock, input.day, 10);
  const organizer = cast.member(input.people[0]!);
  const record = await prisma.meeting.create({
    data: {
      companyId: cast.companyId, projectId: input.projectId, createdByMemberId: organizer, organizerMemberId: organizer, title: input.title, meetingType: input.type, status: input.held ? "COMPLETED" : "SCHEDULED",
      startsAt, endsAt, timezone: "Europe/Tirane", locationType: input.location === "Online" ? "ONLINE" : "IN_PERSON", locationText: input.location === "Online" ? null : input.location, onlineUrl: input.location === "Online" ? "https://meet.arvela.test/design-review" : null,
      visibility: input.projectId ? "PROJECT" : "COMPANY", seriesId: input.seriesId, occurrenceIndex: input.occurrenceIndex, minutesStatus: input.held ? "FINAL" : "DRAFT", minutesFinalizedAt: input.held ? at(clock, input.day + 1, 9) : null, minutesFinalizedByMemberId: input.held ? organizer : null,
      startedAt: input.held ? startsAt : null, completedAt: input.held ? endsAt : null, createdAt: at(clock, input.day - 6),
    },
    select: { id: true },
  });
  const seen = new Set<string>();
  const participants = input.people.map((part, index) => ({ part, memberId: cast.member(part), index })).filter((row) => (seen.has(row.memberId) ? false : (seen.add(row.memberId), true)));
  await prisma.meetingParticipant.createMany({
    data: participants.map((row) => ({ companyId: cast.companyId, meetingId: record.id, memberId: row.memberId, role: row.index === 0 ? ("ORGANIZER" as const) : ("ATTENDEE" as const), response: "ACCEPTED" as const, required: true, attendance: input.held ? (row.index === participants.length - 1 && row.index > 2 ? ("EXCUSED" as const) : ("PRESENT" as const)) : ("UNKNOWN" as const), displayName: cast.name(row.part), invitedAt: at(clock, input.day - 6), respondedAt: at(clock, input.day - 5) })),
  });
  await prisma.meetingAgendaItem.createMany({ data: input.agenda.map((title, index) => ({ companyId: cast.companyId, meetingId: record.id, sortOrder: index + 1, title, plannedMinutes: 10, presenterMemberId: organizer, status: input.held ? ("DISCUSSED" as const) : ("PENDING" as const) })) });
  if (input.decisions.length) await prisma.meetingDecision.createMany({ data: input.decisions.map((title, index) => ({ companyId: cast.companyId, meetingId: record.id, decisionNumber: index + 1, title, decidedAt: at(clock, input.day, 10), recordedByMemberId: organizer })) });
  if (input.actions.length) await prisma.meetingActionItem.createMany({ data: input.actions.map((title, index) => ({ companyId: cast.companyId, meetingId: record.id, title, ownerMemberId: cast.member(input.people[(index + 1) % input.people.length]!), dueAt: at(clock, input.day + 7), status: input.doneActions ? ("DONE" as const) : index === 0 ? ("IN_PROGRESS" as const) : ("OPEN" as const), completedAt: input.doneActions ? at(clock, input.day + 5) : null, createdByMemberId: organizer })) });
  if (input.minutes.length) await prisma.meetingMinutesSection.createMany({ data: input.minutes.map(([title, body], index) => ({ companyId: cast.companyId, meetingId: record.id, sortOrder: index + 1, title: title!, body: body!, createdByMemberId: organizer })) });
}
