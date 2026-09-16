/**
 * Notification dispatch, once (PRD #25 §230-§245, PRD #51 §163).
 *
 * Drains the notification outbox a batch at a time: producers enqueue events
 * inside their own transaction, and dispatch turns them into notifications for
 * the people entitled to hear about them. The worker does this every few
 * seconds (`pnpm worker`); this runs the same job once, through the same lease,
 * so it never races a worker that is already draining.
 *
 *   pnpm notifications:dispatch              one batch of up to 100 events
 *   pnpm notifications:dispatch --limit=500
 */
import { appEnvironment } from "../lib/config/env";
import { runJobNow } from "../lib/core/jobs/job.manual";
import { prisma } from "../lib/database/prisma";

const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = Number(limitArg?.slice("--limit=".length) ?? 100);

async function main() {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be a whole number from 1 to 1000");
  console.log(`Notification dispatch — environment=${appEnvironment()} limit=${limit}\n`);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  const outcome = await runJobNow("notifications.dispatch", {
    env: { ...process.env, NOTIFICATION_BATCH_SIZE: String(limit) },
    signal: controller.signal,
  });
  if (outcome.busy) {
    console.log("  a worker is dispatching right now; nothing to do here\n");
    return;
  }

  const detail = outcome.detail ?? {};
  console.log(`  ${outcome.status}: ${outcome.processed} event(s) processed, ${detail.notificationsCreated ?? 0} notification(s) created, ${detail.failed ?? 0} failed`);
  if (outcome.error) console.error(`  ${outcome.errorCode}: ${outcome.error}`);

  // A backlog that never drains is the failure worth seeing from a log line.
  const [pending, failed] = await Promise.all([
    prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.notificationEventOutbox.count({ where: { status: "FAILED" } }),
  ]);
  console.log(`  ${pending} still pending, ${failed} gave up after retries (pnpm worker --retry-failed)\n`);
  if (outcome.status !== "success") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Notification dispatch failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
