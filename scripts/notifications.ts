/**
 * Notification dispatch worker (PRD #25 §230-§245).
 *
 * Drains the notification outbox: producers enqueue events inside their own
 * transaction, and this turns them into notifications for the people entitled
 * to hear about them. Idempotent — every notification carries a dedupe key, so
 * running this twice over the same event produces one notification.
 *
 * Meant to run on a schedule. It is deliberately a separate process rather than
 * something a request does on the way past: a person submitting an invoice
 * should not wait while the company's approvers are resolved.
 *
 *   tsx scripts/notifications.ts              drain up to 100 events
 *   tsx scripts/notifications.ts --limit=500
 */
import { appEnvironment } from "../lib/config/env";
import { dispatchNotifications } from "../lib/core/notifications/notification.dispatch";
import { prisma } from "../lib/database/prisma";

const args = new Set(process.argv.slice(2));
const limitArg = [...args].find((arg) => arg.startsWith("--limit="));
const limit = Number(limitArg?.slice("--limit=".length) ?? 100);

async function main() {
  console.log(`Notification dispatch — environment=${appEnvironment()} limit=${limit}\n`);

  const result = await dispatchNotifications(limit);

  console.log(
    `  ${result.processed} event(s) processed, ` +
      `${result.notificationsCreated} notification(s) created, ` +
      `${result.failed} failed`,
  );

  // A backlog that never drains is the failure worth seeing from a log line.
  const pending = await prisma.notificationEventOutbox.count({ where: { status: "PENDING" } });
  const failed = await prisma.notificationEventOutbox.count({ where: { status: "FAILED" } });
  console.log(`  ${pending} still pending, ${failed} gave up after retries\n`);
}

main()
  .catch((error) => {
    console.error(
      "Notification dispatch failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  })
  .then(() => process.exit(0));
