import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { attentionConditionDefinitions } from "@/lib/core/notifications/attention.conditions";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { loadRecord } from "@/lib/core/records/record.registry";
import { approvalQuerySchema } from "@/lib/modules/approvals/approvals.schema";
import { decideApproval, getApprovalDetail, listApprovals } from "@/lib/modules/approvals/approvals.service";
import { getCalendar } from "@/lib/modules/calendar/calendar.query";
import { addLocalDays, instantFromLocal, localDate } from "@/lib/modules/calendar/calendar.time";
import { runTimesheetReminders, submissionDeadline } from "@/lib/modules/timesheets/timesheet.deadline";
import { listTeamTimesheets, projectTimeSummary } from "@/lib/modules/timesheets/timesheet.reports";
import { projectSummaryQuerySchema, teamQuerySchema, workLogInputSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { getMyWeek, getTimesheet } from "@/lib/modules/timesheets/timesheet.service";
import { resolveTimesheetSettings } from "@/lib/modules/timesheets/timesheet.settings";
import { reopenTimesheet, submitTimesheet } from "@/lib/modules/timesheets/timesheet.submission";
import { businessInstant, weekStartOf } from "@/lib/modules/timesheets/timesheet.time";
import { copyDay, createWorkLog, deleteWorkLog, setCell, updateWorkLog } from "@/lib/modules/timesheets/timesheet.worklogs";
import { setApprover } from "@/lib/modules/timesheets/timesheet.approvers";
import { cleanupSessions, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Timesheets & Work Logs, against the real database (PRD #42 §246-§260).
 *
 * The HSE officer is the member under test: the seed leaves their weeks empty
 * and gives them the Project Manager as approver. Every week a test creates is
 * removed after it, with the approval cycle, notifications and attention it
 * left behind; seeded weeks are only read.
 */

const ZONE = "Europe/Tirane";
const TASK_A = "task_009"; // project_a, assigned to HSE
const TASK_B = "task_007"; // project_a, assigned to the Engineer
const COMPANY_B_TASK = "task_b_01";

let hse: UserContext;
let pm: UserContext;
let hr: UserContext;
let finance: UserContext;
let architect: UserContext;
let viewer: UserContext;
let startedAt: Date;
const extra = { leave: [] as string[], attendance: [] as string[] };

const today = () => localDate(new Date(), ZONE);
const thisWeek = () => weekStartOf(today(), 1);
/** Last week's Wednesday: always in the past, always inside the backdating window. */
const lastWednesday = () => addLocalDays(thisWeek(), -5);

const log = (overrides: Record<string, unknown> = {}) =>
  workLogInputSchema.parse({ workDate: today(), workType: "PROJECT_WORK", projectId: PROJECT.a, taskId: TASK_A, minutes: 120, description: "TSTEST entry", ...overrides });

const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });

async function cleanup() {
  const weeks = await prisma.timesheet.findMany({ where: { memberId: { in: [hse.membershipId, pm.membershipId, hr.membershipId] }, id: { not: { startsWith: "timesheet_" } } }, select: { id: true } });
  const ids = weeks.map((row) => row.id);
  const cycles = await prisma.timesheetApproval.findMany({ where: { recordId: { in: ids } }, select: { id: true } });
  const cycleIds = cycles.map((row) => row.id);
  await prisma.approvalStep.deleteMany({ where: { providerKey: "timesheets", approvalId: { in: cycleIds } } });
  await prisma.approvalDecisionReceipt.deleteMany({ where: { approvalId: { in: cycleIds } } });
  await prisma.timesheetApproval.deleteMany({ where: { id: { in: cycleIds } } });
  await prisma.workLog.deleteMany({ where: { timesheetId: { in: ids } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
  // Weeks the reminder job created for other members, still empty.
  await prisma.timesheet.deleteMany({ where: { id: { in: ids } } });
  const empties = await prisma.timesheet.findMany({ where: { createdAt: { gte: startedAt }, id: { not: { startsWith: "timesheet_" } }, workLogs: { none: {} } }, select: { id: true } });
  if (empties.length) {
    await prisma.notification.deleteMany({ where: { entityId: { in: empties.map((row) => row.id) } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: empties.map((row) => row.id) } } });
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: empties.map((row) => row.id) } } });
    await prisma.timesheet.deleteMany({ where: { id: { in: empties.map((row) => row.id) } } });
  }
  // Reminders are claimed per member and week (PRD #51 §17); without this the next run of the file finds last week already reminded.
  await prisma.jobIdempotencyKey.deleteMany({ where: { companyId: "company_demo_a", jobKey: "timesheets.reminders" } });
  await prisma.leaveRequest.deleteMany({ where: { id: { in: extra.leave } } });
  await prisma.attendanceRecord.deleteMany({ where: { id: { in: extra.attendance } } });
  extra.leave = [];
  extra.attendance = [];
  await prisma.timesheetSettings.update({ where: { companyId: "company_demo_a" }, data: { submitDay: null, submitTime: null, descriptionsRequired: false, backdateDays: 14 } });
  await prisma.timesheetApproverAssignment.upsert({
    where: { memberId: hse.membershipId },
    update: { approverMemberId: pm.membershipId },
    create: { companyId: "company_demo_a", memberId: hse.membershipId, approverMemberId: pm.membershipId },
  });
}

beforeAll(async () => {
  startedAt = new Date();
  [hse, pm, hr, finance, architect, viewer] = await Promise.all([loginAs("HSE"), loginAs("PROJECT_MANAGER"), loginAs("HR"), loginAs("FINANCE"), loginAs("ARCHITECT"), loginAs("VIEWER")]);
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function submitted(context = hse) {
  const created = await createWorkLog(context, log({ minutes: 480 }));
  const week = await getTimesheet(context, created.timesheetId);
  const result = await submitTimesheet(context, created.timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true });
  const cycle = await prisma.timesheetApproval.findFirstOrThrow({ where: { recordId: created.timesheetId, status: "PENDING" } });
  return { timesheetId: created.timesheetId, approvalId: cycle.id, week: result };
}

describe("work logs (§247, §250-§252)", () => {
  it("creates the week lazily, once, and edits and removes draft entries", async () => {
    const first = await createWorkLog(hse, log());
    const second = await createWorkLog(hse, log({ workType: "INTERNAL", projectId: null, taskId: null, minutes: 30 }));
    expect(second.timesheetId).toBe(first.timesheetId);
    expect(await prisma.timesheet.count({ where: { memberId: hse.membershipId, periodStart: businessInstant(thisWeek()) } })).toBe(1);

    const week = await getMyWeek(hse);
    expect(week.status).toBe("DRAFT");
    expect(week.totals.totalMinutes).toBe(150);
    expect(week.totals.billableMinutes).toBe(120);
    expect(week.rows).toHaveLength(2);

    await updateWorkLog(hse, first.workLogId, { ...log({ minutes: 90 }), updatedAt: undefined });
    expect((await prisma.workLog.findUniqueOrThrow({ where: { id: first.workLogId } })).minutes).toBe(90);
    await deleteWorkLog(hse, second.workLogId);
    expect((await getMyWeek(hse)).totals.totalMinutes).toBe(90);
  });

  it("refuses bad durations, missing projects, mismatched tasks, future and old dates", async () => {
    expect(() => log({ minutes: 3 })).toThrow();
    expect(() => log({ minutes: 1.5 })).toThrow();
    await expect(createWorkLog(hse, log({ projectId: null, taskId: null }))).rejects.toMatchObject(code("TIMESHEET_PROJECT_REQUIRED"));
    await expect(createWorkLog(hse, log({ workType: "INTERNAL", projectId: null, taskId: TASK_A }))).rejects.toMatchObject(code("TIMESHEET_TASK_PROJECT_MISMATCH"));
    await expect(createWorkLog(hse, log({ workDate: addLocalDays(today(), 1) }))).rejects.toMatchObject(code("TIMESHEET_INVALID_DATE"));
    await expect(createWorkLog(hse, log({ workDate: addLocalDays(today(), -15) }))).rejects.toMatchObject(code("TIMESHEET_BACKDATE_LIMIT"));
    await createWorkLog(hse, log({ minutes: 1000, taskId: null }));
    await expect(createWorkLog(hse, log({ minutes: 500, taskId: null }))).rejects.toMatchObject(code("TIMESHEET_DAILY_LIMIT"));
  });

  it("refuses projects and tasks the member cannot open, including another company's", async () => {
    await expect(createWorkLog(hse, log({ projectId: PROJECT.c, taskId: null }))).rejects.toMatchObject(code("TIMESHEET_PROJECT_NOT_ALLOWED"));
    await expect(createWorkLog(hse, log({ projectId: PROJECT.companyB, taskId: null }))).rejects.toMatchObject(code("TIMESHEET_PROJECT_NOT_ALLOWED"));
    await expect(createWorkLog(hse, log({ projectId: PROJECT.a, taskId: COMPANY_B_TASK }))).rejects.toMatchObject(code("TIMESHEET_TASK_NOT_ALLOWED"));
    await expect(createWorkLog(viewer, log())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sets grid cells: creates, updates, clears, and refuses a cell holding several entries", async () => {
    const cell = { workDate: today(), workType: "PROJECT_WORK" as const, projectId: PROJECT.a, taskId: TASK_B };
    const created = await setCell(hse, { ...cell, minutes: 60 });
    expect(created.timesheetId).toBeTruthy();
    await setCell(hse, { ...cell, minutes: 150 });
    expect((await getMyWeek(hse)).totals.totalMinutes).toBe(150);
    await setCell(hse, { ...cell, minutes: 0 });
    expect((await getMyWeek(hse)).totals.totalMinutes).toBe(0);

    await createWorkLog(hse, log({ taskId: TASK_B, minutes: 30 }));
    await createWorkLog(hse, log({ taskId: TASK_B, minutes: 45 }));
    await expect(setCell(hse, { ...cell, minutes: 60 })).rejects.toMatchObject(code("TIMESHEET_CELL_HAS_ENTRIES"));
  });

  it("copies a day onto another, skipping what the rules no longer allow", async () => {
    await createWorkLog(hse, log({ workDate: lastWednesday(), minutes: 240 }));
    const result = await copyDay(hse, { from: lastWednesday(), to: addLocalDays(lastWednesday(), 1) });
    expect(result).toEqual({ copied: 1, skipped: 0 });
    await expect(copyDay(hse, { from: lastWednesday(), to: addLocalDays(today(), 2) })).resolves.toEqual({ copied: 0, skipped: 1 });
  });
});

describe("submission and decisions (§66-§69, §80-§86, §248, §249, §253)", () => {
  it("refuses an empty week, warns below the expected week, and locks what it submits", async () => {
    const created = await createWorkLog(hse, log({ minutes: 60 }));
    const week = await getTimesheet(hse, created.timesheetId);
    await expect(submitTimesheet(hse, created.timesheetId, { expectedVersion: week.version - 1 })).rejects.toMatchObject(code("STALE_VERSION"));
    await expect(submitTimesheet(hse, created.timesheetId, { expectedVersion: week.version })).rejects.toMatchObject(code("TIMESHEET_BELOW_EXPECTED"));

    const result = await submitTimesheet(hse, created.timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true });
    expect(result.status).toBe("SUBMITTED");
    expect(result.approver?.memberId).toBe(pm.membershipId);
    expect(result.capabilities.canEdit).toBe(false);
    await expect(createWorkLog(hse, log())).rejects.toMatchObject(code("TIMESHEET_LOCKED"));
    await expect(updateWorkLog(hse, created.workLogId, log())).rejects.toMatchObject(code("TIMESHEET_LOCKED"));
    await expect(deleteWorkLog(hse, created.workLogId)).rejects.toMatchObject(code("TIMESHEET_LOCKED"));
    await expect(submitTimesheet(hse, created.timesheetId, { expectedVersion: result.version })).rejects.toMatchObject(code("TIMESHEET_ALREADY_SUBMITTED"));

    const step = await prisma.approvalStep.findFirstOrThrow({ where: { providerKey: "timesheets", approvalId: (await prisma.timesheetApproval.findFirstOrThrow({ where: { recordId: created.timesheetId } })).id } });
    expect(step).toMatchObject({ approverMemberId: pm.membershipId, approverPermission: "timesheet.approve", status: "PENDING" });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: created.timesheetId, eventType: "TIMESHEET_SUBMITTED" } })).toBe(1);
  });

  it("will not submit without an approver, or with a missing description the company requires", async () => {
    const created = await createWorkLog(hse, log({ description: null }));
    await prisma.timesheetSettings.update({ where: { companyId: "company_demo_a" }, data: { descriptionsRequired: true } });
    const week = await getTimesheet(hse, created.timesheetId);
    await expect(submitTimesheet(hse, created.timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true })).rejects.toMatchObject(code("TIMESHEET_DESCRIPTION_REQUIRED"));
    await prisma.timesheetSettings.update({ where: { companyId: "company_demo_a" }, data: { descriptionsRequired: false } });
    await prisma.timesheetApproverAssignment.deleteMany({ where: { memberId: hse.membershipId } });
    await expect(submitTimesheet(hse, created.timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true })).rejects.toMatchObject(code("TIMESHEET_NO_APPROVER"));
  });

  it("shows in the approver's Waiting for Me and the member's Requested, and nobody else decides it", async () => {
    const { approvalId, timesheetId } = await submitted();
    const waiting = await listApprovals(pm, approvalQuerySchema.parse({ tab: "waiting", provider: "timesheets" }));
    const item = waiting.items.find((row) => row.approvalId === approvalId);
    expect(item).toMatchObject({ providerKey: "timesheets", sourceType: "timesheet", canApprove: true, canReturn: true, canReject: true, totalSteps: null });

    const requested = await listApprovals(hse, approvalQuerySchema.parse({ tab: "requested", provider: "timesheets" }));
    expect(requested.items.map((row) => row.approvalId)).toContain(approvalId);

    // HR may approve timesheets, but this week belongs to its designated approver.
    const hrWaiting = await listApprovals(hr, approvalQuerySchema.parse({ tab: "waiting", provider: "timesheets" }));
    expect(hrWaiting.items.map((row) => row.approvalId)).not.toContain(approvalId);
    await expect(decideApproval(hr, "timesheets", approvalId, "APPROVE", { note: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideApproval(architect, "timesheets", approvalId, "APPROVE", { note: null })).rejects.toBeTruthy();

    const detail = await getApprovalDetail(pm, "timesheets", approvalId);
    expect(detail.chainMode).toBe("SINGLE");
    expect(detail.steps).toEqual([]);
    expect(detail.summary.map((field) => field.label)).toEqual(expect.arrayContaining(["Employee", "Week", "Total", "Billable", "Overtime", "Daily totals"]));
    expect(detail.description).toContain("TSTEST entry");
    expect(detail.discussion).toEqual({ parentType: "timesheet", parentId: timesheetId });
  });

  it("returns with a reason, takes a corrected resubmission, and approves it into a locked week", async () => {
    const { approvalId, timesheetId } = await submitted();
    await expect(decideApproval(pm, "timesheets", approvalId, "RETURN", { note: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await decideApproval(pm, "timesheets", approvalId, "RETURN", { note: "Split Monday between the two tasks." });

    let week = await getTimesheet(hse, timesheetId);
    expect(week.status).toBe("RETURNED");
    expect(week.decisionNote).toBe("Split Monday between the two tasks.");
    expect(week.capabilities.canEdit).toBe(true);
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: timesheetId, recipientMemberId: hse.membershipId, eventType: "TIMESHEET_RETURNED" } })).toBe(1);

    await createWorkLog(hse, log({ taskId: TASK_B, minutes: 60 }));
    week = await getTimesheet(hse, timesheetId);
    const resubmitted = await submitTimesheet(hse, timesheetId, { expectedVersion: week.version, acknowledgeShortfall: true });
    expect(resubmitted.submissionVersion).toBe(2);
    const next = await prisma.timesheetApproval.findFirstOrThrow({ where: { recordId: timesheetId, status: "PENDING" } });
    expect(next.id).not.toBe(approvalId);

    await decideApproval(pm, "timesheets", next.id, "APPROVE", { note: null });
    week = await getTimesheet(hse, timesheetId);
    expect(week.status).toBe("APPROVED");
    expect(week.history.map((entry) => entry.action)).toEqual(["Submitted", "Returned", "Resubmitted", "Approved"]);
    await expect(createWorkLog(hse, log())).rejects.toMatchObject(code("TIMESHEET_ALREADY_APPROVED"));
    expect(await prisma.auditEvent.count({ where: { entityId: timesheetId, actionKey: { in: ["TIMESHEET_SUBMITTED", "TIMESHEET_RETURNED", "TIMESHEET_APPROVED"] } } })).toBe(4);
  });

  it("rejects with a reason, and a rejected week can be corrected and submitted again", async () => {
    const { approvalId, timesheetId } = await submitted();
    await decideApproval(pm, "timesheets", approvalId, "REJECT", { note: "This week was logged against the wrong member." });
    const week = await getTimesheet(hse, timesheetId);
    expect(week.status).toBe("REJECTED");
    expect(week.capabilities.canSubmit).toBe(true);
  });

  it("never lets anybody approve their own week", async () => {
    const own = await submitted(pm);
    const waiting = await listApprovals(pm, approvalQuerySchema.parse({ tab: "waiting", provider: "timesheets" }));
    expect(waiting.items.map((row) => row.approvalId)).not.toContain(own.approvalId);
    await expect(decideApproval(pm, "timesheets", own.approvalId, "APPROVE", { note: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("moves a waiting week to a new approver, who is told", async () => {
    const { approvalId, timesheetId } = await submitted();
    const owner = await loginAs("OWNER");
    await setApprover(hr, { memberId: hse.membershipId, approverMemberId: owner.membershipId });
    const step = await prisma.approvalStep.findFirstOrThrow({ where: { providerKey: "timesheets", approvalId } });
    expect(step.approverMemberId).toBe(owner.membershipId);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheetId } })).approverMemberId).toBe(owner.membershipId);
    await expect(decideApproval(pm, "timesheets", approvalId, "APPROVE", { note: null })).rejects.toBeTruthy();
    await decideApproval(owner, "timesheets", approvalId, "APPROVE", { note: null });
    await expect(setApprover(hr, { memberId: hse.membershipId, approverMemberId: hse.membershipId })).rejects.toMatchObject(code("TIMESHEET_SELF_APPROVAL_BLOCKED"));
    await expect(setApprover(hr, { memberId: hse.membershipId, approverMemberId: architect.membershipId })).rejects.toMatchObject(code("TIMESHEET_APPROVER_NOT_ALLOWED"));
    await expect(setApprover(hr, { memberId: hse.membershipId, approverMemberId: "member_owner_b" })).rejects.toMatchObject(code("TIMESHEET_APPROVER_NOT_ALLOWED"));
  });
});

describe("reopening an approved week (§117-§119, §254)", () => {
  it("is for authorised people only, with a note, never on their own week", async () => {
    const { approvalId, timesheetId } = await submitted();
    await decideApproval(pm, "timesheets", approvalId, "APPROVE", { note: null });
    await expect(reopenTimesheet(pm, timesheetId, { note: "Correction needed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reopenTimesheet(hse, timesheetId, { note: "Correction needed" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const reopened = await reopenTimesheet(hr, timesheetId, { note: "Wrong project on Monday." });
    expect(reopened.status).toBe("RETURNED");
    expect(reopened.history.some((entry) => entry.note === "Wrong project on Monday.")).toBe(true);
    expect(await prisma.auditEvent.count({ where: { entityId: timesheetId, actionKey: "TIMESHEET_REOPENED" } })).toBe(1);
    await expect(reopenTimesheet(hr, timesheetId, { note: "Again" })).rejects.toMatchObject(code("TIMESHEET_NOT_APPROVED"));
  });
});

describe("reading other people's weeks (§87-§92, §122-§127, §231)", () => {
  it("lets the member, their approver and team readers open a week, and nobody else", async () => {
    const { timesheetId } = await submitted();
    await expect(getTimesheet(pm, timesheetId)).resolves.toMatchObject({ id: timesheetId });
    await expect(getTimesheet(hr, timesheetId)).resolves.toMatchObject({ id: timesheetId });
    await expect(getTimesheet(architect, timesheetId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getTimesheet(await loginAsEmail(DEMO_EMAIL.tenantOwner), timesheetId)).rejects.toBeTruthy();
    expect(await loadRecord(architect, "timesheet", timesheetId)).toBeNull();
    expect(await loadRecord(pm, "timesheet", timesheetId)).toMatchObject({ href: `/timesheets/${timesheetId}` });
  });

  it("lists the team's week with its status, and refuses the list to a member without team access", async () => {
    await submitted();
    const list = await listTeamTimesheets(pm, teamQuerySchema.parse({}));
    const row = list.rows.find((entry) => entry.member.memberId === hse.membershipId);
    expect(row).toMatchObject({ status: "SUBMITTED", totalMinutes: 480, approver: { memberId: pm.membershipId } });
    expect(list.rows.some((entry) => entry.member.memberId === pm.membershipId)).toBe(false);
    const onlySubmitted = await listTeamTimesheets(pm, teamQuerySchema.parse({ status: "SUBMITTED" }));
    expect(onlySubmitted.rows.every((entry) => entry.status === "SUBMITTED")).toBe(true);
    await expect(listTeamTimesheets(architect, teamQuerySchema.parse({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reports approved project hours by default, hides what people wrote from non-team readers", async () => {
    const approvedOnly = await projectTimeSummary(pm, projectSummaryQuerySchema.parse({ projectId: PROJECT.a, from: addLocalDays(thisWeek(), -28), to: today() }));
    const everything = await projectTimeSummary(pm, projectSummaryQuerySchema.parse({ projectId: PROJECT.a, from: addLocalDays(thisWeek(), -28), to: today(), include: "all" }));
    expect(approvedOnly.approvedOnly).toBe(true);
    expect(approvedOnly.totals.totalMinutes).toBeGreaterThan(0);
    expect(everything.totals.totalMinutes).toBeGreaterThan(approvedOnly.totals.totalMinutes);
    expect(approvedOnly.entries.every((entry) => entry.status === "APPROVED")).toBe(true);
    expect(approvedOnly.byMember.map((row) => row.memberId)).toEqual(expect.arrayContaining(["member_architect", "member_engineer"]));
    expect(approvedOnly.showsDescriptions).toBe(true);

    const financeView = await projectTimeSummary(finance, projectSummaryQuerySchema.parse({ projectId: PROJECT.a, from: addLocalDays(thisWeek(), -28), to: today() }));
    expect(financeView.showsDescriptions).toBe(false);
    expect(financeView.entries.every((entry) => entry.description === null)).toBe(true);
    expect(financeView.totals.totalMinutes).toBe(approvedOnly.totals.totalMinutes);

    await expect(projectTimeSummary(pm, projectSummaryQuerySchema.parse({ projectId: PROJECT.c }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(projectTimeSummary(architect, projectSummaryQuerySchema.parse({ projectId: PROJECT.a }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("HR, calendar, notifications and attention (§96-§105, §213-§216, §255-§259)", () => {
  it("lowers the expected week for approved leave, and compares attendance without logging anything", async () => {
    const profile = await prisma.employeeProfile.findUniqueOrThrow({ where: { companyMemberId: hse.membershipId } });
    const leave = await prisma.leaveRequest.create({
      data: { companyId: "company_demo_a", employeeProfileId: profile.id, companyMemberId: hse.membershipId, leaveType: "ANNUAL", startDate: businessInstant(lastWednesday()), endDate: businessInstant(lastWednesday()), days: 1, status: "APPROVED", createdByMemberId: hse.membershipId },
    });
    extra.leave.push(leave.id);
    const attendance = await prisma.attendanceRecord.create({
      data: { companyId: "company_demo_a", employeeProfileId: profile.id, companyMemberId: hse.membershipId, date: businessInstant(addLocalDays(lastWednesday(), 1)), status: "PRESENT", workedMinutes: 480, createdByMemberId: hr.membershipId },
    });
    extra.attendance.push(attendance.id);
    await createWorkLog(hse, log({ workDate: addLocalDays(lastWednesday(), 1), minutes: 120 }));

    const week = await getMyWeek(hse, { week: lastWednesday() });
    expect(week.totals.expectedMinutes).toBe(2400 - 480);
    expect(week.days.find((day) => day.date === lastWednesday())?.leave).toBeTruthy();
    expect(week.warnings.map((warning) => warning.code)).toContain("ATTENDANCE_DIFFERENCE");
    expect(week.logs).toHaveLength(1);
  });

  it("puts the submission deadline on the calendar only when the company has one", async () => {
    const range = { from: instantFromLocal(addLocalDays(today(), -14), "00:00", ZONE), to: instantFromLocal(addLocalDays(today(), 21), "00:00", ZONE) };
    const deadlines = async () => (await getCalendar(hse, range, {})).events.filter((event) => event.providerKey === "timesheets");
    expect(await deadlines()).toEqual([]);
    await prisma.timesheetSettings.update({ where: { companyId: "company_demo_a" }, data: { submitDay: 5, submitTime: "17:00" } });
    const events = await deadlines();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ category: "PERSONAL", draggable: false, title: "Timesheet due 17:00" });
  });

  it("reminds once per week before the deadline, and raises missing and overdue attention", async () => {
    await prisma.timesheetSettings.update({ where: { companyId: "company_demo_a" }, data: { submitDay: 5, submitTime: "17:00" } });
    const settings = await resolveTimesheetSettings("company_demo_a");
    const lastWeek = addLocalDays(thisWeek(), -7);
    const deadline = submissionDeadline(lastWeek, settings)!;
    const now = new Date(deadline.instant.getTime() + 60 * 60_000);

    const first = await runTimesheetReminders(now);
    expect(first.reminded).toBeGreaterThan(0);
    const again = await runTimesheetReminders(now);
    expect(again.reminded).toBe(0);
    const hseWeek = await prisma.timesheet.findFirstOrThrow({ where: { memberId: hse.membershipId, periodStart: businessInstant(lastWeek) } });
    expect(await prisma.notificationEventOutbox.count({ where: { entityId: hseWeek.id, eventType: "TIMESHEET_REMINDER" } })).toBe(1);

    const missing = attentionConditionDefinitions().find((row) => row.key === "TIMESHEET_NOT_SUBMITTED")!;
    const candidates = await missing.collect("company_demo_a", now);
    expect(candidates.find((row) => row.entityId === hseWeek.id)?.recipients).toEqual([hse.membershipId]);
    expect(await missing.holds("company_demo_a", "timesheet", hseWeek.id, now)).toBe(true);

    const { approvalId, timesheetId } = await submitted();
    await prisma.timesheetApproval.update({ where: { id: approvalId }, data: { submittedAt: new Date(Date.now() - 4 * 86_400_000) } });
    const overdue = attentionConditionDefinitions().find((row) => row.key === "TIMESHEET_APPROVAL_OVERDUE")!;
    const late = await overdue.collect("company_demo_a", new Date());
    expect(late.find((row) => row.entityId === timesheetId)).toMatchObject({ recipients: [pm.membershipId], exclude: [hse.membershipId] });

    const pending = attentionConditionDefinitions().find((row) => row.key === "PENDING_APPROVAL")!;
    expect((await pending.collect("company_demo_a", new Date())).find((row) => row.entityId === timesheetId)?.recipients).toEqual([pm.membershipId]);
    await decideApproval(pm, "timesheets", approvalId, "APPROVE", { note: null });
    expect(await overdue.holds("company_demo_a", "timesheet", timesheetId, new Date())).toBe(false);
    expect(await pending.holds("company_demo_a", "timesheet", timesheetId, new Date())).toBe(false);
  });

  it("tells the approver on submit and the member on approval", async () => {
    const { approvalId, timesheetId } = await submitted();
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: timesheetId, recipientMemberId: pm.membershipId, eventType: "TIMESHEET_SUBMITTED" } })).toBe(1);
    await decideApproval(pm, "timesheets", approvalId, "APPROVE", { note: null });
    await dispatchNotifications(500);
    expect(await prisma.notification.count({ where: { entityId: timesheetId, recipientMemberId: hse.membershipId, eventType: "TIMESHEET_APPROVED" } })).toBe(1);
  });
});
