/**
 * Retention, once (PRD #33 §69, §74, PRD #34 §370-§374, PRD #51 §163-§166).
 *
 * Runs the `retention.run` job now, through its lease. Defaults to a dry run
 * and refuses to delete without an explicit confirmation, and in production
 * without naming it: a command that deletes data must never do so because
 * somebody pressed up-arrow and enter (PRD #34 §372, §374). The scheduled job
 * deletes only where `WORKER_RETENTION_APPLY=true`; `--apply` here is the
 * one-off equivalent and does not change that setting.
 *
 *   pnpm retention:dry-run
 *   tsx scripts/retention.ts --apply --confirm=DELETE [--environment=production]
 */
import { appEnvironment } from "../lib/config/env";
import { runJobNow } from "../lib/core/jobs/job.manual";
import { prisma } from "../lib/database/prisma";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = args.has("--confirm=DELETE");

async function main() {
  const environment = appEnvironment();
  if (apply && !confirmed) throw new Error("Refusing to delete without --confirm=DELETE");
  if (apply && environment === "production" && !args.has("--environment=production")) {
    throw new Error("Refusing to run against production without --environment=production");
  }

  const dryRun = !apply;
  console.log(`Retention run — environment=${environment} mode=${dryRun ? "DRY RUN" : "APPLY"}\n`);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  const outcome = await runJobNow("retention.run", {
    dryRun,
    env: { ...process.env, WORKER_RETENTION_APPLY: apply ? "true" : "false" },
    signal: controller.signal,
  });
  if (outcome.busy) throw new Error("A worker is running retention right now; try again when it finishes");

  const policies = (outcome.detail?.policies ?? {}) as Record<string, number>;
  const action = dryRun ? "would remove" : "removed";
  for (const [policyKey, count] of Object.entries(policies)) {
    console.log(`  ${policyKey.padEnd(36)} ${action} ${String(count).padStart(7)}`);
  }
  console.log(`\n${dryRun ? "Would remove" : "Removed"} ${outcome.processed} rows across ${Object.keys(policies).length} policies.`);
  if (outcome.error) console.error(`  ${outcome.errorCode}: ${outcome.error}`);
  if (outcome.status !== "success") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Retention run failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
