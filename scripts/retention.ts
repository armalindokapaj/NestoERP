/**
 * Retention runner (PRD #33 §69, §74, PRD #34 §370-§374).
 *
 * Defaults to a dry run and refuses to mutate production without an explicit
 * confirmation flag: a script that deletes data must never do so because
 * somebody pressed up-arrow and enter (PRD #34 §372, §374).
 *
 *   pnpm retention:dry-run
 *   tsx scripts/retention.ts --apply --confirm=DELETE
 */
import { runAllRetentionPolicies } from "../lib/core/retention/retention.service";
import { appEnvironment } from "../lib/config/env";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const confirmed = [...args].some((arg) => arg === "--confirm=DELETE");

async function main() {
  const environment = appEnvironment();

  if (apply && !confirmed) {
    console.error("Refusing to delete without --confirm=DELETE");
    process.exit(1);
  }

  if (apply && environment === "production" && !args.has("--environment=production")) {
    console.error("Refusing to run against production without --environment=production");
    process.exit(1);
  }

  const dryRun = !apply;
  console.log(`Retention run — environment=${environment} mode=${dryRun ? "DRY RUN" : "APPLY"}\n`);

  const results = await runAllRetentionPolicies({ dryRun });

  for (const result of results) {
    const action = result.dryRun ? "would remove" : "removed";
    console.log(
      `  ${result.policyKey.padEnd(36)} ${String(result.candidateCount).padStart(7)} candidates, ${action} ${result.dryRun ? result.candidateCount : result.deletedCount}`,
    );
  }

  const total = results.reduce((sum, r) => sum + (r.dryRun ? r.candidateCount : r.deletedCount), 0);
  console.log(`\n${dryRun ? "Would remove" : "Removed"} ${total} rows across ${results.length} policies.`);
}

main()
  .catch((error) => {
    console.error("Retention run failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .then(() => process.exit(0));
