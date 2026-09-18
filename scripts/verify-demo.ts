/**
 * Fails when a seeded demonstration tenant is not what its PRD says it is: a
 * public fact replaced, a company missing or duplicated, a person twice, work
 * in a suspended company, a record without provenance (D-01 §93-§111).
 *
 * Passes, saying so, on a database with no demo tenant seeded: the five-company
 * demo and the test fixtures are held by `verify:organization` and the seed's
 * own validation instead.
 */
import { PrismaClient } from "@prisma/client";

import { verifyDemoTenant } from "../prisma/seed/armaar/verify";
import { ARMAAR_GROUP_ID } from "../prisma/seed/armaar/records";

async function main() {
  const prisma = new PrismaClient();
  try {
    const armaar = await prisma.parentGroup.findUnique({ where: { id: ARMAAR_GROUP_ID }, select: { id: true } });
    if (!armaar) {
      console.log("✓ demo: no demo tenant seeded (run pnpm seed:armaar for ARMAAR)");
      return;
    }
    const findings = await verifyDemoTenant(prisma, ARMAAR_GROUP_ID);
    for (const finding of findings) console.error(`  ✗ ${finding}`);
    if (findings.length) {
      console.error(`✗ demo: ARMAAR has ${findings.length} finding(s)`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ demo: ARMAAR's public facts, companies, people and provenance agree with D-01");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
