/**
 * Fails when the organization data authorization is computed from disagrees
 * with itself (E-06 §11-§18, §73): positions held with a role of another
 * department, managers without a branch, grants outside their group, members
 * of the platform who are members of a company. Warnings are printed and do
 * not fail: they are states the model tolerates, such as a position whose
 * holder no longer works as its role.
 *
 * Run after seeding and after the test suites, like verify:company-integrity.
 */
import { PrismaClient } from "@prisma/client";

import { findOrganizationFindings } from "../lib/modules/organization/organization-integrity";

async function main() {
  const prisma = new PrismaClient();
  try {
    const findings = await findOrganizationFindings(prisma);
    const errors = findings.filter((finding) => finding.level === "error");
    const warnings = findings.filter((finding) => finding.level === "warning");
    for (const finding of warnings) console.warn(`  ! [${finding.group}] ${finding.code}: ${finding.message}`);
    for (const finding of errors) console.error(`  ✗ [${finding.group}] ${finding.code}: ${finding.message}`);
    if (errors.length > 0) {
      console.error(`✗ organization: ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`✓ organization: groups, companies, positions, branches, grants and people agree (${warnings.length} warning(s))`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
