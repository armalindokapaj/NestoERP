/**
 * Fails when a cross-module workflow disagrees with itself (AUD-10 §8, CW-21):
 * a linked meeting action that does not follow its task, a conversion that
 * made two tasks, an approval source and its cycle out of step, a link across
 * companies, a committed decision or completion with no outbox event.
 * Warns — without failing — on a FAILED outbox event, a stale attention item,
 * or a link naming a task that is gone.
 *
 * Read-only: one READ ONLY transaction, nothing repaired (§8). Prints row ids,
 * codes and statuses only — never a name, a title or an amount. Run after
 * seeding and after the test suites, like verify:company-integrity.
 *
 *   tsx scripts/verify-workflow-consistency.ts [--company <id>]... [--limit <n>] [--window-days <n>] [--json]
 */
import { PrismaClient } from "@prisma/client";

import { findWorkflowInconsistencies } from "../lib/core/integrity/workflow-consistency";

function argValues(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((arg, index) => {
    if (arg === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  });
  return values;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const limit = Number(argValues("--limit")[0] ?? 20);
    const windowDays = Number(argValues("--window-days")[0] ?? 7);
    const report = await findWorkflowInconsistencies(prisma, { companyIds: argValues("--company"), limit, windowDays });

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const finding of report.findings) {
        const mark = finding.level === "error" ? "✗" : "!";
        console.error(`  ${mark} ${finding.code} [${finding.check}] ${finding.count} row(s): ${finding.reason}`);
        console.error(`      ${finding.ids.join(", ")}${finding.count > finding.ids.length ? `, … ${finding.count - finding.ids.length} more` : ""}`);
      }
    }
    if (report.errors > 0) {
      console.error(`✗ workflow consistency: ${report.errors} error(s), ${report.warnings} warning(s) across ${report.checks.length} checks`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ workflow consistency: ${report.checks.length} checks, no errors${report.warnings ? `, ${report.warnings} warning(s)` : ""}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("✗ workflow consistency: the verifier could not run", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
