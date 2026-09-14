import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { enqueueDueNotifications } from "@/lib/core/notifications/due-events";
import { dispatchNotifications, workerIdentity } from "@/lib/core/notifications/notification.dispatch";
import { runAllRetentionPolicies } from "@/lib/core/retention/retention.service";
import { purgeExpiredThrottles } from "@/lib/core/security/throttle";
import { scannerEnabled } from "@/lib/core/storage";
import { runCalendarReminders } from "@/lib/modules/calendar/calendar.reminders";
import { extendMeetingSeries } from "@/lib/modules/meetings/meeting.series";
import { findOrphanedDocuments, runStorageCleanup } from "@/lib/modules/documents/storage/cleanup.service";
import { runPendingScans } from "@/lib/modules/documents/storage/scan.service";
import type { JobHandler } from "./job.registry";

/**
 * What each scheduled job does (PRD #38 §93). Kept apart from the schedule so
 * a health probe reading the schedule does not load every job's dependencies.
 */

function batchSize(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback;
}

export const JOB_HANDLERS: Record<string, JobHandler> = {
  "notifications.dispatch": async ({ env }) => {
    const result = await dispatchNotifications(batchSize(env, "NOTIFICATION_BATCH_SIZE", 100), workerIdentity());
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
  "meetings.series": async ({ now }) => {
    const result = await extendMeetingSeries(now);
    return { processed: result.created, detail: result };
  },
  "notifications.due": async ({ now, lastSuccessAt }) => {
    const result = await enqueueDueNotifications({ now, since: lastSuccessAt });
    return { processed: result.tasksOverdue + result.obligationsDue, detail: result };
  },
  "attention.reconcile": async ({ now }) => {
    const result = await reconcileAttention({ now });
    return { processed: result.created + result.refreshed + result.resolved, detail: { ...result } };
  },
  "documents.scan": async ({ env }) => {
    // No scanner configured means nothing waits on one: files record NOT_REQUIRED.
    if (!scannerEnabled()) return { processed: 0, detail: { scanner: "none" } };
    const result = await runPendingScans(batchSize(env, "SCAN_BATCH_SIZE", 25));
    return { processed: result.scanned };
  },
  "storage.cleanup": async ({ now }) => {
    // Only expired upload sessions and their never-completed objects: a
    // document that became available is never touched here.
    const result = await runStorageCleanup({ dryRun: false, now });
    return { processed: result.sessionsExpired + result.documentsFailed + result.documentsRemoved, detail: { ...result } };
  },
  "storage.orphans": async () => {
    // Read-only: a missing object behind an available document is an
    // incident to restore from backup, not something to tidy away.
    const orphans = await findOrphanedDocuments({ limit: 1000 });
    return { processed: orphans.length, detail: { orphaned: orphans.length } };
  },
  "retention.run": async ({ env }) => {
    // Deleting data is opted into per deployment; without the flag the job
    // reports what it would remove (PRD #34 §372).
    const dryRun = env.WORKER_RETENTION_APPLY !== "true";
    const results = await runAllRetentionPolicies({ dryRun });
    const total = results.reduce((sum, row) => sum + (row.dryRun ? row.candidateCount : row.deletedCount), 0);
    return { processed: total, detail: { dryRun, policies: results.length } };
  },
  "security.throttle-purge": async () => {
    return { processed: await purgeExpiredThrottles() };
  },
};
