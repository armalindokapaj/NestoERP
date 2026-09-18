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

import { verifyDemoTenant } from "../prisma/seed/arvela/verify";
import { ARVELA_GROUP_ID } from "../prisma/seed/arvela/records";

async function main() {
  const prisma = new PrismaClient();
  try {
    const arvela = await prisma.parentGroup.findUnique({ where: { id: ARVELA_GROUP_ID }, select: { id: true } });
    if (!arvela) {
      console.log("✓ demo: no demo tenant seeded (run pnpm seed:arvela for ARVELA)");
      return;
    }
    const findings = await verifyDemoTenant(prisma, ARVELA_GROUP_ID);
    for (const finding of findings) console.error(`  ✗ ${finding}`);
    if (findings.length) {
      console.error(`✗ demo: ARVELA has ${findings.length} finding(s)`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ demo: ARVELA's public facts, companies, people and provenance agree with D-01");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
