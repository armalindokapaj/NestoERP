import { prisma } from "@/lib/database/prisma";
import type { GaugeSample } from "./metrics";

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
    scanning,
    oldestScanning,
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
    prisma.document.count({ where: { storageStatus: "SCANNING" } }),
    prisma.document.findFirst({
      where: { storageStatus: "SCANNING" },
      orderBy: { updatedAt: "asc" },
      select: { updatedAt: true },
    }),
    prisma.document.count({ where: { storageStatus: { in: ["FAILED", "REJECTED"] }, updatedAt: { gte: hourAgo } } }),
  ]);

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
    { name: "mail_failed_last_hour", value: mailFailedHour, help: "Mail deliveries that failed in the last hour" },
    { name: "mail_sent_last_hour", value: mailSentHour, help: "Mail deliveries accepted in the last hour" },
    { name: "scan_queue_size", value: scanning, help: "Documents waiting for a malware verdict" },
    { name: "scan_queue_age_seconds", value: ageSeconds(oldestScanning?.updatedAt), help: "Age of the oldest document awaiting a scan" },
    { name: "upload_rejected_last_hour", value: uploadsFailedHour, help: "Uploads rejected or failed in the last hour" },
  ];

  // Per job, from the heartbeat rows the worker writes (PRD #38 §97).
  const { jobHealth } = await import("@/lib/core/jobs/job.health");
  for (const job of await jobHealth(now)) {
    gauges.push({
      name: "worker_last_success_age_seconds",
      labels: { job: job.job },
      value: job.lastSuccessAgeSeconds ?? -1,
      help: "Seconds since the job last succeeded (-1: never)",
    });
    gauges.push({
      name: "worker_job_healthy",
      labels: { job: job.job },
      value: job.state === "ok" ? 1 : 0,
      help: "1 when the job's last run succeeded within its expected interval",
    });
  }

  return gauges;
}
