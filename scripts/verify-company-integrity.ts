/**
 * Fails when any row references another company's record (PRD #47 §20, §21, §158).
 *
 * Run after seeding and after the test suites: every create and update the
 * tests perform leaves its links in the database, and a link that crossed a
 * company boundary is a missing check somewhere in the application.
 */
import { PrismaClient } from "@prisma/client";

import { findCrossCompanyReferences } from "../lib/core/security/company-integrity";

async function main() {
  const prisma = new PrismaClient();
  try {
    const violations = await findCrossCompanyReferences(prisma);
    if (violations.length === 0) {
      console.log("✓ company integrity: no row references another company's record");
      return;
    }
    console.error(`✗ company integrity: ${violations.length} column(s) reference another company's records`);
    for (const violation of violations) {
      console.error(`  ${violation.table}.${violation.column}: ${violation.rows} row(s), e.g. ${violation.sampleIds.join(", ")}`);
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
