import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findWorkflowInconsistencies, type WorkflowConsistencyReport } from "@/lib/core/integrity/workflow-consistency";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * The read-only workflow verifier (AUD-10 §8, CW-21).
 *
 * Each inconsistency is injected as owned rows written straight to the
 * database — the state a broken service, a crash or a bad import would leave —
 * and the verifier must name it. Beside each, the sanctioned state it must
 * NOT name: a cancelled action, an archived task, an approval's imported
 * history, a pending unit correction. Then the part §8 cares about most: the
 * run changed nothing, checked by hashing every table it reads before and
 * after. Expectations are written from the PRD §5 mapping and the provider
 * contracts, never from the verifier's own output.
 */

const P = "aud10d_wc_";
const MEETING = "meeting_riverside_000";
const DAILY_LOG = "daily_log_riverside_draft";
const HOUR = 60 * 60 * 1000;
const SCOPE = { companyIds: [COMPANY.a, COMPANY.b], limit: 500 };

let pm: string;
let engineer: string;
let otherCompanyMember: string;
let report: WorkflowConsistencyReport;

/** Every table the verifier reads. */
const READ_TABLES = [
  "meeting_action_items", "meetings", "tasks", "audit_events", "activities", "notification_event_outbox", "notifications",
  "daily_log_task_links", "daily_log_delay_entries", "daily_log_instruction_entries", "daily_log_work_activities", "daily_log_document_links", "daily_logs",
  "project_milestone_task_links", "project_milestone_blockers", "unit_document_links", "documents", "document_versions", "document_reviews",
  "finance_approvals", "procurement_approvals", "sales_approvals", "contract_approvals", "quality_approvals", "hse_approvals", "timesheet_approvals",
  "unit_publication_approvals", "unit_sale_approvals", "hse_risk_assessments", "hse_incidents", "project_units", "attention_items",
];

async function tableHashes(): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const table of READ_TABLES) {
    const [row] = await prisma.$queryRawUnsafe<Array<{ hash: string }>>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash FROM "${table}" t`);
    hashes[table] = row.hash;
  }
  return hashes;
}

function ids(code: string): string[] {
  return report.findings.filter((finding) => finding.code === code).flatMap((finding) => finding.ids);
}

function reportedAnywhere(id: string): boolean {
  return report.findings.some((finding) => finding.ids.some((reported) => reported.endsWith(id) || reported.includes(`:${id}/`) || reported.includes(`/${id}`)));
}

async function task(id: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}) {
  await prisma.task.create({ data: { id: `${P}${id}`, companyId: COMPANY.a, title: "aud10d", createdByMemberId: pm, createdBy: "test", ...data } });
}

async function action(id: string, data: Partial<Prisma.MeetingActionItemUncheckedCreateInput> = {}) {
  await prisma.meetingActionItem.create({ data: { id: `${P}${id}`, companyId: COMPANY.a, meetingId: MEETING, title: "aud10d", createdByMemberId: pm, ...data } });
}

async function riskAssessment(id: string, status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED") {
  await prisma.hseRiskAssessment.create({ data: { id: `${P}${id}`, companyId: COMPANY.a, assessmentNumber: `${P}${id}`, title: "aud10d", assessmentDate: new Date(), createdByMemberId: pm, status } });
}

async function hseCycle(id: string, recordId: string, data: Partial<Prisma.HseApprovalUncheckedCreateInput> = {}) {
  await prisma.hseApproval.create({ data: { id: `${P}${id}`, companyId: COMPANY.a, recordType: "RISK_ASSESSMENT", recordId: `${P}${recordId}`, submittedByMemberId: pm, ...data } });
}

let multiplePendingGuarded = false;

async function cleanup() {
  await prisma.attentionItem.deleteMany({ where: { dedupeKey: { startsWith: P } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { startsWith: P } } });
  await prisma.activity.deleteMany({ where: { entityId: { startsWith: P } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { startsWith: P } } });
  await prisma.hseApproval.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.hseRiskAssessment.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.dailyLogTaskLink.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.dailyLogDelayEntry.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.meetingActionItem.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.task.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  pm = (await loginAs("PROJECT_MANAGER")).membershipId;
  engineer = (await loginAs("ENGINEER")).membershipId;
  otherCompanyMember = (await prisma.companyMember.findFirstOrThrow({ where: { companyId: COMPANY.b, status: "ACTIVE" }, select: { id: true } })).id;
  const now = Date.now();

  /* Meeting action ↔ task (§5) ------------------------------------------ */
  // Status drift: the task completed, the action still open.
  await task("t_done", { status: "COMPLETED", completedAt: new Date(), assigneeMemberId: engineer });
  await action("a_status", { linkedTaskId: `${P}t_done`, status: "OPEN", ownerMemberId: engineer });
  // Owner drift: reassigned task, action still with the old owner; statuses agree (BLOCKED → IN_PROGRESS).
  await task("t_blocked", { status: "BLOCKED", assigneeMemberId: engineer });
  await action("a_owner", { linkedTaskId: `${P}t_blocked`, status: "IN_PROGRESS", ownerMemberId: pm });
  // DONE with no completion time.
  await task("t_done2", { status: "COMPLETED", completedAt: new Date(), assigneeMemberId: pm });
  await action("a_completed_at", { linkedTaskId: `${P}t_done2`, status: "DONE", completedAt: null, ownerMemberId: pm });
  // Cross-company: an Aurelia action naming a Meridian task.
  await task("t_other_company", { companyId: COMPANY.b, createdByMemberId: otherCompanyMember, status: "TODO" });
  await action("a_cross", { linkedTaskId: `${P}t_other_company`, status: "OPEN" });
  // Sanctioned: a CANCELLED action is skipped by the sync — any task status, any owner.
  await task("t_for_cancelled", { status: "COMPLETED", completedAt: new Date(), assigneeMemberId: engineer });
  await action("a_cancelled", { linkedTaskId: `${P}t_for_cancelled`, status: "CANCELLED", ownerMemberId: pm });
  // Sanctioned: an ARCHIVED task leaves its action on the last mapped status.
  await task("t_archived", { status: "ARCHIVED", preArchiveStatus: "IN_PROGRESS", assigneeMemberId: pm });
  await action("a_archived", { linkedTaskId: `${P}t_archived`, status: "IN_PROGRESS", ownerMemberId: pm });
  // Positive control: a consistent pair.
  await task("t_ok", { status: "IN_PROGRESS", assigneeMemberId: pm });
  await action("a_ok", { linkedTaskId: `${P}t_ok`, status: "IN_PROGRESS", ownerMemberId: pm });

  // A duplicate conversion: two live tasks recorded as the conversion of one action.
  await task("t_conv1", { entityType: "meeting", entityId: MEETING });
  await task("t_conv2", { entityType: "meeting", entityId: MEETING });
  await action("a_dup", { linkedTaskId: `${P}t_conv2`, status: "OPEN" });
  // …and a retried conversion whose first task was archived: one live task, not a duplicate.
  await task("t_conv3", { status: "ARCHIVED", preArchiveStatus: "TODO", entityType: "meeting", entityId: MEETING });
  await task("t_conv4", { entityType: "meeting", entityId: MEETING });
  await action("a_dup_archived", { linkedTaskId: `${P}t_conv4`, status: "OPEN" });
  for (const [actionId, taskId] of [["a_dup", "t_conv1"], ["a_dup", "t_conv2"], ["a_dup_archived", "t_conv3"], ["a_dup_archived", "t_conv4"]]) {
    await prisma.auditEvent.create({
      data: { companyId: COMPANY.a, actorType: "SYSTEM", moduleKey: "meetings", category: "MEETING", actionKey: "MEETING_ACTION_TASK_CREATED", entityType: "Meeting", entityId: `${P}${actionId}`, metadataJson: { actionId: `${P}${actionId}`, taskId: `${P}${taskId}` } },
    });
  }

  /* Daily log entry ↔ task --------------------------------------------- */
  await task("t_delay_first");
  await task("t_delay_second");
  await prisma.dailyLogDelayEntry.create({ data: { id: `${P}delay`, companyId: COMPANY.a, dailyLogId: DAILY_LOG, category: "WEATHER", title: "aud10d", linkedTaskId: `${P}t_delay_second` } });
  // The entry was converted twice: its first task's link is no longer named by any entry.
  await prisma.dailyLogTaskLink.create({ data: { id: `${P}link_first`, companyId: COMPANY.a, dailyLogId: DAILY_LOG, taskId: `${P}t_delay_first`, linkType: "DELAY_ACTION", createdByMemberId: pm } });
  await prisma.dailyLogTaskLink.create({ data: { id: `${P}link_second`, companyId: COMPANY.a, dailyLogId: DAILY_LOG, taskId: `${P}t_delay_second`, linkType: "DELAY_ACTION", createdByMemberId: pm } });
  // The audit trail of the conversion records the same entry twice, for two live tasks.
  for (const taskId of ["t_delay_first", "t_delay_second"]) {
    await prisma.auditEvent.create({
      data: {
        companyId: COMPANY.a, actorType: "SYSTEM", moduleKey: "dailyLogs", category: "DAILY_LOG", actionKey: "DAILY_LOG_TASK_CREATED", entityType: "daily_log", entityId: `${P}delay_audit`,
        changesJson: { taskId: { before: null, after: `${P}${taskId}` }, entryId: { before: null, after: `${P}delay` }, section: { before: null, after: "delays" } },
      },
    });
  }
  // A link naming another company's task.
  await prisma.dailyLogTaskLink.create({ data: { id: `${P}link_cross`, companyId: COMPANY.a, dailyLogId: DAILY_LOG, taskId: `${P}t_other_company`, linkType: "RELATED", createdByMemberId: pm } });

  /* Approval source ↔ cycle (§4) --------------------------------------- */
  await riskAssessment("ra_no_cycle", "PENDING_APPROVAL");
  await riskAssessment("ra_not_pending", "APPROVED");
  await hseCycle("c_on_approved", "ra_not_pending");
  await riskAssessment("ra_ok", "PENDING_APPROVAL");
  await hseCycle("c_ok", "ra_ok");
  await riskAssessment("ra_two", "PENDING_APPROVAL");
  await hseCycle("c_two_a", "ra_two");
  try {
    await hseCycle("c_two_b", "ra_two");
  } catch (error) {
    // AUD-10 agent 2 adds a one-PENDING partial unique index: then the database refuses the duplicate outright.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    multiplePendingGuarded = true;
  }
  // A cycle filed under Meridian for an Aurelia record (cancelled, so nothing else about it is wrong).
  await prisma.hseApproval.create({ data: { id: `${P}c_cross`, companyId: COMPANY.b, recordType: "RISK_ASSESSMENT", recordId: `${P}ra_ok`, status: "CANCELLED", submittedByMemberId: otherCompanyMember } });

  /* Committed decision / completion ↔ outbox (§7) ----------------------- */
  const opened = new Date(now - 2 * HOUR);
  await riskAssessment("ra_decided_silent", "APPROVED");
  await hseCycle("c_decided_silent", "ra_decided_silent", { status: "APPROVED", createdAt: opened, submittedAt: opened, decidedAt: new Date(now - HOUR), decidedByMemberId: engineer });
  await riskAssessment("ra_decided_told", "APPROVED");
  await hseCycle("c_decided_told", "ra_decided_told", { status: "APPROVED", createdAt: opened, submittedAt: opened, decidedAt: new Date(now - HOUR), decidedByMemberId: engineer });
  await prisma.notificationEventOutbox.create({
    data: { companyId: COMPANY.a, eventType: "APPROVAL_APPROVED", moduleKey: "hse", entityType: "risk_assessment", entityId: `${P}ra_decided_told`, payloadJson: {}, status: "PROCESSED", createdAt: new Date(now - HOUR + 50) },
  });
  // Imported history: inserted already decided (the seed's backdated cycles) — not a transition.
  await riskAssessment("ra_history", "APPROVED");
  await hseCycle("c_history", "ra_history", { status: "APPROVED", submittedAt: new Date(now - 3 * HOUR), decidedAt: new Date(now - 2 * HOUR), decidedByMemberId: engineer });

  await task("t_completed_silent", { status: "COMPLETED", completedAt: new Date() });
  await prisma.activity.create({ data: { id: `${P}act_silent`, companyId: COMPANY.a, module: "tasks", entityType: "Task", entityId: `${P}t_completed_silent`, action: "TASK_COMPLETED", message: "completed the task" } });
  await task("t_completed_told", { status: "COMPLETED", completedAt: new Date() });
  await prisma.activity.create({ data: { id: `${P}act_told`, companyId: COMPANY.a, module: "tasks", entityType: "Task", entityId: `${P}t_completed_told`, action: "TASK_COMPLETED", message: "completed the task", correlationId: "corr_aud10d0000000000000000", createdAt: new Date(now - 24 * HOUR) } });
  // Matched by correlation id although written far apart in time.
  await prisma.notificationEventOutbox.create({
    data: { companyId: COMPANY.a, eventType: "TASK_COMPLETED", moduleKey: "tasks", entityType: "task", entityId: `${P}t_completed_told`, payloadJson: {}, correlationId: "corr_aud10d0000000000000000", status: "PROCESSED" },
  });

  /* Stale projection ----------------------------------------------------- */
  await prisma.attentionItem.create({
    data: { companyId: COMPANY.a, recipientMemberId: pm, conditionKey: "OVERDUE_TASK", moduleKey: "tasks", entityType: "task", entityId: `${P}t_done`, title: "aud10d", dedupeKey: `${P}stale` },
  });
});

afterAll(async () => {
  await cleanup();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("workflow consistency verifier (CW-21)", () => {
  it("changes no data", async () => {
    const before = await tableHashes();
    report = await findWorkflowInconsistencies(prisma, SCOPE);
    expect(await tableHashes()).toEqual(before);
  });

  it("names a linked action whose status or owner drifted from its task, and a DONE action with no completion time", () => {
    expect(ids("ACTION_TASK_STATUS_MISMATCH")).toContain(`meeting_action_items:${P}a_status`);
    expect(ids("ACTION_TASK_OWNER_MISMATCH")).toContain(`meeting_action_items:${P}a_owner`);
    expect(ids("ACTION_COMPLETED_AT_MISMATCH")).toContain(`meeting_action_items:${P}a_completed_at`);
    // The owner drift is not also a status drift: BLOCKED maps to IN_PROGRESS.
    expect(ids("ACTION_TASK_STATUS_MISMATCH")).not.toContain(`meeting_action_items:${P}a_owner`);
  });

  it("does not report the sanctioned exceptions: a cancelled action, an archived task, a consistent pair", () => {
    for (const quiet of ["a_cancelled", "a_archived", "a_ok"]) expect(reportedAnywhere(`${P}${quiet}`)).toBe(false);
  });

  it("names a duplicate conversion, but not a retry whose first task was archived", () => {
    expect(ids("DUPLICATE_CONVERSION")).toContain(`meeting_action_items:${P}a_dup`);
    expect(ids("DUPLICATE_CONVERSION")).not.toContain(`meeting_action_items:${P}a_dup_archived`);
  });

  it("names a daily log entry converted twice, and not the conversion the entry still names", () => {
    expect(ids("ORPHANED_CONVERSION")).toContain(`daily_log_task_links:${P}link_first`);
    expect(ids("ORPHANED_CONVERSION")).not.toContain(`daily_log_task_links:${P}link_second`);
    expect(ids("DUPLICATE_CONVERSION")).toContain(`daily_log_entry:${P}delay`);
  });

  it("names links across companies", () => {
    expect(ids("CROSS_COMPANY_LINK")).toEqual(
      expect.arrayContaining([`meeting_action_items:${P}a_cross`, `daily_log_task_links:${P}link_cross`, `hse_approvals:${P}c_cross`]),
    );
  });

  it("names an approval source and its cycle out of step, and more than one pending cycle", () => {
    expect(ids("APPROVAL_SOURCE_WITHOUT_CYCLE")).toContain(`hse_risk_assessments:${P}ra_no_cycle`);
    expect(ids("APPROVAL_CYCLE_WITHOUT_SOURCE")).toContain(`hse_approvals:${P}c_on_approved`);
    if (multiplePendingGuarded) {
      // The database refused the second PENDING cycle: the invariant is structural here.
      expect(ids("APPROVAL_MULTIPLE_PENDING")).not.toContain(`hse_approvals:RISK_ASSESSMENT/${P}ra_two`);
    } else {
      expect(ids("APPROVAL_MULTIPLE_PENDING")).toContain(`hse_approvals:RISK_ASSESSMENT/${P}ra_two`);
    }
    // Positive control: one PENDING cycle on a PENDING_APPROVAL source.
    expect(reportedAnywhere(`${P}ra_ok`)).toBe(false);
    expect(reportedAnywhere(`${P}c_ok`)).toBe(false);
  });

  it("names a committed decision and a committed completion with no outbox event — not the ones with one, nor imported history", () => {
    expect(ids("MISSING_EVENT_INTENT")).toContain(`hse_approvals:${P}c_decided_silent`);
    expect(ids("MISSING_EVENT_INTENT")).not.toContain(`hse_approvals:${P}c_decided_told`);
    expect(ids("MISSING_EVENT_INTENT")).not.toContain(`hse_approvals:${P}c_history`);
    expect(ids("MISSING_EVENT_INTENT")).toContain(`activities:${P}act_silent`);
    expect(ids("MISSING_EVENT_INTENT")).not.toContain(`activities:${P}act_told`);
  });

  it("warns — does not fail — on a stale attention item", () => {
    const stale = report.findings.find((finding) => finding.code === "STALE_PROJECTION");
    expect(stale?.level).toBe("warning");
    expect(stale?.count).toBeGreaterThanOrEqual(1);
  });

  it("reports ids and codes only, bounded, and finds every structural guard in place", async () => {
    const text = JSON.stringify(report);
    expect(text).not.toContain("aud10d\""); // no titles
    expect(report.findings.some((finding) => finding.code === "UNIQUE_GUARD_MISSING")).toBe(false);
    const bounded = await findWorkflowInconsistencies(prisma, { ...SCOPE, limit: 1 });
    for (const finding of bounded.findings) expect(finding.ids.length).toBeLessThanOrEqual(1);
    expect(bounded.errors).toBe(report.errors);
  });

  it("scoped to another company, reports none of these rows", async () => {
    const elsewhere = await findWorkflowInconsistencies(prisma, { companyIds: [COMPANY.c], limit: 500 });
    expect(JSON.stringify(elsewhere.findings)).not.toContain(P);
  });
});
