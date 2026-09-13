/**
 * The NESTO worker (PRD #38 §79, §93-§97).
 *
 * One entry point for every background job — notification delivery, document
 * scanning, storage cleanup, attention reconciliation, date-driven reminders,
 * retention. Deployed as its own process (or processes, one per group), never
 * inside a web instance: web instances scale with traffic, and scheduled work
 * must not multiply with them (PRD #38 §94, §95).
 *
 *   pnpm worker                                   run every group, forever
 *   pnpm worker --group=notifications             one group (repeatable, or comma-separated)
 *   pnpm worker --once                            one pass over due jobs, then exit (platform cron)
 *   pnpm worker --once --job=attention.reconcile  one job, if it is due
 *   pnpm worker --status                          print job health and exit
 *   pnpm worker --retry-failed [--event=TYPE]     return FAILED outbox events to the queue and exit
 *
 * Several workers may run at once: each job is claimed through a lease before
 * it runs, so a job runs on one of them at a time.
 */
import { appEnvironment } from "../lib/config/env";
import { JOBS, WORKER_GROUPS, type WorkerGroup } from "../lib/core/jobs/job.registry";
import { jobHealth } from "../lib/core/jobs/job.health";
import { runDueJobs } from "../lib/core/jobs/job.runner";
import { retryFailedNotificationEvents, workerIdentity } from "../lib/core/notifications/notification.dispatch";
import { prisma } from "../lib/database/prisma";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) =>
  argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .flatMap((arg) => arg.slice(name.length + 3).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const TICK_MS = 5_000;

async function main() {
  const owner = workerIdentity();

  if (flag("retry-failed")) {
    const eventType = values("event")[0];
    const count = await retryFailedNotificationEvents({ eventType });
    console.log(`Returned ${count} failed notification event(s) to the queue${eventType ? ` (${eventType})` : ""}.`);
    return;
  }

  if (flag("status")) {
    for (const row of await jobHealth()) {
      const age = row.lastSuccessAgeSeconds === null ? "never" : `${row.lastSuccessAgeSeconds}s ago`;
      console.log(`  ${row.job.padEnd(26)} ${row.group.padEnd(14)} ${row.state.padEnd(10)} last success ${age}`);
    }
    const pending = await prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
    const failed = await prisma.notificationEventOutbox.count({ where: { status: "FAILED" } });
    console.log(`\n  notification outbox: ${pending} pending, ${failed} failed`);
    return;
  }

  const requested = values("group");
  const unknown = requested.filter((group) => !WORKER_GROUPS.includes(group as WorkerGroup));
  if (unknown.length > 0) throw new Error(`Unknown worker group: ${unknown.join(", ")}`);
  const groups: WorkerGroup[] = requested.length > 0 ? (requested as WorkerGroup[]) : [...WORKER_GROUPS];

  const only = values("job")[0];
  if (only && !JOBS.some((job) => job.key === only)) throw new Error(`Unknown job: ${only}`);

  console.log(`NESTO worker — environment=${appEnvironment()} instance=${owner} groups=${groups.join(",")}${only ? ` job=${only}` : ""}`);

  if (flag("once")) {
    const outcomes = await runDueJobs(groups, owner, only);
    for (const outcome of outcomes) {
      console.log(`  ${outcome.job.padEnd(26)} ${outcome.status.padEnd(8)} ${outcome.processed} processed${outcome.error ? ` — ${outcome.error}` : ""}`);
    }
    if (outcomes.some((outcome) => outcome.status === "failure")) process.exitCode = 1;
    return;
  }

  // Finish the job in hand on SIGTERM rather than abandoning it mid-batch; its
  // lease would expire anyway, but a clean stop keeps the heartbeat honest.
  let stopping = false;
  const stop = () => {
    if (!stopping) console.log("Stopping after the current job…");
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  while (!stopping) {
    try {
      await runDueJobs(groups, owner, only);
    } catch (error) {
      // The runner records job failures itself; this is the database going away.
      console.error("Worker pass failed:", error instanceof Error ? error.message : error);
    }
    for (let waited = 0; waited < TICK_MS && !stopping; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

main()
  .catch((error) => {
    console.error("Worker failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
