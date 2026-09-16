import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import type { GaugeSample } from "./metrics";

/**
 * How long a scan claim lives before the sweep takes it back: the documents
 * domain's `SCAN_LEASE_MS`, repeated here because core does not import a module.
 * `tests/unit/observability/scan-gauges.test.ts` holds the two equal.
 */
export const SCAN_LEASE_SECONDS = 15 * 60;

/**
 * Gauges read from shared state at scrape time (PRD #38 §97, §105-§108).
 *
 * A backlog is one number for the whole deployment, so it is asked of the
 * database rather than kept by each instance. Every query is an indexed count
 * or a single ordered row.
 */
export async function operationalGauges(now: Date = new Date()): Promise<GaugeSample[]> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [
    outboxPending,
    outboxFailed,
    oldestPending,
    mailFailedHour,
    mailSentHour,
    uploadsFailedHour,
  ] = await Promise.all([
    prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.notificationEventOutbox.count({ where: { status: "FAILED" } }),
    prisma.notificationEventOutbox.findFirst({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.mailDelivery.count({ where: { status: "FAILED", createdAt: { gte: hourAgo } } }),
    prisma.mailDelivery.count({ where: { status: "SENT", createdAt: { gte: hourAgo } } }),
    prisma.document.count({ where: { storageStatus: { in: ["FAILED", "REJECTED"] }, updatedAt: { gte: hourAgo } } }),
  ]);

  // Due now, as opposed to waiting out a retry delay: the backlog a healthy
  // dispatcher should be draining, by the database's clock (PRD #51 §105).
  const [due] = await prisma.$queryRaw<Array<{ count: number; oldest: Date | null }>>`
    SELECT COUNT(*)::int AS "count", MIN("createdAt") AS "oldest" FROM "notification_event_outbox"
    WHERE ("status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${DB_NOW}))
       OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < ${DB_NOW})`;

  // The scan queue, documents and document versions alike (PRD #51 §105, §124).
  // A version that is its document's current version mirrors the document and
  // holds no claim of its own, so only the others count. Age is from upload:
  // `updatedAt` moves on every claim and would hide a file retried for hours.
  const [scan] = await prisma.$queryRaw<
    Array<{ waiting: number; oldest: Date | null; retrying: number; abandoned: number; failedHour: number; quarantineOwed: number }>
  >`
    WITH files AS (
      SELECT d."storageStatus", d."scanStatus", d."scanStartedAt", d."scanAttempts", d."scanCompletedAt", d."rejectionReason",
             d."updatedAt", COALESCE(d."uploadedAt", d."createdAt") AS "queuedAt"
      FROM "documents" d
      WHERE d."storageStatus" IN ('SCANNING', 'FAILED', 'REJECTED')
      UNION ALL
      SELECT v."storageStatus", v."scanStatus", v."scanStartedAt", v."scanAttempts", v."scanCompletedAt", v."rejectionReason",
             v."updatedAt", v."createdAt" AS "queuedAt"
      FROM "document_versions" v
      JOIN "documents" d ON d."id" = v."documentId"
      WHERE v."storageStatus" IN ('SCANNING', 'FAILED', 'REJECTED') AND d."currentVersionId" IS DISTINCT FROM v."id"
    )
    SELECT
      COUNT(*) FILTER (WHERE "storageStatus" = 'SCANNING')::int AS "waiting",
      MIN("queuedAt") FILTER (WHERE "storageStatus" = 'SCANNING') AS "oldest",
      COUNT(*) FILTER (WHERE "storageStatus" = 'SCANNING' AND "scanStatus" IN ('PENDING', 'ERROR') AND "scanAttempts" > 0)::int AS "retrying",
      COUNT(*) FILTER (
        WHERE "storageStatus" = 'SCANNING' AND "scanStatus" = 'SCANNING'
          AND COALESCE("scanStartedAt", "updatedAt") < ${DB_NOW} - ${SCAN_LEASE_SECONDS} * interval '1 second'
      )::int AS "abandoned",
      COUNT(*) FILTER (
        WHERE "storageStatus" = 'FAILED' AND "rejectionReason" = 'FILE_SCAN_FAILED' AND "scanCompletedAt" >= ${DB_NOW} - interval '1 hour'
      )::int AS "failedHour",
      COUNT(*) FILTER (WHERE "storageStatus" = 'REJECTED' AND "scanStatus" = 'INFECTED' AND "scanStartedAt" IS NOT NULL)::int AS "quarantineOwed"
    FROM files`;

  const ageSeconds = (date: Date | null | undefined) =>
    date ? Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000)) : 0;

  const gauges: GaugeSample[] = [
    { name: "notification_outbox_pending", value: outboxPending, help: "Outbox events not yet processed" },
    { name: "notification_outbox_failed", value: outboxFailed, help: "Outbox events that exhausted their retries" },
    {
      name: "notification_oldest_pending_age_seconds",
      value: ageSeconds(oldestPending?.createdAt),
      help: "Age of the oldest unprocessed outbox event",
    },
    { name: "notification_outbox_due", value: due?.count ?? 0, help: "Outbox events due for delivery now, excluding those waiting out a retry delay" },
    {
      name: "notification_oldest_due_age_seconds",
      value: ageSeconds(due?.oldest),
      help: "Age of the oldest outbox event that is due and not yet delivered",
    },
    { name: "mail_failed_last_hour", value: mailFailedHour, help: "Mail deliveries that failed in the last hour" },
    { name: "mail_sent_last_hour", value: mailSentHour, help: "Mail deliveries accepted in the last hour" },
    { name: "scan_queue_size", value: scan?.waiting ?? 0, help: "Documents and versions waiting for a malware verdict" },
    { name: "scan_queue_age_seconds", value: ageSeconds(scan?.oldest), help: "Seconds since the longest-waiting file was uploaded" },
    { name: "scan_retrying", value: scan?.retrying ?? 0, help: "Files waiting out a retry after the scanner gave no verdict" },
    { name: "scan_claims_abandoned", value: scan?.abandoned ?? 0, help: "Scans claimed longer ago than the scan lease: the scanning worker or request died" },
    { name: "scan_failed_last_hour", value: scan?.failedHour ?? 0, help: "Files failed in the last hour after the scanner gave no verdict in all their attempts" },
    { name: "scan_quarantine_owed", value: scan?.quarantineOwed ?? 0, help: "Rejected infected files whose object has not yet moved to quarantine" },
    { name: "upload_rejected_last_hour", value: uploadsFailedHour, help: "Uploads rejected or failed in the last hour" },
  ];

  // Per job and per worker group, from the heartbeat rows, the process
  // heartbeats and the failure history (PRD #38 §97, PRD #51 §119).
  const { workerGauges } = await import("@/lib/core/jobs/job.metrics");
  const { scannerEnabled } = await import("@/lib/core/storage");
  gauges.push(...(await workerGauges({ capabilities: { scanner: scannerEnabled() } })));

  return gauges;
}
