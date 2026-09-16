/**
 * The NESTO worker (PRD #38 §79, §93-§97, PRD #51 §44-§58, §163-§166, §203-§211).
 *
 * The one production mechanism for background work: long-running worker
 * processes started from the same artifact and environment as the web tier.
 * Web instances never run scheduled work — they scale with traffic, and a job
 * must not multiply with them — and no HTTP endpoint triggers a job (§216).
 *
 *   pnpm worker                                     run every group, forever
 *   pnpm worker --group=notifications               one group (repeatable, or comma-separated)
 *   pnpm worker --once [--group=…] [--job=…]        one pass over due jobs, then exit (development)
 *
 *   pnpm worker --run=<job> [--dry-run] [--company=<id>,…]
 *                                                   run one job now, through its lease (§163-§166)
 *   pnpm worker --status                            jobs, worker processes, outbox, failures
 *   pnpm worker --health [--group=…]                exit 0 when this host's worker is alive (container healthcheck)
 *   pnpm worker --validate                          registry and environment only, then exit
 *   pnpm worker --failures [--job=…] [--company=…] [--limit=50]
 *                                                   the failure history, newest first
 *   pnpm worker --retry-failed --operator=<name> [--event=TYPE] [--id=…] [--company=…]
 *                                                   send FAILED outbox events round again (§38, §39)
 *
 * Several workers may run at once, and an old and a new one overlap during a
 * deploy: each job is claimed through a lease before it runs, so it runs on one
 * of them at a time, and every job is safe to run twice.
 */
import { hostname } from "node:os";

import { appEnvironment } from "../lib/config/env";
import { failuresSince } from "../lib/core/jobs/job.metrics";
import { JOB_HANDLERS } from "../lib/core/jobs/job.handlers";
import { workerHealth } from "../lib/core/jobs/job.health";
import { listJobFailures } from "../lib/core/jobs/job.failures";
import { findJob, JOBS, jobUnavailableReason, validateRegistry, WORKER_GROUPS, type JobDefinition, type WorkerGroup } from "../lib/core/jobs/job.registry";
import { runJobNow } from "../lib/core/jobs/job.manual";
import { shutdownTimeoutSeconds, workerEnvironmentProblems } from "../lib/core/jobs/worker.env";
import { runWorker } from "../lib/core/jobs/worker.loop";
import { liveWorkers, newWorkerId, workerVersion } from "../lib/core/jobs/worker.process";
import { retryFailedNotificationEvents } from "../lib/core/notifications/notification.dispatch";
import { scannerEnabled } from "../lib/core/storage";
import { storageProvider } from "../lib/core/storage/storage-provider.factory";
import { prisma } from "../lib/database/prisma";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string) =>
  argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .flatMap((arg) => arg.slice(name.length + 3).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

const capabilities = () => ({ scanner: scannerEnabled() });

/** Registry, environment, database — and storage when a documents job will run (§53, §54, §114, §211). */
async function startupProblems(groups: readonly WorkerGroup[]): Promise<string[]> {
  const problems = [...validateRegistry(JOBS, JOB_HANDLERS, process.env), ...workerEnvironmentProblems()];
  if (problems.length > 0) return problems;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return ["the database is not reachable"];
  }
  const storageJobs = JOBS.filter((job) => groups.includes(job.group) && job.owner === "documents" && !jobUnavailableReason(job, { capabilities: capabilities() }));
  if (storageJobs.length > 0) {
    const health = await storageProvider()
      .healthCheck()
      .catch(() => ({ ok: false }));
    // Cleanup against storage that is not answering would see every object as missing.
    if (!health.ok) problems.push("object storage is not reachable");
  }
  return problems;
}

function requestedGroups(): WorkerGroup[] {
  const requested = values("group");
  const unknown = requested.filter((group) => !WORKER_GROUPS.includes(group as WorkerGroup));
  if (unknown.length > 0) throw new Error(`Unknown worker group: ${unknown.join(", ")}`);
  return requested.length > 0 ? (requested as WorkerGroup[]) : [...WORKER_GROUPS];
}

function describeJobs(groups: readonly WorkerGroup[]) {
  for (const job of JOBS.filter((candidate) => groups.includes(candidate.group))) {
    const reason = jobUnavailableReason(job, { capabilities: capabilities() });
    const cadence = job.trigger === "MANUAL" ? "manual" : `every ${job.intervalSeconds}s`;
    console.log(`  ${reason ? "–" : "✓"} ${job.key.padEnd(26)} ${job.criticality.padEnd(9)} ${cadence}${reason ? ` — not running: ${reason}` : ""}`);
  }
}

async function status() {
  const health = await workerHealth({ capabilities: capabilities() });
  console.log(`Worker tier: ${health.status}${health.reasons.length ? ` — ${health.reasons.join("; ")}` : ""}\n`);
  console.log("  Processes");
  if (health.workers.length === 0) console.log("    none alive");
  for (const worker of health.workers) {
    console.log(`    ${worker.workerId.padEnd(40)} ${worker.status.padEnd(9)} v${worker.version} groups=${worker.groups.join(",")} beat ${worker.heartbeatAgeSeconds}s ago${worker.currentJob ? ` running ${worker.currentJob}` : ""}`);
  }
  console.log("\n  Jobs");
  for (const row of health.jobs) {
    const age = row.lastSuccessAgeSeconds === null ? "never" : `${row.lastSuccessAgeSeconds}s ago`;
    const failing = row.consecutiveFailures > 0 ? ` ${row.consecutiveFailures} failure(s) in a row (${row.lastErrorCode ?? "?"})` : "";
    console.log(`    ${row.job.padEnd(26)} ${row.group.padEnd(14)} ${row.state.padEnd(10)} ${row.running ? "running " : ""}last success ${age}${failing}`);
  }
  const [pending, failed, recentFailures] = await Promise.all([
    prisma.notificationEventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.notificationEventOutbox.count({ where: { status: "FAILED" } }),
    failuresSince(60 * 60),
  ]);
  console.log(`\n  Notification outbox: ${pending} pending, ${failed} failed`);
  console.log(`  Failed attempts in the last hour: ${recentFailures}`);
}

async function health(groups: readonly WorkerGroup[]) {
  const problems = [...validateRegistry(JOBS, JOB_HANDLERS, process.env)];
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    problems.push("the database is not reachable");
  }
  if (problems.length === 0) {
    const mine = (await liveWorkers()).filter((worker) => worker.hostname === hostname() && worker.status === "RUNNING");
    const covered = new Set(mine.flatMap((worker) => worker.groups));
    const missing = groups.filter((group) => !covered.has(group));
    if (missing.length > 0) problems.push(`no live worker on this host runs ${missing.join(", ")}`);
  }
  if (problems.length > 0) {
    console.error(`unhealthy: ${problems.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("healthy");
  }
}

async function manualRun(job: JobDefinition) {
  const dryRun = flag("dry-run");
  const companyIds = values("company");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.log(`Running ${job.key} now${dryRun ? " (dry run)" : ""}${companyIds.length ? ` for ${companyIds.join(", ")}` : ""}`);
  const outcome = await runJobNow(job.key, { dryRun, companyIds, signal: controller.signal, capabilities: capabilities() });
  if (outcome.busy) {
    console.error("  another worker holds this job right now; try again when it finishes");
    process.exitCode = 1;
    return;
  }
  // Counts only: a dry run's output is for deciding, never a copy of the data (§166).
  console.log(`  ${outcome.status} — ${outcome.processed} processed in ${outcome.durationMs} ms (correlation ${outcome.correlationId})`);
  if (outcome.detail) console.log(`  ${JSON.stringify(outcome.detail)}`);
  if (outcome.error) console.error(`  ${outcome.errorCode}: ${outcome.error}`);
  if (outcome.status !== "success") process.exitCode = 1;
}

async function main() {
  const workerId = newWorkerId();

  if (flag("validate")) {
    const problems = [...validateRegistry(JOBS, JOB_HANDLERS, process.env), ...workerEnvironmentProblems()];
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    if (problems.length > 0) process.exitCode = 1;
    else console.log(`  ✓ ${JOBS.length} jobs registered, environment valid`);
    return;
  }

  if (flag("retry-failed")) {
    const operator = values("operator")[0];
    if (!operator) throw new Error("--retry-failed needs --operator=<your name>: a manual retry records who sent the events round again");
    const result = await retryFailedNotificationEvents({ operator, eventType: values("event")[0], ids: values("id"), companyId: values("company")[0] });
    console.log(`Returned ${result.count} failed notification event(s) to the queue. Their failure history is kept.`);
    return;
  }

  if (flag("failures")) {
    const rows = await listJobFailures({ jobKey: values("job")[0], companyId: values("company")[0], limit: Number(values("limit")[0] ?? 50) });
    for (const row of rows) {
      console.log(
        `  ${row.failedAt.toISOString()} ${row.jobKey.padEnd(24)} ${row.errorCode.padEnd(20)} attempt ${row.attempt}${row.retryable ? "" : " (permanent)"} ${row.sourceType}:${row.sourceId ?? "-"}${row.companyId ? ` company=${row.companyId}` : ""}${row.retriedBy ? ` retried by ${row.retriedBy}` : ""}\n      ${row.errorMessage}`,
      );
    }
    if (rows.length === 0) console.log("  no failures recorded");
    return;
  }

  if (flag("status")) return status();

  const groups = requestedGroups();
  if (flag("health")) return health(groups);

  const manual = values("run")[0];
  const only = values("job")[0];
  const named = manual ?? only;
  if (named && !findJob(named)) throw new Error(`Unknown job: ${named}`);

  const problems = await startupProblems(manual ? [findJob(manual)!.group] : groups);
  if (problems.length > 0) {
    // A worker that starts on a broken configuration fails later, quietly (§54).
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    throw new Error("Worker startup refused");
  }

  if (manual) return manualRun(findJob(manual)!);

  console.log(`NESTO worker — environment=${appEnvironment()} worker=${workerId} version=${workerVersion()} groups=${groups.join(",")}${only ? ` job=${only}` : ""}`);
  describeJobs(groups);

  const controller = new AbortController();
  const deadline = shutdownTimeoutSeconds();
  let signals = 0;
  const shutdown = (reason: string) => {
    signals += 1;
    if (signals > 1) {
      console.error("Second signal: exiting now.");
      process.exit(1);
    }
    console.log(`${reason}: no new work is claimed; the job in hand stops or is released (up to ${deadline}s).`);
    controller.abort();
    // Bounded (§58): a job that ignores its signal does not hold the deploy.
    setTimeout(() => {
      console.error(`Shutdown did not finish within ${deadline}s; exiting. Leases left behind expire on their own.`);
      process.exit(1);
    }, deadline * 1000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
    shutdown("unhandled rejection");
  });

  const outcomes = await runWorker({
    workerId,
    groups,
    only,
    once: flag("once"),
    signal: controller.signal,
    version: workerVersion(),
    isAvailable: (job) => !jobUnavailableReason(job, { capabilities: capabilities() }),
    // Most of the deadline goes to the job in hand; the rest to marking the process stopped.
    abandonAfterMs: Math.max(1_000, (deadline - 5) * 1000),
  });

  if (flag("once")) {
    for (const outcome of outcomes) {
      console.log(`  ${outcome.job.padEnd(26)} ${outcome.status.padEnd(10)} ${outcome.processed} processed${outcome.error ? ` — ${outcome.errorCode}: ${outcome.error}` : ""}`);
    }
    if (outcomes.some((outcome) => outcome.status === "failure")) process.exitCode = 1;
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
