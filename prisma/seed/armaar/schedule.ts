/**
 * ARMAAR's diary, deepened (D-02 §32-§34, §62).
 *
 * D-01 booked Tirana Lake's coordination, procurement, design, HSE and sales
 * meetings and four calendar events. D-02 adds the meetings the rest of the
 * group holds — the owner's executive review, a sales close-out, a monthly
 * HSE meeting, reviews at Farka Residence and Gran Melia, United Towers'
 * design coordination and a QA/QC walk-down — the held ones with minutes,
 * decisions and actions; the company events and deadlines of the season; and
 * document reviews for the Approvals Center (§32: documents), which sit on a
 * document's version and are written once the versions exist.
 *
 * Inspections, milestones, RFI and review due dates reach the calendar through
 * their own modules' providers; nothing here copies them. Every value is
 * synthetic. Stable ids; a rerun adds nothing.
 */
import { createHash } from "node:crypto";

import type { CalendarEventType, CalendarVisibility, MeetingType, PrismaClient } from "@prisma/client";

import { addLocalDays, instantFromLocal, localDate } from "../../../lib/modules/calendar/calendar.time";
import { AGENDA_TEMPLATES } from "../../../lib/modules/meetings/meeting.types";
import { memberId } from "./access";
import { companyId } from "./organization";
import { personOf } from "./people";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;

const MEETINGS: Array<{
  id: string;
  company: CompanyCode;
  project: ProjectCode | null;
  organizer: string;
  title: string;
  type: MeetingType;
  day: number;
  from: string;
  to: string;
  seats: string[];
  agenda: string;
  location: string;
  minutes?: { summary: string; decisions: string[]; actions: Array<{ title: string; owner: string; due: number; status: "OPEN" | "IN_PROGRESS" | "DONE" }> };
}> = [
  {
    id: "armaar_mtg_group_exec", company: "ARLIS_ADMINISTRIM", project: null, organizer: "armaar.owner", title: "Executive review — group portfolio, Q3", type: "MANAGEMENT", day: -13, from: "09:00", to: "11:00",
    seats: ["armaar.finance", "armaar.projects", "armaar.sales", "armaar.procurement", "armaar.hse", "armaar.legal"], agenda: "management", location: "Head office, board room",
    minutes: {
      summary: "Tirana Lake is on programme at 62%; Tower B's façade is the risk to watch. Square 21 is nearly sold out. Gran Melia's structural tender closes this month. Group cash is inside the plan.",
      decisions: ["Keep the Tower B handover date; add a second façade crew if the bracket order slips another week.", "Go to tender for United Towers' frame once planning is lodged."],
      actions: [
        { title: "Report the Tower B façade recovery plan to the owner", owner: "armaar.projects", due: -6, status: "DONE" },
        { title: "Prepare the Q4 cash-flow forecast by company", owner: "armaar.finance", due: 4, status: "IN_PROGRESS" },
        { title: "Shortlist frame contractors for United Towers", owner: "armaar.procurement", due: 20, status: "OPEN" },
      ],
    },
  },
  {
    id: "armaar_mtg_s21_closeout", company: BCI, project: "SQUARE_21", organizer: "bci.sales", title: "Sales review — Square 21 close-out", type: "MANAGEMENT", day: -9, from: "15:00", to: "16:00",
    seats: ["bci.sales-agent", "bci.sales-agent2", "bci.finance", "bci.director"], agenda: "general", location: "Head office, meeting room 2",
    minutes: {
      summary: "Two reservations and two shops left. Four buyers still paying; one installment in arrears is being chased.",
      decisions: ["Hold the shop prices until the end of the quarter."],
      actions: [{ title: "Call the buyer in arrears and agree a date", owner: "bci.sales-agent", due: -2, status: "DONE" }, { title: "Send the final account summary to the board", owner: "bci.finance", due: 7, status: "OPEN" }],
    },
  },
  {
    id: "armaar_mtg_tc_hse_monthly", company: "ARLIS_NDERTIM", project: "THE_COURTYARD", organizer: "arlis.hse", title: "Monthly HSE meeting — The Courtyard", type: "HSE", day: -16, from: "08:00", to: "09:00",
    seats: ["arlis.pm-lead", "arlis.qaqc", "arlis.engineering"], agenda: "hse", location: "The Courtyard — site office",
    minutes: {
      summary: "No lost-time injuries this month. Two near misses reported, both at the scaffold on block 3. Housekeeping on the upper floors needs attention.",
      decisions: ["Scaffold tags checked daily by the supervisor, weekly by the HSE officer."],
      actions: [{ title: "Re-brief the scaffolding crew on tagging", owner: "arlis.hse", due: -12, status: "DONE" }, { title: "Add a housekeeping line to the daily checklist", owner: "arlis.qaqc", due: 3, status: "OPEN" }],
    },
  },
  { id: "armaar_mtg_tl_qaqc_walk", company: BCI, project: "TIRANA_LAKE", organizer: "arlis.qaqc-engineer", title: "QA/QC walk-down — Tower A level 10", type: "QA_QC", day: -5, from: "10:00", to: "11:00", seats: ["arlis.site-engineer", "bci.engineering", "arlis.civil"], agenda: "qa-qc", location: "Tirana Lake — Tower A, level 10" },
  { id: "armaar_mtg_ut_design", company: BCI, project: "UNITED_TOWERS", organizer: "bci.pm-lead", title: "Design coordination — United Towers concept", type: "DESIGN_REVIEW", day: 6, from: "10:00", to: "12:00", seats: ["unico.architect", "bci.architect", "bci.engineering"], agenda: "design-review", location: "Head office, meeting room 2" },
  { id: "armaar_mtg_fr_procurement", company: "IDEAL_CONSTRUCTION", project: "FARKA_RESIDENCE", organizer: "ideal.procurement", title: "Procurement review — Block C packages", type: "PROCUREMENT", day: 3, from: "11:00", to: "12:00", seats: ["ideal.pm", "ideal.finance", "ideal.site-engineer"], agenda: "general", location: "Farka Residence — site office" },
  { id: "armaar_mtg_gm_finance", company: "SARANDA_MARINA_INVEST", project: "GRAN_MELIA", organizer: "smi.finance", title: "Finance review — Gran Melia budget and commitments", type: "FINANCE", day: 8, from: "10:00", to: "11:30", seats: ["smi.director", "smi.pm"], agenda: "management", location: "Saranda — office" },
];

const EVENTS: Array<{ id: string; company: CompanyCode; by: string; title: string; type: CalendarEventType; visibility: CalendarVisibility; project: ProjectCode | null; day: number; from?: string; to?: string; location?: string; description?: string }> = [
  { id: "armaar_cal_topping_out", company: BCI, by: "bci.director", title: "Topping-out ceremony — Tower A", type: "COMPANY_EVENT", visibility: "COMPANY", project: "TIRANA_LAKE", day: 24, from: "17:00", to: "19:00", location: "Tirana Lake — Tower A roof" },
  { id: "armaar_cal_facade_review_due", company: BCI, by: "bci.pm", title: "Façade shop drawings — review closes", type: "INTERNAL_DEADLINE", visibility: "PROJECT", project: "TIRANA_LAKE", day: 3, description: "FAC-SD-210 Rev C back to Vlora Glass Systems with comments." },
  { id: "armaar_cal_group_board", company: "ARLIS_ADMINISTRIM", by: "armaar.owner", title: "Group board meeting — Q3 results", type: "COMPANY_EVENT", visibility: "COMPANY", project: null, day: 11, from: "10:00", to: "13:00", location: "Head office, board room" },
  { id: "armaar_cal_scaffold_course", company: "ARLIS_NDERTIM", by: "arlis.hse", title: "Scaffold inspector course", type: "TRAINING", visibility: "COMPANY", project: null, day: 12, from: "08:30", to: "16:30", location: "The Courtyard — site office" },
  { id: "armaar_cal_gm_site_visit", company: "SARANDA_MARINA_INVEST", by: "smi.director", title: "Gran Melia — investor site visit", type: "COMPANY_EVENT", visibility: "COMPANY", project: "GRAN_MELIA", day: 15, from: "11:00", to: "14:00", location: "Gran Melia site" },
  { id: "armaar_cal_fr_pour", company: "IDEAL_CONSTRUCTION", by: "ideal.pm", title: "Block C level 3 slab pour", type: "TEAM_EVENT", visibility: "PROJECT", project: "FARKA_RESIDENCE", day: 4, from: "06:00", to: "14:00", location: "Farka Residence — Block C" },
  { id: "armaar_cal_rooftop_commissioning", company: "ARSOL_ENERGY", by: "arsol.pm", title: "Rooftop programme batch 2 — commissioning window opens", type: "INTERNAL_DEADLINE", visibility: "COMPANY", project: null, day: 40 },
];

export async function seedArmaarSchedule(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const day = (offset: number) => new Date(`${addLocalDays(today, offset)}T12:00:00.000Z`);
  const template = (key: string) => AGENDA_TEMPLATES.find((row) => row.key === key)!.items;

  /* Meetings (§33) ------------------------------------------------------------ */
  for (const meeting of MEETINGS) {
    const date = addLocalDays(today, meeting.day);
    const startsAt = instantFromLocal(date, meeting.from, ZONE);
    const endsAt = instantFromLocal(date, meeting.to, ZONE);
    const company = companyId(meeting.company);
    const organizer = memberId(meeting.organizer, meeting.company);
    const held = meeting.day < 0;
    await prisma.meeting.upsert({
      where: { id: meeting.id },
      update: {},
      create: {
        id: meeting.id,
        companyId: company,
        projectId: meeting.project ? projectId(meeting.project) : null,
        createdByMemberId: organizer,
        organizerMemberId: organizer,
        title: meeting.title,
        meetingType: meeting.type,
        status: held ? "COMPLETED" : "SCHEDULED",
        startsAt,
        endsAt,
        timezone: ZONE,
        locationType: "IN_PERSON",
        locationText: meeting.location,
        visibility: meeting.project ? "PROJECT" : "PARTICIPANTS",
        startedAt: held ? startsAt : null,
        completedAt: held ? endsAt : null,
        minutesStatus: held && meeting.minutes ? "FINAL" : "DRAFT",
        minutesFinalizedAt: held && meeting.minutes ? new Date(endsAt.getTime() + 3_600_000) : null,
        minutesFinalizedByMemberId: held && meeting.minutes ? organizer : null,
      },
    });
    for (const [index, username] of [meeting.organizer, ...meeting.seats].entries()) {
      const member = memberId(username, meeting.company);
      const person = personOf(username)!;
      await prisma.meetingParticipant.upsert({
        where: { meetingId_memberId: { meetingId: meeting.id, memberId: member } },
        update: {},
        create: { meetingId: meeting.id, memberId: member, companyId: company, role: index === 0 ? "ORGANIZER" : "ATTENDEE", response: "ACCEPTED", attendance: held ? "PRESENT" : "UNKNOWN", displayName: `${person.firstName} ${person.lastName}`, invitedAt: at(meeting.day - 7), respondedAt: at(meeting.day - 6) },
      });
    }
    if ((await prisma.meetingAgendaItem.count({ where: { meetingId: meeting.id } })) === 0) {
      await prisma.meetingAgendaItem.createMany({ data: template(meeting.agenda).map((item, index) => ({ companyId: company, meetingId: meeting.id, sortOrder: index, title: item.title, plannedMinutes: item.plannedMinutes ?? null, status: held ? ("DISCUSSED" as const) : ("PENDING" as const) })) });
    }
    if (!meeting.minutes) continue;
    await prisma.meetingMinutesSection.upsert({ where: { id: `${meeting.id}_summary` }, update: {}, create: { id: `${meeting.id}_summary`, companyId: company, meetingId: meeting.id, sortOrder: 0, title: "Summary", body: meeting.minutes.summary, createdByMemberId: organizer } });
    for (const [index, title] of meeting.minutes.decisions.entries()) {
      await prisma.meetingDecision.upsert({ where: { id: `${meeting.id}_decision_${index + 1}` }, update: {}, create: { id: `${meeting.id}_decision_${index + 1}`, companyId: company, meetingId: meeting.id, decisionNumber: index + 1, title, decidedAt: new Date(startsAt.getTime() + (index + 1) * 1_800_000), recordedByMemberId: organizer } });
    }
    for (const [index, action] of meeting.minutes.actions.entries()) {
      const id = `${meeting.id}_action_${index + 1}`;
      await prisma.meetingActionItem.upsert({ where: { id }, update: {}, create: { id, companyId: company, meetingId: meeting.id, title: action.title, ownerMemberId: memberId(action.owner, meeting.company), dueAt: day(action.due), status: action.status, completedAt: action.status === "DONE" ? at(action.due - 1, 15) : null, createdByMemberId: organizer } });
    }
  }

  /* Company events and deadlines (§34) ------------------------------------------ */
  for (const event of EVENTS) {
    const timed = event.from && event.to;
    await prisma.calendarEvent.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        companyId: companyId(event.company),
        createdByMemberId: memberId(event.by, event.company),
        title: event.title,
        description: event.description ?? null,
        location: event.location ?? null,
        eventType: event.type,
        startsAt: timed ? instantFromLocal(addLocalDays(today, event.day), event.from!, ZONE) : new Date(`${addLocalDays(today, event.day)}T00:00:00.000Z`),
        endsAt: timed ? instantFromLocal(addLocalDays(today, event.day), event.to!, ZONE) : new Date(`${addLocalDays(today, event.day + 1)}T00:00:00.000Z`),
        allDay: !timed,
        timezone: ZONE,
        projectId: event.project ? projectId(event.project) : null,
        visibility: event.visibility,
      },
    });
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return { meetings: await prisma.meeting.count({ where: inGroup }), events: await prisma.calendarEvent.count({ where: inGroup }) };
}

/** The id the storage seed gives a document's first version (`seedDocumentVersions`). */
const firstVersionId = (documentId: string) => `dver_${createHash("md5").update(`${documentId}:1`).digest("hex").slice(0, 24)}`;

const REVIEWS: Array<{ document: string; requester: string; reviewer: string; status: "PENDING" | "APPROVED" | "REJECTED"; requested: number; due?: number; decided?: number; note?: string; decision?: string }> = [
  { document: "armaar_doc_tl_22", requester: "bci.pm", reviewer: "bci.director", status: "PENDING", requested: -2, due: 4, note: "Phase 1 handover plan for sign-off before it goes to the buyers." },
  { document: "armaar_doc_tl_21", requester: "bci.finance", reviewer: "bci.director", status: "PENDING", requested: -1, due: 2, note: "Q3 cost report for the board pack." },
  { document: "armaar_doc_tl_18", requester: "bci.pm-lead", reviewer: "bci.director", status: "APPROVED", requested: -40, decided: -38, decision: "Filed with the municipality's stamp." },
  { document: "armaar_doc_tl_16", requester: "bci.sales", reviewer: "bci.director", status: "REJECTED", requested: -8, decided: -6, decision: "The upper floors need the revised rates before this goes out." },
];

/**
 * Document reviews (§32): one request per reviewer per version, on the first
 * version the storage seed wrote. A pending review puts the version in review;
 * a decided one leaves it approved or rejected, as the review service does.
 * Skipped for any document whose version is not there yet.
 */
export async function seedArmaarDocumentReviews(prisma: PrismaClient) {
  const today = localDate(new Date(), ZONE);
  const at = (offset: number, hour = 10) => new Date(`${addLocalDays(today, offset)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  let written = 0;
  for (const [index, review] of REVIEWS.entries()) {
    const versionId = firstVersionId(review.document);
    const version = await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { id: true, documentId: true } });
    if (!version || version.documentId !== review.document) continue;
    const reviewer = memberId(review.reviewer, BCI);
    const id = `armaar_docrev_${String(index + 1).padStart(2, "0")}`;
    const exists = await prisma.documentReview.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      await prisma.documentReview.create({
        data: {
          id,
          companyId: companyId(BCI),
          documentId: review.document,
          documentVersionId: versionId,
          requestedByMemberId: memberId(review.requester, BCI),
          reviewerMemberId: reviewer,
          status: review.status,
          requestNote: review.note ?? null,
          decisionNote: review.decision ?? null,
          decidedByMemberId: review.status === "PENDING" ? null : reviewer,
          pendingKey: review.status === "PENDING" ? `${versionId}:${reviewer}` : null,
          dueAt: review.due === undefined ? null : new Date(`${addLocalDays(today, review.due)}T12:00:00.000Z`),
          requestedAt: at(review.requested, 9),
          decidedAt: review.decided === undefined ? null : at(review.decided, 16),
        },
      });
      await prisma.documentVersion.update({ where: { id: versionId }, data: { reviewState: review.status === "PENDING" ? "IN_REVIEW" : review.status } });
    }
    written += 1;
  }
  return written;
}
