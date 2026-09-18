/**
 * Fails when an employment's current fields disagree with its history, when the
 * history itself is broken, when a login is placed elsewhere than its running
 * employment says, or when current reporting lines loop (E-03 §180-§182, §215).
 * Warnings — a scheduled change overdue — are printed and do not fail.
 *
 * Run after seeding and after the test suites, like verify:organization.
 */
import { PrismaClient } from "@prisma/client";

import { findEmploymentFindings } from "../lib/modules/hr/employment/employment.integrity";

async function main() {
  const prisma = new PrismaClient();
  try {
    const findings = await findEmploymentFindings(prisma);
    const errors = findings.filter((finding) => finding.level === "error");
    const warnings = findings.filter((finding) => finding.level === "warning");
    for (const finding of warnings) console.warn(`  ! ${finding.code}: ${finding.message}`);
    for (const finding of errors) console.error(`  ✗ ${finding.code}: ${finding.message}`);
    if (errors.length > 0) {
      console.error(`✗ employment: ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ employment: every employment agrees with its history, and every login with its employment (${warnings.length} warning(s))`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
