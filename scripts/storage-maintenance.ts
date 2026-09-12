/**
 * Storage maintenance (PRD #29 §129, §271, §329, §332).
 *
 * The worker the architecture depends on. Three jobs, all idempotent, meant to
 * run on a schedule:
 *
 *   scan       drains anything waiting on the malware scanner
 *   cleanup    expires abandoned upload sessions and removes their objects
 *   orphans    reports documents whose object has gone missing
 *   reconcile  rebuilds the storage usage projection from the documents
 *
 * Defaults to a dry run for the destructive part, and refuses to delete in
 * production without saying so out loud — a script that removes files must
 * never do it because somebody pressed up-arrow and enter (PRD #34 §372).
 *
 *   tsx scripts/storage-maintenance.ts                 dry run, all jobs
 *   tsx scripts/storage-maintenance.ts --apply         actually clean up
 *   tsx scripts/storage-maintenance.ts --job=scan
 */
import { appEnvironment } from "../lib/config/env";
import {
  findOrphanedDocuments,
  reconcileStorageUsage,
  runStorageCleanup,
} from "../lib/modules/documents/storage/cleanup.service";
import { runPendingScans } from "../lib/modules/documents/storage/scan.service";
import { scannerEnabled } from "../lib/core/storage";
import { storageProvider } from "../lib/core/storage/storage-provider.factory";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const jobArg = [...args].find((arg) => arg.startsWith("--job="));
const job = jobArg?.slice("--job=".length) ?? "all";

const wants = (name: string) => job === "all" || job === name;

async function main() {
  const environment = appEnvironment();

  if (apply && environment === "production" && !args.has("--environment=production")) {
    console.error("Refusing to delete in production without --environment=production");
    process.exit(1);
  }

  const provider = storageProvider();
  const health = await provider.healthCheck();

  // Never run a cleanup against storage that is not answering: every object
  // would look missing and every document would look orphaned (PRD #29 §395).
  if (!health.ok) {
    console.error("Object storage is not reachable. Refusing to run.");
    process.exit(1);
  }

  console.log(
    `Storage maintenance — environment=${environment} provider=${provider.key} mode=${apply ? "APPLY" : "DRY RUN"}\n`,
  );

  if (wants("scan")) {
    if (!scannerEnabled()) {
      console.log("  scan       no scanner configured; files record NOT_REQUIRED");
    } else {
      const result = await runPendingScans(100);
      console.log(`  scan       ${result.scanned} document(s) scanned`);
    }
  }

  if (wants("cleanup")) {
    const result = await runStorageCleanup({ dryRun: !apply });
    const verb = apply ? "" : "would be ";
    console.log(
      `  cleanup    ${result.sessionsExpired} session(s) expired, ` +
        `${result.objectsDeleted} object(s) ${verb}deleted, ` +
        `${result.documentsRemoved} placeholder(s) ${verb}removed, ` +
        `${result.documentsFailed} marked failed`,
    );
  }

  if (wants("orphans")) {
    // Read-only on purpose. A vanished object behind an available document is
    // an incident for somebody to restore from backup, not a tidying job.
    const orphans = await findOrphanedDocuments({ limit: 1000 });
    console.log(`  orphans    ${orphans.length} document(s) with a missing object`);
    for (const orphan of orphans.slice(0, 20)) {
      console.log(`             ${orphan.documentId} (${orphan.companyId})`);
    }
  }

  if (wants("reconcile")) {
    const usage = await reconcileStorageUsage();
    console.log(`  reconcile  ${usage.length} company usage projection(s) rebuilt`);
    for (const row of usage) {
      console.log(
        `             ${row.companyId.padEnd(24)} ${row.fileCount.toString().padStart(5)} files, ${row.usedBytes} bytes`,
      );
    }
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error("Storage maintenance failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .then(() => process.exit(0));
