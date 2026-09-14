import type { PrismaClient, TimesheetStatus, WorkLogType } from "@prisma/client";

import { addLocalDays, localDate } from "../../lib/modules/calendar/calendar.time";
import { businessInstant, weekStartOf } from "../../lib/modules/timesheets/timesheet.time";

/**
 * Timesheets demo data (PRD #42 §245).
 *
 * Designated approvers for everybody who logs time, and real weeks behind
 * them: the Engineer's week three back approved, the one after returned with a
 * question, and last week waiting for the Project Manager — with a QA/QC week
 * beside it — and the Architect's last two weeks approved, so project
 * reporting has approved hours on several projects and tasks. The current week
 * is left empty for everybody. Dated relative to the day the seed runs; re-running
 * replaces the seeded weeks.
 */
type Members = Map<string, string>;

const COMPANY_A = "company_demo_a";
const ZONE = "Europe/Tirane";

export const TIMESHEET_SEED = {
  engineerApproved: "timesheet_engineer_approved",
  engineerReturned: "timesheet_engineer_returned",
  engineerSubmitted: "timesheet_engineer_submitted",
  engineerSubmittedApproval: "timesheet_approval_engineer_submitted",
  qaqcSubmitted: "timesheet_qaqc_submitted",
  architectApproved: "timesheet_architect_approved",
  architectApprovedEarlier: "timesheet_architect_approved_earlier",
} as const;

/** Who approves whose weeks: the delivery team to the PM, the PM to the CEO, the office to HR. */
const APPROVERS: Array<[member: string, approver: string]> = [
  ["user_engineer", "user_pm"],
  ["user_architect", "user_pm"],
  ["user_qaqc", "user_pm"],
  ["user_hse", "user_pm"],
  ["user_inventory", "user_pm"],
  ["user_pm", "user_ceo"],
  ["user_finance", "user_hr"],
  ["user_legal", "user_hr"],
  ["user_sales", "user_hr"],
  ["user_procurement", "user_hr"],
  ["user_admin", "user_hr"],
  ["user_it", "user_hr"],
  ["user_hr", "user_owner"],
  ["user_ceo", "user_owner"],
  ["user_owner", "user_ceo"],
];

type Entry = { day: number; type: WorkLogType; project?: string; task?: string; minutes: number; description?: string; billable?: boolean };

type WeekSeed = {
  id: string;
  approvalId: string;
  member: string;
  approver: string;
  weeksBack: number;
  status: Extract<TimesheetStatus, "APPROVED" | "RETURNED" | "SUBMITTED">;
  note?: string;
  entries: Entry[];
};

const ENGINEER_WEEK: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "project_a", task: "Review structural detail S-204", minutes: 240, description: "Checked connection details against the revised loads." },
  { day: 0, type: "PROJECT_WORK", project: "project_a", task: "Site inspection follow-up", minutes: 210, description: "Block B slab — follow-up on the cover readings." },
  { day: 0, type: "INTERNAL", minutes: 30, description: "Team stand-up." },
  { day: 1, type: "PROJECT_WORK", project: "project_a", task: "Review structural detail S-204", minutes: 360, description: "Mark-ups returned to the architect." },
  { day: 1, type: "PROJECT_WORK", project: "project_d", task: "Reassess structural loading", minutes: 120, description: "Yard slab loading assumptions." },
  { day: 2, type: "PROJECT_WORK", project: "project_d", task: "Reassess structural loading", minutes: 300, description: "Load combinations for the racking layout." },
  { day: 2, type: "TRAINING", minutes: 180, description: "Eurocode 2 refresher.", billable: false },
  { day: 3, type: "PROJECT_WORK", project: "project_a", task: "Site inspection follow-up", minutes: 420, description: "Site walk with the contractor; photos filed." },
  { day: 3, type: "ADMIN", minutes: 60, description: "Expense claims." },
  { day: 4, type: "PROJECT_WORK", project: "project_a", task: "Review structural detail S-204", minutes: 240, description: "Final check before issue." },
  { day: 4, type: "PROJECT_WORK", project: "project_d", minutes: 180, description: "Call with the permits consultant." },
  { day: 4, type: "INTERNAL", minutes: 60, description: "Weekly engineering review." },
];

const ARCHITECT_WEEK: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "project_a", task: "Review apartment layouts", minutes: 420, description: "Layouts for types C and D." },
  { day: 0, type: "INTERNAL", minutes: 60 },
  { day: 1, type: "PROJECT_WORK", project: "project_c", task: "Finalise facade package", minutes: 480, description: "Facade panel set-out." },
  { day: 2, type: "PROJECT_WORK", project: "project_c", task: "Finalise facade package", minutes: 300 },
  { day: 2, type: "PROJECT_WORK", project: "project_a", task: "Review apartment layouts", minutes: 180 },
  { day: 3, type: "PROJECT_WORK", project: "project_a", minutes: 480, description: "Client design meeting and follow-up." },
  { day: 4, type: "PROJECT_WORK", project: "project_c", minutes: 360, description: "Planning submission drawings." },
  { day: 4, type: "ADMIN", minutes: 120 },
];

const QAQC_WEEK: Entry[] = [
  { day: 0, type: "PROJECT_WORK", project: "project_a", minutes: 450, description: "Concrete cube results and pour records." },
  { day: 1, type: "PROJECT_WORK", project: "project_b", minutes: 480, description: "Basement waterproofing inspection." },
  { day: 2, type: "PROJECT_WORK", project: "project_a", minutes: 420, description: "Rebar inspection before the level 3 pour." },
  { day: 2, type: "TRAVEL", minutes: 60 },
  { day: 3, type: "PROJECT_WORK", project: "project_b", minutes: 360 },
  { day: 3, type: "ADMIN", minutes: 60 },
  { day: 4, type: "PROJECT_WORK", project: "project_a", minutes: 300, description: "NCR close-out evidence." },
];

const WEEKS: WeekSeed[] = [
  { id: TIMESHEET_SEED.engineerApproved, approvalId: "timesheet_approval_engineer_approved", member: "user_engineer", approver: "user_pm", weeksBack: 3, status: "APPROVED", entries: ENGINEER_WEEK },
  {
    id: TIMESHEET_SEED.engineerReturned,
    approvalId: "timesheet_approval_engineer_returned",
    member: "user_engineer",
    approver: "user_pm",
    weeksBack: 2,
    status: "RETURNED",
    note: "Please split Thursday's Riverside time between the S-204 review and the site inspection.",
    entries: ENGINEER_WEEK,
  },
  { id: TIMESHEET_SEED.engineerSubmitted, approvalId: TIMESHEET_SEED.engineerSubmittedApproval, member: "user_engineer", approver: "user_pm", weeksBack: 1, status: "SUBMITTED", entries: ENGINEER_WEEK },
  { id: TIMESHEET_SEED.qaqcSubmitted, approvalId: "timesheet_approval_qaqc_submitted", member: "user_qaqc", approver: "user_pm", weeksBack: 1, status: "SUBMITTED", entries: QAQC_WEEK },
  { id: TIMESHEET_SEED.architectApproved, approvalId: "timesheet_approval_architect_approved", member: "user_architect", approver: "user_pm", weeksBack: 1, status: "APPROVED", entries: ARCHITECT_WEEK },
  { id: TIMESHEET_SEED.architectApprovedEarlier, approvalId: "timesheet_approval_architect_earlier", member: "user_architect", approver: "user_pm", weeksBack: 2, status: "APPROVED", entries: ARCHITECT_WEEK },
];

export async function seedTimesheetRecords(prisma: PrismaClient, members: Members) {
  const id = (key: string) => members.get(key)!;

  await prisma.timesheetSettings.upsert({ where: { companyId: COMPANY_A }, update: {}, create: { companyId: COMPANY_A } });

  for (const [member, approver] of APPROVERS) {
    if (!members.has(member) || !members.has(approver)) continue;
    await prisma.timesheetApproverAssignment.upsert({
      where: { memberId: id(member) },
      update: { approverMemberId: id(approver) },
      create: { companyId: COMPANY_A, memberId: id(member), approverMemberId: id(approver), updatedByMemberId: id("user_hr") },
    });
  }

  const taskRows = await prisma.task.findMany({ where: { companyId: COMPANY_A, projectId: { not: null } }, select: { id: true, title: true, projectId: true } });
  const taskId = (projectId: string, title: string) => taskRows.find((row) => row.projectId === projectId && row.title === title)?.id ?? null;

  const current = weekStartOf(localDate(new Date(), ZONE), 1);
  let logs = 0;
  for (const week of WEEKS) {
    const memberId = id(week.member);
    const approverId = id(week.approver);
    const start = addLocalDays(current, -7 * week.weeksBack);
    const periodStart = businessInstant(start);

    // Whatever sits in this member's week now — a previous seed, a test — makes way.
    const existing = await prisma.timesheet.findMany({ where: { OR: [{ id: week.id }, { companyId: COMPANY_A, memberId, periodStart }] }, select: { id: true } });
    const existingIds = existing.map((row) => row.id);
    if (existingIds.length > 0) {
      const cycles = await prisma.timesheetApproval.findMany({ where: { recordId: { in: existingIds } }, select: { id: true } });
      await prisma.approvalStep.deleteMany({ where: { providerKey: "timesheets", approvalId: { in: [...cycles.map((row) => row.id), week.approvalId] } } });
      await prisma.timesheetApproval.deleteMany({ where: { recordId: { in: existingIds } } });
      await prisma.workLog.deleteMany({ where: { timesheetId: { in: existingIds } } });
      await prisma.timesheet.deleteMany({ where: { id: { in: existingIds } } });
    }
    await prisma.approvalStep.deleteMany({ where: { providerKey: "timesheets", approvalId: week.approvalId } });
    await prisma.timesheetApproval.deleteMany({ where: { id: week.approvalId } });

    const friday = new Date(`${addLocalDays(start, 4)}T16:30:00.000Z`);
    const decidedAt = new Date(friday.getTime() + 3 * 86_400_000);
    const decided = week.status !== "SUBMITTED";
    await prisma.timesheet.create({
      data: {
        id: week.id,
        companyId: COMPANY_A,
        memberId,
        periodStart,
        periodEnd: businessInstant(addLocalDays(start, 6)),
        status: week.status,
        approverMemberId: approverId,
        submittedAt: friday,
        submittedByMemberId: memberId,
        approvedAt: week.status === "APPROVED" ? decidedAt : null,
        approvedByMemberId: week.status === "APPROVED" ? approverId : null,
        returnedAt: week.status === "RETURNED" ? decidedAt : null,
        returnedByMemberId: week.status === "RETURNED" ? approverId : null,
        decisionNote: week.note ?? null,
        submissionVersion: 1,
        version: 2,
        createdAt: new Date(`${start}T08:00:00.000Z`),
      },
    });
    await prisma.workLog.createMany({
      data: week.entries.map((entry, index) => ({
        id: `${week.id}_log_${index + 1}`,
        companyId: COMPANY_A,
        timesheetId: week.id,
        memberId,
        workDate: businessInstant(addLocalDays(start, entry.day)),
        projectId: entry.project ?? null,
        taskId: entry.project && entry.task ? taskId(entry.project, entry.task) : null,
        workType: entry.type,
        minutes: entry.minutes,
        description: entry.description ?? null,
        billable: entry.billable ?? entry.type === "PROJECT_WORK",
        createdByMemberId: memberId,
      })),
    });
    logs += week.entries.length;

    await prisma.timesheetApproval.create({
      data: {
        id: week.approvalId,
        companyId: COMPANY_A,
        recordId: week.id,
        status: week.status === "SUBMITTED" ? "PENDING" : week.status,
        submissionVersion: 1,
        approverMemberId: approverId,
        submittedByMemberId: memberId,
        submittedAt: friday,
        decidedByMemberId: decided ? approverId : null,
        decidedAt: decided ? decidedAt : null,
        decisionNote: week.note ?? null,
      },
    });
    await prisma.approvalStep.create({
      data: {
        companyId: COMPANY_A,
        providerKey: "timesheets",
        approvalId: week.approvalId,
        stepNumber: 1,
        label: "Approver",
        approverMemberId: approverId,
        approverPermission: "timesheet.approve",
        status: week.status === "SUBMITTED" ? "PENDING" : week.status,
        decidedByMemberId: decided ? approverId : null,
        decidedAt: decided ? decidedAt : null,
        decisionNote: week.note ?? null,
      },
    });
  }

  return { weeks: WEEKS.length, logs, approvers: APPROVERS.length };
}
