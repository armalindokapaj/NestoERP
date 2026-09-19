/**
 * Time on Tirana Lake (D-02 §40, §68, §77).
 *
 * The people who sign in and log their time: each has a designated approver,
 * and the last three weeks are behind them — approved, waiting for the project
 * manager, and one returned with a question — with hours on Tirana Lake's
 * tasks, United Towers' design and Farka Residence's site. Normal and project
 * hours only: overtime and the worker's own week are E-09's and are not faked
 * (§40, §41). The current week is left empty.
 *
 * Weeks are relative to the first seed day and written once, like E-04's
 * attendance. Every value is synthetic. Stable ids; a rerun adds nothing.
 */
import type { PrismaClient, TimesheetStatus, WorkLogType } from "@prisma/client";

import { addLocalDays, localDate } from "../../../lib/modules/calendar/calendar.time";
import { businessInstant, weekStartOf } from "../../../lib/modules/timesheets/timesheet.time";
import { memberId } from "./access";
import { companyId } from "./organization";
import { projectId } from "./projects";
import type { CompanyCode, ProjectCode } from "./public-facts";
import { ARMAAR_GROUP_ID } from "./records";

const ZONE = "Europe/Tirane";
const BCI = "BUILDING_CONSTRUCTION_INVEST" as const;
const IDEAL = "IDEAL_CONSTRUCTION" as const;

/** Who approves whose weeks. */
const APPROVERS: Array<[member: string, approver: string, company: CompanyCode]> = [
  ["arlis.site-engineer", "bci.pm", BCI],
  ["arlis.mep", "bci.pm", BCI],
  ["arlis.civil", "bci.pm", BCI],
  ["arlis.qaqc-engineer", "bci.pm", BCI],
  ["arlis.hse-officer", "bci.pm", BCI],
  ["bci.architect", "bci.pm-lead", BCI],
  ["unico.architect", "bci.pm-lead", BCI],
  ["bci.pm", "bci.pm-lead", BCI],
  ["bci.engineering", "bci.director", BCI],
  ["ideal.site-engineer", "ideal.pm", IDEAL],
  ["ideal.qaqc", "ideal.pm", IDEAL],
];

type Entry = { day: number; type: WorkLogType; project?: ProjectCode; task?: string; minutes: number; description?: string };
const task = (n: number) => `armaar_task_${String(n).padStart(3, "0")}`;

const SITE_ENGINEER: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 420, description: "Tower A level 12 set-out and pour preparation." },
  { day: 0, type: "INTERNAL", minutes: 60, description: "Site coordination." },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(118), minutes: 120, description: "Progress photos, Tower B façade." },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 360, description: "Tower B curtain-wall lifts; bracket survey." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 480, description: "Level 11 pour; cubes taken." },
  { day: 3, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 420, description: "Daily logs and delivery checks." },
  { day: 3, type: "ADMIN", minutes: 60 },
  { day: 4, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 450, description: "Façade NCR survey, levels 3 to 6." },
];
const MEP: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(120), minutes: 420, description: "First fix walk-down, Tower A levels 5 to 8." },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(9), minutes: 480, description: "Coordination model v14 clash run." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(105), minutes: 240, description: "Fire-stopping data at 120 minutes." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 240, description: "AHU delivery inspection." },
  { day: 3, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(120), minutes: 420 },
  { day: 3, type: "TRAINING", minutes: 60, description: "Lift-pit briefing with Liftech." },
  { day: 4, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(9), minutes: 450, description: "Model v14 issued to the design team." },
];
const ARCHITECT: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(1), minutes: 360, description: "Façade drawing revision C mark-ups." },
  { day: 0, type: "INTERNAL", minutes: 60 },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(104), minutes: 180, description: "Tile samples against the finishes schedule." },
  { day: 1, type: "PROJECT_WORK", project: "UNITED_TOWERS", task: task(15), minutes: 300, description: "Upper-floor design brief." },
  { day: 2, type: "PROJECT_WORK", project: "UNITED_TOWERS", task: task(15), minutes: 480, description: "Massing options for the hotel floors." },
  { day: 3, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(121), minutes: 420, description: "Show floor snag walk." },
  { day: 4, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(107), minutes: 240, description: "Terrace falls answer drafted." },
  { day: 4, type: "ADMIN", minutes: 120 },
];
const QAQC: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 450, description: "Cube results and pour records, level 11." },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(112), minutes: 480, description: "Basement wet-area waterproofing." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 420, description: "Façade alignment re-survey." },
  { day: 3, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 420, description: "Riser pressure tests." },
  { day: 3, type: "ADMIN", minutes: 60 },
  { day: 4, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 360, description: "NCR close-out evidence." },
];
const ENGINEERING: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(102), minutes: 300, description: "Riser shaft clash, level 7." },
  { day: 0, type: "INTERNAL", minutes: 120, description: "Engineering review." },
  { day: 1, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(103), minutes: 420, description: "AHU technical submittal review." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(2), minutes: 300, description: "Bracket samples and data." },
  { day: 2, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(4), minutes: 180, description: "Frame progress for the valuation." },
  { day: 3, type: "PROJECT_WORK", project: "TIRANA_LAKE", minutes: 480, description: "Site walk with the contractors." },
  { day: 4, type: "PROJECT_WORK", project: "TIRANA_LAKE", task: task(102), minutes: 360 },
];
const FARKA: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "FARKA_RESIDENCE", minutes: 480, description: "Block C level 3 formwork." },
  { day: 1, type: "PROJECT_WORK", project: "FARKA_RESIDENCE", minutes: 480, description: "Rebar fixing and inspection." },
  { day: 2, type: "PROJECT_WORK", project: "FARKA_RESIDENCE", minutes: 420, description: "Drainage trench, Block C." },
  { day: 2, type: "ADMIN", minutes: 60 },
  { day: 3, type: "PROJECT_WORK", project: "FARKA_RESIDENCE", minutes: 480 },
  { day: 4, type: "PROJECT_WORK", project: "FARKA_RESIDENCE", minutes: 420, description: "Pour sequence for Block C level 3." },
];

const WEEKS: Array<{ key: string; member: string; company: CompanyCode; weeksBack: number; status: Extract<TimesheetStatus, "APPROVED" | "RETURNED" | "SUBMITTED">; note?: string; entries: Entry[] }> = [
  { key: "site_engineer_w3", member: "arlis.site-engineer", company: BCI, weeksBack: 3, status: "APPROVED", entries: SITE_ENGINEER },
  { key: "site_engineer_w2", member: "arlis.site-engineer", company: BCI, weeksBack: 2, status: "APPROVED", entries: SITE_ENGINEER },
  { key: "site_engineer_w1", member: "arlis.site-engineer", company: BCI, weeksBack: 1, status: "SUBMITTED", entries: SITE_ENGINEER },
  { key: "mep_w2", member: "arlis.mep", company: BCI, weeksBack: 2, status: "APPROVED", entries: MEP },
  { key: "mep_w1", member: "arlis.mep", company: BCI, weeksBack: 1, status: "RETURNED", note: "Split Wednesday between the fire-stopping resubmission and the AHU inspection — both are on the one line.", entries: MEP },
  { key: "architect_w2", member: "bci.architect", company: BCI, weeksBack: 2, status: "APPROVED", entries: ARCHITECT },
  { key: "architect_w1", member: "bci.architect", company: BCI, weeksBack: 1, status: "SUBMITTED", entries: ARCHITECT },
  { key: "qaqc_w1", member: "arlis.qaqc-engineer", company: BCI, weeksBack: 1, status: "APPROVED", entries: QAQC },
  { key: "engineering_w1", member: "bci.engineering", company: BCI, weeksBack: 1, status: "SUBMITTED", entries: ENGINEERING },
  { key: "farka_w1", member: "ideal.site-engineer", company: IDEAL, weeksBack: 1, status: "APPROVED", entries: FARKA },
];

export async function seedArmaarTimesheets(prisma: PrismaClient) {
  for (const code of [BCI, IDEAL]) await prisma.timesheetSettings.upsert({ where: { companyId: companyId(code) }, update: {}, create: { companyId: companyId(code) } });
  for (const [member, approver, code] of APPROVERS) {
    await prisma.timesheetApproverAssignment.upsert({
      where: { memberId: memberId(member, code) },
      update: {},
      create: { companyId: companyId(code), memberId: memberId(member, code), approverMemberId: memberId(approver, code), updatedByMemberId: memberId(code === BCI ? "bci.hr" : "ideal.director", code) },
    });
  }

  const current = weekStartOf(localDate(new Date(), ZONE), 1);
  for (const week of WEEKS) {
    const id = `armaar_ts_${week.key}`;
    if (await prisma.timesheet.findUnique({ where: { id }, select: { id: true } })) continue;
    const code = week.company;
    const company = companyId(code);
    const member = memberId(week.member, code);
    const approver = memberId(APPROVERS.find(([who, , where]) => who === week.member && where === code)![1], code);
    const start = addLocalDays(current, -7 * week.weeksBack);
    const periodStart = businessInstant(start);
    // A test or a person may already have logged this week: theirs stands, and this one is not written.
    if (await prisma.timesheet.findFirst({ where: { companyId: company, memberId: member, periodStart }, select: { id: true } })) continue;
    const friday = new Date(`${addLocalDays(start, 4)}T16:30:00.000Z`);
    const decidedAt = new Date(friday.getTime() + 3 * 86_400_000);
    const decided = week.status !== "SUBMITTED";
    const approvalId = `${id}_approval`;
    await prisma.timesheet.create({
      data: {
        id,
        companyId: company,
        memberId: member,
        periodStart,
        periodEnd: businessInstant(addLocalDays(start, 6)),
        status: week.status,
        approverMemberId: approver,
        submittedAt: friday,
        submittedByMemberId: member,
        approvedAt: week.status === "APPROVED" ? decidedAt : null,
        approvedByMemberId: week.status === "APPROVED" ? approver : null,
        returnedAt: week.status === "RETURNED" ? decidedAt : null,
        returnedByMemberId: week.status === "RETURNED" ? approver : null,
        decisionNote: week.note ?? null,
        submissionVersion: 1,
        version: 2,
        createdAt: new Date(`${start}T08:00:00.000Z`),
      },
    });
    await prisma.workLog.createMany({
      data: week.entries.map((entry, index) => ({
        id: `${id}_log_${index + 1}`,
        companyId: company,
        timesheetId: id,
        memberId: member,
        workDate: businessInstant(addLocalDays(start, entry.day)),
        projectId: entry.project ? projectId(entry.project) : null,
        taskId: entry.task ?? null,
        workType: entry.type,
        minutes: entry.minutes,
        description: entry.description ?? null,
        billable: entry.type === "PROJECT_WORK",
        createdByMemberId: member,
      })),
    });
    await prisma.timesheetApproval.create({
      data: { id: approvalId, companyId: company, recordId: id, status: week.status === "SUBMITTED" ? "PENDING" : week.status, submissionVersion: 1, approverMemberId: approver, submittedByMemberId: member, submittedAt: friday, decidedByMemberId: decided ? approver : null, decidedAt: decided ? decidedAt : null, decisionNote: week.note ?? null },
    });
    await prisma.approvalStep.create({
      data: { companyId: company, providerKey: "timesheets", approvalId, stepNumber: 1, label: "Approver", approverMemberId: approver, approverPermission: "timesheet.approve", status: week.status === "SUBMITTED" ? "PENDING" : week.status, decidedByMemberId: decided ? approver : null, decidedAt: decided ? decidedAt : null, decisionNote: week.note ?? null },
    });
  }

  const inGroup = { company: { parentGroupId: ARMAAR_GROUP_ID } };
  return { weeks: await prisma.timesheet.count({ where: inGroup }), hours: Math.round(((await prisma.workLog.aggregate({ where: inGroup, _sum: { minutes: true } }))._sum.minutes ?? 0) / 60) };
}
