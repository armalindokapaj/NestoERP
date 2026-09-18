/**
 * Fails when an employment's login, person or group disagree, when somebody is
 * still in a crew or on a project after their employment ended, when leave or
 * attendance carries a login their employment does not have, or when an
 * employee document names no employment (E-04 §197, §198).
 *
 * Run after seeding and after the test suites, like verify:employment.
 */
import { PrismaClient } from "@prisma/client";

import { findWorkforceFindings } from "../lib/modules/workforce/workforce.integrity";

async function main() {
  const prisma = new PrismaClient();
  try {
    const findings = await findWorkforceFindings(prisma);
    for (const finding of findings) console.error(`  ✗ ${finding.code}: ${finding.message}`);
    if (findings.length > 0) {
      console.error(`✗ employee integrity: ${findings.length} error(s)`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ employee integrity: every employment's login, person and group agree, and nothing outlives its employment");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
