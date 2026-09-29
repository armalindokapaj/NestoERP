/**
 * The ARMAAR demo tenant, stage by stage in D-01's seed order (§72): the group,
 * its companies and departments, its people and their access, its site
 * workforce without logins (E-04), its projects, their buildings, units and
 * sales — then the rules the rest of the product holds, applied to what was
 * written, and D-01's own checks. The people D-03 names are surveyed before
 * anything is written and recorded once they hold their places.
 *
 * Called by the main seed, so every database built for development and tests
 * has a second, realistic group beside the demo's, and by `pnpm seed:armaar`
 * for a database that already exists. Idempotent either way.
 */
import type { PrismaClient } from "@prisma/client";

import { DEMO_PASSWORD } from "../../../config/demo-accounts";
import { reconcileStorageUsage } from "../../../lib/modules/documents/storage/cleanup.service";
import { syncEmploymentHistory } from "../employment-history";
import { syncMemberPlaces } from "../organization-helpers";
import { seedDocumentVersions, seedStorageQuotas } from "../storage";
import { seedArmaarPeople } from "./access";
import { seedArmaarCredentials } from "./credentials";
import { seedArmaarEngineering } from "./engineering";
import { seedArmaarEnrichDelivery } from "./enrich-delivery";
import { seedArmaarEnrichSales } from "./enrich-sales";
import { seedArmaarFinance } from "./finance";
import { seedArmaarInventory } from "./inventory";
import { seedArmaarLifecycle, seedArmaarLifecycleWorkforce } from "./lifecycle";
import { seedArmaarLegal } from "./legal";
import { describeNamedPeople, recordNamedPeople, surveyNamedPeople } from "./named-people";
import { seedArmaarOperations } from "./operations";
import { seedArmaarOrganization } from "./organization";
import { seedArmaarQuality } from "./quality";
import { seedArmaarProjects } from "./projects";
import { ARMAAR_GROUP_ID } from "./records";
import { repairArmaarCommercialProfiles } from "./repair-commercial";
import { seedArmaarSafety } from "./safety";
import { seedArmaarSales } from "./sales";
import { seedArmaarDocumentReviews, seedArmaarSchedule } from "./schedule";
import { seedArmaarSite } from "./site";
import { seedArmaarSupply } from "./supply";
import { seedArmaarTasks } from "./tasks";
import { seedArmaarTimesheets } from "./timesheets";
import { seedArmaarUnits } from "./units";
import { verifyDemoTenant } from "./verify";
import { seedArmaarWorkers, seedArmaarWorkforce } from "./workforce";

const DAY = 86_400_000;

/** The ARMAAR accounts' password: its own (D-01 §87), or in development the demo's. */
export function armaarPassword(): string {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Refusing to seed the ARMAAR demo: NODE_ENV is production and ALLOW_DEMO_SEED is not set.");
  }
  const own = process.env.ARMAAR_DEMO_PASSWORD;
  if (own) return own;
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed the ARMAAR demo: set ARMAAR_DEMO_PASSWORD.");
  return DEMO_PASSWORD;
}

/**
 * `shared: false` leaves out the steps that run over every group's rows — member
 * places, employment history, storage usage — for a caller that must not touch
 * anything but ARMAAR's (a test running beside others). They are idempotent and
 * held by their own tests.
 */
export async function seedArmaar(prisma: PrismaClient, passwordHash: string, options: { shared?: boolean } = {}) {
  const shared = options.shared ?? true;
  // NESTO went live for the group eighteen months ago; its people were employed long before.
  const activatedAt = new Date(Date.now() - 540 * DAY);
  // D-03: what the named people's records and places hold before anything is written (§23-§25).
  const survey = await surveyNamedPeople(prisma);
  const branches = await seedArmaarOrganization(prisma, activatedAt);
  const people = await seedArmaarPeople(prisma, branches, passwordHash, activatedAt);
  // The site workforce, who have no login: employed before the history backfill (E-04).
  const workers = await seedArmaarWorkers(prisma, branches);
  // A selected candidate waiting for her login and a former site worker (E-08 §46, §118).
  await seedArmaarLifecycle(prisma);
  // A placed login is on its department's team (E-13); an employment has its history (E-03).
  if (shared) {
    await syncMemberPlaces(prisma);
    await syncEmploymentHistory(prisma);
  }

  const projects = await seedArmaarProjects(prisma);
  // The Owner, the heads and Eyes of Tirana's manager D-03 names: their provenance, and what was done (§21, §30).
  const named = await recordNamedPeople(prisma, survey, [...people.conflicts, ...projects.conflicts]);
  const units = await seedArmaarUnits(prisma);
  // A profile deleted since the first seed is rebuilt from its history, so the sales step does not write the sale twice (D-04).
  await repairArmaarCommercialProfiles(prisma);
  const sales = await seedArmaarSales(prisma, units);
  const operations = await seedArmaarOperations(prisma);
  // Where the workers work, with whom, and their days on site (E-04).
  const workforce = await seedArmaarWorkforce(prisma);
  await seedArmaarLifecycleWorkforce(prisma);
  // Employee files and qualifications: contracts, licences, what waits for HR and what runs out (E-02).
  const credentials = await seedArmaarCredentials(prisma);

  // D-02, after the workforce it names (crews on the daily log, workers at the toolbox talks):
  // the rest of the supply chain and Tirana Lake's engineering record, the tasks behind them;
  // Legal's parties, obligations and contracts; invoices, expenses and what paid them; the diary;
  // then the site — safety, quality, stock, the daily log that refers to them, and the week's hours.
  const supply = await seedArmaarSupply(prisma);
  const engineering = await seedArmaarEngineering(prisma);
  const tasks = await seedArmaarTasks(prisma);
  const legal = await seedArmaarLegal(prisma);
  const finance = await seedArmaarFinance(prisma);
  const schedule = await seedArmaarSchedule(prisma);
  const safety = await seedArmaarSafety(prisma);
  const quality = await seedArmaarQuality(prisma);
  const inventory = await seedArmaarInventory(prisma);
  const site = await seedArmaarSite(prisma);
  const timesheets = await seedArmaarTimesheets(prisma);

  // D-04: months of ordinary work around the headline records — delivery, then sales — on the same people and projects.
  const delivery = await seedArmaarEnrichDelivery(prisma);
  const selling = await seedArmaarEnrichSales(prisma);

  // Every document has its first version, every company its storage quota and usage (PRD #29).
  if (shared) {
    await seedDocumentVersions(prisma);
    await seedStorageQuotas(prisma);
    await reconcileStorageUsage();
  }
  // Reviews sit on a document's version, which the storage step above writes (D-02 §32).
  const reviews = await seedArmaarDocumentReviews(prisma);

  const findings = await verifyDemoTenant(prisma, ARMAAR_GROUP_ID);
  if (findings.length) {
    // A conflict the seed left as it found it (D-03 §24, §25) is why a named place is not as D-03 says.
    const conflicts = named.filter((event) => event.kind === "conflict").map((event) => `conflict, left as it is: ${event.subject}`);
    throw new Error(`The ARMAAR demo is inconsistent:\n  ${[...findings, ...conflicts].join("\n  ")}`);
  }

  return {
    people: people.people,
    named,
    workers: workers.workers,
    workforce,
    credentials,
    companies: await prisma.company.count({ where: { parentGroupId: ARMAAR_GROUP_ID } }),
    suspended: await prisma.company.count({ where: { parentGroupId: ARMAAR_GROUP_ID, status: "SUSPENDED" } }),
    branches: await prisma.department.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    logins: await prisma.companyMember.count({ where: { company: { parentGroupId: ARMAAR_GROUP_ID } } }),
    projects: projects.projects,
    units: units.length,
    sales,
    operations,
    supply,
    engineering,
    tasks,
    legal,
    finance,
    schedule,
    reviews,
    safety,
    quality,
    inventory,
    site,
    timesheets,
    delivery,
    selling,
    records: await prisma.demoRecord.count({ where: { parentGroupId: ARMAAR_GROUP_ID } }),
  };
}

export function describeArmaar(counts: Awaited<ReturnType<typeof seedArmaar>>): string[] {
  return [
    `✓ ARMAAR GROUP: ${counts.companies} companies (${counts.suspended} suspended), ${counts.branches} company departments, ${counts.people} people with ${counts.logins} company logins`,
    `✓ ARMAAR projects: ${counts.projects}; ${counts.units} units — ${counts.sales.sold} sold under ${counts.sales.contracts} sale contracts, ${counts.sales.reserved} reserved, ${counts.sales.onHold} on hold, ${counts.sales.forSale} for sale`,
    `✓ ARMAAR workforce: ${counts.workers} site workers without a login, ${counts.workforce.trades} trades, ${counts.workforce.sites} sites, ${counts.workforce.crews} active crews, ${counts.workforce.onSite} on a project now, ${counts.workforce.attendance} days marked on site, ${counts.workforce.inductions} inductions`,
    `✓ ARMAAR employee files: ${counts.credentials.documents} documents filed on employments, ${counts.credentials.qualifications} qualifications — verified, waiting, sent back, running out and renewed`,
    `✓ ARMAAR operations: ${counts.operations.suppliers} supplier records, ${counts.operations.contractors} contractors, ${counts.operations.tasks} tasks, ${counts.operations.meetings} meetings, ${counts.operations.documents} project documents`,
    `✓ ARMAAR supply chain: ${counts.supply.suppliers} supplier records, ${counts.supply.requests} purchase requests, ${counts.supply.orders} orders, ${counts.supply.receipts} deliveries, ${counts.supply.commitments} commitments from approved orders`,
    `✓ ARMAAR engineering: ${counts.engineering.contractors} contractors, ${counts.engineering.workPackages} work packages, ${counts.engineering.documents} drawings and documents, ${counts.engineering.rfis} RFIs, ${counts.engineering.submittals} submittals, ${counts.engineering.transmittals} transmittals`,
    `✓ ARMAAR tasks: ${counts.tasks.tasks} across the working companies`,
    `✓ ARMAAR legal: ${counts.legal.contracts} contracts besides the sales, ${counts.legal.parties} parties, ${counts.legal.obligations} obligations, ${counts.legal.amendments} amendments`,
    `✓ ARMAAR finance: ${counts.finance.invoices} invoices on installments, ${counts.finance.expenses} expenses, ${counts.finance.disbursements} disbursements, ${counts.finance.commitments} commitments`,
    `✓ ARMAAR diary: ${counts.schedule.meetings} meetings, ${counts.schedule.events} calendar events, ${counts.reviews} document reviews`,
    `✓ ARMAAR site: ${counts.site.logs} daily logs on Tirana Lake; HSE ${counts.safety.inspections} inspections, ${counts.safety.hazards} hazards, ${counts.safety.actions} actions, ${counts.safety.talks} toolbox talks, ${counts.safety.incidents} incidents, ${counts.safety.permits} permits; QA/QC ${counts.quality.inspections} inspections, ${counts.quality.ncrs} NCRs, ${counts.quality.actions} corrective actions, ${counts.quality.defects} defects`,
    `✓ ARMAAR stock and time: ${counts.inventory.items} items in ${counts.inventory.warehouses} stores, ${counts.inventory.movements} stock movements; ${counts.timesheets.weeks} timesheets, ${counts.timesheets.hours} hours logged`,
    `✓ ARMAAR delivery (D-04): ${counts.delivery.tasks} tasks, ${counts.delivery.comments} comments, ${counts.delivery.meetings} meetings with ${counts.delivery.actionItems} actions, ${counts.delivery.events} calendar events, ${counts.delivery.rfis} RFIs, ${counts.delivery.logs} daily logs, ${counts.delivery.timesheets} timesheets`,
    `✓ ARMAAR sales (D-04): ${counts.selling.clients} clients, ${counts.selling.opportunities} opportunities, ${counts.selling.saleContracts} sale contracts, ${counts.selling.installments} installments, ${counts.selling.payments} payments`,
    ...describeNamedPeople(counts.named),
    `✓ ARMAAR provenance: ${counts.records} demo records; public facts match the source`,
  ];
}
