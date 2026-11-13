/**
 * Fills the Arvela demo so every project has a full life to show: units and
 * their sales, contracts and collections, procurement and stock, the site's
 * daily records, and the company's own books and people. Runs once, after the
 * standard seed has been dressed as Arvela; a second run finds it done.
 */
import type { PrismaClient } from "@prisma/client";

import { normalizeName } from "../../../../lib/modules/clients/client.duplicate";
import { normalizeSupplierName } from "../../../../lib/modules/procurement/suppliers/supplier.service";
import { reconcileStorageUsage } from "../../../../lib/modules/documents/storage/cleanup.service";

import { SHOWCASE_GROUP } from "../dataset";
import { at, syncNumbering, type Clock } from "./kit";
import { seedShowcaseCompany } from "./company";
import { seedShowcaseHse } from "./hse";
import { seedShowcaseInventory } from "./inventory";
import { seedShowcaseMeetings } from "./meetings";
import { seedShowcaseProcurement } from "./procurement";
import { seedShowcaseQuality } from "./quality";
import { PROJECT_DATES, seedShowcaseSales } from "./sales";
import { seedShowcaseSite } from "./site";
import { seedShowcaseUnits } from "./units";

export async function fillShowcase(prisma: PrismaClient, now: Date) {
  if (await prisma.projectBuilding.findFirst({ where: { projectId: "project_b" }, select: { id: true } })) return null;
  const clock: Clock = { now };

  for (const [projectId, dates] of Object.entries(PROJECT_DATES)) {
    await prisma.project.update({ where: { id: projectId }, data: { startDate: at(clock, dates.start, 0), endDate: at(clock, dates.end, 0), ...(dates.priority ? { priority: dates.priority } : {}) } });
  }

  // Settings the app would otherwise create on first use, when two page requests can race to create the same row.
  const companies = (await prisma.company.findMany({ where: { parentGroupId: SHOWCASE_GROUP.id }, select: { id: true } })).map((row) => ({ companyId: row.id }));
  await prisma.timesheetSettings.createMany({ data: companies, skipDuplicates: true });
  await prisma.dailyLogSettings.createMany({ data: companies, skipDuplicates: true });
  await prisma.engineeringSettings.createMany({ data: companies, skipDuplicates: true });
  await prisma.productivitySettings.createMany({ data: companies, skipDuplicates: true });
  await prisma.projectPlanningSettings.createMany({ data: companies, skipDuplicates: true });
  await prisma.financeSettings.createMany({ data: companies, skipDuplicates: true });

  // Duplicate-check keys follow the names the prose step rewrote.
  for (const client of await prisma.client.findMany({ where: { companyId: { in: companies.map((row) => row.companyId) } }, select: { id: true, name: true, legalName: true } })) {
    await prisma.client.update({ where: { id: client.id }, data: { normalizedName: normalizeName(client.name) } });
  }
  for (const supplier of await prisma.supplier.findMany({ where: { companyId: { in: companies.map((row) => row.companyId) } }, select: { id: true, name: true } })) {
    await prisma.supplier.update({ where: { id: supplier.id }, data: { normalizedName: normalizeSupplierName(supplier.name) } });
  }

  const units = await seedShowcaseUnits(prisma, clock);
  const sales = await seedShowcaseSales(prisma, clock);
  const { delivered, ...procurement } = await seedShowcaseProcurement(prisma, clock);
  const inventory = await seedShowcaseInventory(prisma, clock, delivered);
  const site = await seedShowcaseSite(prisma, clock);
  const hse = await seedShowcaseHse(prisma, clock);
  const quality = await seedShowcaseQuality(prisma, clock);
  const meetings = await seedShowcaseMeetings(prisma, clock);
  const company = await seedShowcaseCompany(prisma, clock);
  const numbering = await syncNumbering(prisma, clock);
  // Every company's storage total, now counting the files added here.
  await reconcileStorageUsage();
  await settleUpdatedAt(prisma, clock);
  return { units, sales, procurement, inventory, site, hse, quality, meetings, company, numbering };
}

/**
 * A row's "updated" time is stamped when the seed writes it; for anything
 * dated in the past, it reads as last touched when it was created, not today.
 */
async function settleUpdatedAt(prisma: PrismaClient, clock: Clock) {
  const reset = clock.now.toISOString().slice(0, 19);
  await prisma.$executeRawUnsafe(`DO $settle$
    DECLARE t record;
    BEGIN
      FOR t IN
        SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'updatedAt'
          AND EXISTS (SELECT 1 FROM information_schema.columns c2 WHERE c2.table_schema = 'public' AND c2.table_name = c.table_name AND c2.column_name = 'createdAt')
      LOOP
        EXECUTE format('UPDATE %I SET "updatedAt" = "createdAt" WHERE "updatedAt" > %L::timestamp - interval ''2 hours'' AND "createdAt" < %L::timestamp - interval ''1 day''', t.table_name, '${reset}', '${reset}');
      END LOOP;
    END $settle$`);
}
