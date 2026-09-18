import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { enqueueDueNotifications } from "@/lib/core/notifications/due-events";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { runAllRetentionPolicies } from "@/lib/core/retention/retention.service";
import { purgeExpiredThrottles } from "@/lib/core/security/throttle";
import { scannerEnabled } from "@/lib/core/storage";
import { runCalendarReminders } from "@/lib/modules/calendar/calendar.reminders";
import { extendMeetingSeries } from "@/lib/modules/meetings/meeting.series";
import { findOrphanedDocuments, reconcileStorageUsage, runStorageCleanup } from "@/lib/modules/documents/storage/cleanup.service";
import { runPendingScans } from "@/lib/modules/documents/storage/scan.service";
import type { JobHandler } from "./job.registry";

/**
 * What each scheduled job does (PRD #38 §93, PRD #51 §3). Kept apart from the
 * registry so a health probe reading it does not load every job's dependencies.
 *
 * A handler is a call into the owning domain's service and nothing else: no
 * query, no write, no business rule lives here (PRD #51 §3, §131, §199).
 */

/** A batch size from the environment; `validateWorkerEnvironment` has already refused a bad one at startup. */
export function batchSize(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback;
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  "notifications.dispatch": async ({ env, workerId, signal }) => {
    const result = await dispatchNotifications(batchSize(env, "NOTIFICATION_BATCH_SIZE", 100), workerId, { signal });
    return { processed: result.processed, detail: { ...result } };
  },
  "calendar.reminders": async ({ now }) => {
    const result = await runCalendarReminders(now);
    return { processed: result.fired, detail: result };
  },
  "approvals.overdue": async ({ now }) => {
    const { remindOverdueApprovals } = await import("@/lib/modules/approvals/approvals.overdue");
    const result = await remindOverdueApprovals(now);
    return { processed: result.enqueued, detail: result };
  },
  "timesheets.reminders": async ({ now }) => {
    const { runTimesheetReminders } = await import("@/lib/modules/timesheets/timesheet.deadline");
    const result = await runTimesheetReminders(now);
    return { processed: result.reminded, detail: result };
  },
  "dailylogs.missing": async ({ now }) => {
    const { remindMissingDailyLogs } = await import("@/lib/modules/daily-logs/daily-log.reports");
    const result = await remindMissingDailyLogs(now);
    return { processed: result.reminded, detail: result };
  },
  "announcements.schedule": async ({ now }) => {
    // Scheduled announcements go out when due, expired ones leave the feed; each once (PRD #45 §51-§53).
    const { runAnnouncementSchedule } = await import("@/lib/modules/announcements/announcement.publish");
    const result = await runAnnouncementSchedule(now);
    return { processed: result.published + result.expired + result.returnedToDraft, detail: result };
  },
  "announcements.reminders": async ({ now }) => {
    const { runAcknowledgmentReminders } = await import("@/lib/modules/announcements/announcement.publish");
    const result = await runAcknowledgmentReminders(now);
    return { processed: result.reminded, detail: result };
  },
  "engineering.reminders": async ({ now }) => {
    // RFI and submittal review due-soon and overdue notices, once per due date (PRD #46 §94, §106, §196).
    const { runEngineeringReminders } = await import("@/lib/modules/engineering/engineering.attention");
    const result = await runEngineeringReminders(now);
    return { processed: result.rfiDueSoon + result.rfiOverdue + result.submittalDueSoon + result.submittalOverdue, detail: result };
  },
  "contractors.compliance": async ({ now }) => {
    // Compliance items into EXPIRING and EXPIRED, and the people responsible told once per expiry date (PRD #46 §44-§46).
    const { runComplianceExpiry } = await import("@/lib/modules/contractors/contractor.compliance");
    const result = await runComplianceExpiry(now);
    return { processed: result.expiring + result.expired, detail: result };
  },
  "sales.unit-reservations": async ({ now }) => {
    // Unit reservations past their date expire and free the unit; a day before, the salesperson is warned (E-05E §25, §52).
    const { runUnitReservationExpiry } = await import("@/lib/modules/sales/units/unit-sales.expiry");
    const result = await runUnitReservationExpiry(now);
    return { processed: result.expired + result.warned, detail: result };
  },
  "hr.employment-changes": async ({ now }) => {
    // Scheduled employment changes take effect on their day, once each (E-03 §153-§157). The organization's
    // placement door keeps a department's team true to a transfer, as it does for a change made by hand.
    const { runScheduledEmploymentChanges } = await import("@/lib/modules/hr/employment/employment.schedule");
    const { placeMembership } = await import("@/lib/modules/organization/departments/placement.door");
    const result = await runScheduledEmploymentChanges(now, { placement: placeMembership });
    return { processed: result.applied + result.failed, detail: result };
  },
  "finance.unit-installments": async ({ now }) => {
    // Unit installments falling due within a week, and past due, are announced once (E-05F §94-§96).
    const { runUnitInstallmentNotices } = await import("@/lib/modules/finance/units/unit-finance.overdue");
    const result = await runUnitInstallmentNotices(now);
    return { processed: result.overdue + result.dueSoon, detail: result };
  },
  "recentwork.prune": async ({ now, dryRun }) => {
    // Older than the company's retention, or past the hundred newest per member (PRD #45 §104, §105).
    const { pruneRecentWork } = await import("@/lib/modules/productivity/recent-work.service");
    const result = await pruneRecentWork(now, { dryRun });
    return { processed: result.pruned, detail: result };
  },
  "planning.milestones": async ({ now }) => {
    // Due-soon and overdue reminders, once per milestone per target date (PRD #44 §74, §166, §167).
    const { runMilestoneReminders } = await import("@/lib/modules/project-planning/planning.attention");
    const result = await runMilestoneReminders(now);
    return { processed: result.dueSoon + result.overdue, detail: result };
  },
  "meetings.series": async ({ now }) => {
    const result = await extendMeetingSeries(now);
    return { processed: result.created, detail: result };
  },
  "notifications.due": async ({ now, lastSuccessAt }) => {
    const result = await enqueueDueNotifications({ now, since: lastSuccessAt });
    return { processed: result.tasksOverdue + result.obligationsDue, detail: result };
  },
  "attention.reconcile": async ({ now, dryRun }) => {
    const result = await reconcileAttention({ now, dryRun });
    return { processed: result.created + result.refreshed + result.resolved, detail: { ...result } };
  },
  "documents.scan": async ({ env }) => {
    // No scanner configured means nothing waits on one: files record NOT_REQUIRED.
    if (!scannerEnabled()) return { processed: 0, detail: { scanner: "none" } };
    const result = await runPendingScans(batchSize(env, "SCAN_BATCH_SIZE", 25));
    return { processed: result.scanned, detail: { ...result } };
  },
  "storage.cleanup": async ({ now, dryRun }) => {
    // Only expired upload sessions and their never-completed objects: a
    // document that became available is never touched here.
    const result = await runStorageCleanup({ dryRun, now });
    return { processed: result.sessionsExpired + result.documentsFailed + result.documentsRemoved, detail: { ...result } };
  },
  "storage.orphans": async () => {
    // Read-only: a missing object behind an available document is an
    // incident to restore from backup, not something to tidy away.
    const orphans = await findOrphanedDocuments({ limit: 1000 });
    return { processed: orphans.length, detail: { orphaned: orphans.length } };
  },
  "retention.run": async ({ env, dryRun: requestedDryRun }) => {
    // Deleting data is opted into per deployment; without the flag the job
    // reports what it would remove (PRD #34 §372).
    const dryRun = requestedDryRun || env.WORKER_RETENTION_APPLY !== "true";
    const results = await runAllRetentionPolicies({ dryRun });
    // Counts per policy only (§166): what a dry run is read for.
    const policies = Object.fromEntries(results.map((row) => [row.policyKey, row.dryRun ? row.candidateCount : row.deletedCount]));
    const total = Object.values(policies).reduce((sum, count) => sum + count, 0);
    return { processed: total, detail: { dryRun, policies } };
  },
  "storage.usage": async () => {
    const usage = await reconcileStorageUsage();
    return { processed: usage.length, detail: { companies: usage.length } };
  },
  "security.throttle-purge": async () => {
    return { processed: await purgeExpiredThrottles() };
  },
};
