/**
 * Storage maintenance, once (PRD #29 §129, §271, §329, §332, PRD #51 §163-§166).
 *
 * The storage jobs the worker runs on a schedule, run now and in order, each
 * through its own lease so none of them races a worker already running it:
 *
 *   scan       documents.scan    drains anything waiting on the malware scanner
 *   cleanup    storage.cleanup   expires abandoned upload sessions and removes their objects
 *   orphans    storage.orphans   reports documents whose object has gone missing
 *   reconcile  storage.usage     rebuilds the storage usage projection from the documents
 *
 * Defaults to a dry run for the destructive part, and refuses to delete in
 * production without saying so out loud — a command that removes files must
 * never do it because somebody pressed up-arrow and enter (PRD #34 §372).
 *
 *   pnpm storage:maintenance                   dry run, all jobs
 *   pnpm storage:maintenance:apply             actually clean up
 *   tsx scripts/storage-maintenance.ts --job=scan
 */
import { appEnvironment } from "../lib/config/env";
import { runJobNow } from "../lib/core/jobs/job.manual";
import { scannerEnabled } from "../lib/core/storage";
import { storageProvider } from "../lib/core/storage/storage-provider.factory";
import { prisma } from "../lib/database/prisma";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const jobArg = [...args].find((arg) => arg.startsWith("--job="));
const only = jobArg?.slice("--job=".length) ?? "all";

const STEPS = [
  { name: "scan", job: "documents.scan", dryRun: false },
  { name: "cleanup", job: "storage.cleanup", dryRun: !apply },
  // Read-only on purpose. A vanished object behind an available document is
  // an incident for somebody to restore from backup, not a tidying job.
  { name: "orphans", job: "storage.orphans", dryRun: true },
  { name: "reconcile", job: "storage.usage", dryRun: false },
] as const;

async function main() {
  const environment = appEnvironment();
  if (only !== "all" && !STEPS.some((step) => step.name === only)) {
    throw new Error(`Unknown --job=${only}; expected one of ${STEPS.map((step) => step.name).join(", ")}`);
  }
  if (apply && environment === "production" && !args.has("--environment=production")) {
    throw new Error("Refusing to delete in production without --environment=production");
  }

  const provider = storageProvider();
  // Never run a cleanup against storage that is not answering: every object
  // would look missing and every document would look orphaned (PRD #29 §395).
  const health = await provider.healthCheck().catch(() => ({ ok: false }));
  if (!health.ok) throw new Error("Object storage is not reachable. Refusing to run.");

  console.log(`Storage maintenance — environment=${environment} provider=${provider.key} mode=${apply ? "APPLY" : "DRY RUN"}\n`);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  for (const step of STEPS) {
    if (only !== "all" && only !== step.name) continue;
    if (controller.signal.aborted) break;
    if (step.job === "documents.scan" && !scannerEnabled()) {
      console.log(`  ${step.name.padEnd(10)} no scanner configured; files record NOT_REQUIRED`);
      continue;
    }
    const outcome = await runJobNow(step.job, { dryRun: step.dryRun, signal: controller.signal, capabilities: { scanner: scannerEnabled() } });
    if (outcome.busy) {
      console.log(`  ${step.name.padEnd(10)} a worker is running ${step.job} right now; skipped`);
      continue;
    }
    // Counts only (§166).
    const detail = outcome.detail ? ` ${JSON.stringify(outcome.detail)}` : "";
    console.log(`  ${step.name.padEnd(10)} ${outcome.status}${outcome.dryRun ? " (dry run)" : ""}: ${outcome.processed} processed${detail}`);
    if (outcome.error) console.error(`             ${outcome.errorCode}: ${outcome.error}`);
    if (outcome.status !== "success") process.exitCode = 1;
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("Storage maintenance failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
