/**
 * Rewrites employments' current fields from their history where they drifted
 * (E-03 §182). A dry run by default: it lists what it would change. With
 * `--apply` it rewrites each one in its own transaction and audits it as the
 * system. It never touches the history itself — a wrong history is corrected by
 * HR, with a reason, in the application.
 *
 *   pnpm repair:employment            # dry run
 *   pnpm repair:employment --apply    # rewrite
 */
import { PrismaClient } from "@prisma/client";

import { repairEmploymentCaches } from "../lib/modules/hr/employment/employment.integrity";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    const repaired = await repairEmploymentCaches(prisma, { apply });
    for (const row of repaired) console.log(`  ${apply ? "rewrote" : "would rewrite"} ${row.employmentId}: ${row.fields.join(", ")}`);
    console.log(`${apply ? "✓ repaired" : "dry run:"} ${repaired.length} employment(s)${apply ? "" : " — run with --apply to rewrite"}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
