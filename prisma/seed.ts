/**
 * NESTO V0.1 demo seed (PRD #9, E-06 §42-§58, §103-§107).
 *
 * Fresh database → migrations → seed → sign in as any curated demo persona and
 * navigate a fully populated group of five companies, without creating a
 * single record by hand (PRD #9 §2).
 *
 * Order matters: configuration first, then the demo group and the test
 * fixtures with their people, then the core business graph, then module test
 * records, then activity, then validation (PRD #9 §239).
 */
import { PrismaClient } from "@prisma/client";

import { seedAccessConfiguration } from "./seed/access";
import { seedActivities } from "./seed/activities";
import { seedBusinessRecords } from "./seed/business";
import { seedCalendarRecords } from "./seed/calendar";
import { seedApprovalRecords } from "./seed/approvals";
import { seedMeetingRecords } from "./seed/meetings";
import { seedContractRecords } from "./seed/contracts";
import { seedFinanceRecords } from "./seed/finance";
import { seedHrRecords } from "./seed/hr";
import { seedRecruitmentRecords } from "./seed/recruitment";
import { seedWorkProfiles } from "./seed/people";
import { seedHseRecords } from "./seed/hse";
import { COMPANY_A, DEMO_COMPANY_IDS, DEMO_GROUP, DEMO_PASSWORD, FIXTURE_TENANT } from "./seed/constants";
import { seedMembers } from "./seed/members";
import { seedDemoOrganization } from "./seed/demo/organization";
import { syncMemberPlaces } from "./seed/organization-helpers";
import { seedFixtureOrganization } from "./seed/fixtures/organization";
import { PRIMARY_DEMO_ACCOUNTS } from "../config/demo-accounts";
import { hashPassword } from "../lib/auth/password";
import { seedModuleRecords } from "./seed/module-records";
import { seedInventoryRecords } from "./seed/inventory";
import { seedProcurementRecords } from "./seed/procurement";
import { seedQaqcRecords } from "./seed/qaqc";
import { seedAuditEvents } from "./seed/audit";
import { seedCompanySettings } from "./seed/settings";
import { seedSalesRecords } from "./seed/sales";
import { seedTeamRecords } from "./seed/team";
import { seedTimesheetRecords } from "./seed/timesheets";
import { seedDailyLogRecords } from "./seed/daily-logs";
import { seedPlanningRecords } from "./seed/planning";
import { seedStructureRecords } from "./seed/structure";
import { seedUnitPublishingRecords } from "./seed/unit-publishing";
import { seedUnitSalesRecords } from "./seed/unit-sales";
import { seedUnitFinanceRecords } from "./seed/unit-finance";
import { seedAnnouncementRecords } from "./seed/announcements";
import { seedContractorEngineeringRecords } from "./seed/engineering";
import { validateSeed } from "./seed/validate";
import { reconcileStorageUsage } from "../lib/modules/documents/storage/cleanup.service";
import { seedDocumentVersions, seedStorageQuotas } from "./seed/storage";

const prisma = new PrismaClient();

/**
 * Demo records must never reach production (PRD #9 §6, §248). Both guards are
 * required: the environment must not be production, and the operator must have
 * opted in explicitly.
 */
function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Refusing to seed demo data: NODE_ENV is production and ALLOW_DEMO_SEED is not set.",
    );
  }

  if (!process.env.NESTO_DEMO_PASSWORD && process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NESTO_DEMO_PASSWORD must be set outside development.");
  }
}

async function main() {
  assertSafeEnvironment();

  const access = await seedAccessConfiguration(prisma);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const activatedAt = new Date(Date.now() - 400 * 86_400_000);
  await seedDemoOrganization(prisma, passwordHash, activatedAt);
  await seedFixtureOrganization(prisma, passwordHash, activatedAt);
  const members = seedMembers();
  await seedCompanySettings(prisma);
  await seedBusinessRecords(prisma, members);
  const invitations = await seedTeamRecords(prisma, members);
  const finance = await seedFinanceRecords(prisma, members);
  const hr = await seedHrRecords(prisma, members);
  const recruitment = await seedRecruitmentRecords(prisma);
  await seedWorkProfiles(prisma);
  const sales = await seedSalesRecords(prisma, members);
  const legal = await seedContractRecords(prisma, members);
  const procurement = await seedProcurementRecords(prisma, members);
  const inventory = await seedInventoryRecords(prisma, members);
  const qaqc = await seedQaqcRecords(prisma, members);
  const hse = await seedHseRecords(prisma, members);
  await seedModuleRecords(prisma, members);
  const calendar = await seedCalendarRecords(prisma, members);
  const meetings = await seedMeetingRecords(prisma, members);
  const approvals = await seedApprovalRecords(prisma, members);
  const timesheets = await seedTimesheetRecords(prisma, members);
  const dailyLogs = await seedDailyLogRecords(prisma, members);
  const planning = await seedPlanningRecords(prisma, members);
  const structure = await seedStructureRecords(prisma, members);
  const unitPublishing = await seedUnitPublishingRecords(prisma, (userId) => members.get(userId)!);
  const unitSales = await seedUnitSalesRecords(prisma, (userId) => members.get(userId)!);
  const unitFinance = await seedUnitFinanceRecords(prisma, (userId) => members.get(userId)!);
  const announcements = await seedAnnouncementRecords(prisma, members);
  const engineering = await seedContractorEngineeringRecords(prisma, members);
  const activities = await seedActivities(prisma, members);
  await seedAuditEvents(prisma, { companyA: { id: COMPANY_A }, tenant: { id: FIXTURE_TENANT } });

  // Documents are seeded by nine different modules, so the usage projection is
  // rebuilt from them once at the end rather than incremented nine times
  // (PRD #29 §146, §148).
  await seedDocumentVersions(prisma);
  await seedStorageQuotas(prisma);
  await reconcileStorageUsage();

  // Everybody placed in a department is on its team (E-13, ADR 0003).
  await syncMemberPlaces(prisma);

  await validateSeed(prisma);

  const counts = {
    groups: await prisma.parentGroup.count({ where: { isTestFixture: false } }),
    companies: await prisma.company.count({ where: { id: { in: DEMO_COMPANY_IDS } } }),
    fixtureCompanies: await prisma.company.count({ where: { parentGroup: { isTestFixture: true } } }),
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    clients: await prisma.client.count(),
    tasks: await prisma.task.count(),
    documents: await prisma.document.count(),
    members: await prisma.companyMember.count(),
  };

  // Concise output only — never a hash, a token or a secret (PRD #9 §240).
  console.log(`✓ Roles: ${access.roles}`);
  console.log(`✓ Permissions: ${access.permissions}`);
  console.log(`✓ Modules: ${access.modules}`);
  console.log(`✓ Role permissions: ${access.rolePermissions}`);
  console.log(`✓ Role module access: ${access.roleModuleAccess}`);
  console.log(`✓ Parent groups: ${counts.groups} (${DEMO_GROUP.name}) and one test fixture group`);
  console.log(`✓ Companies: ${counts.companies} in the demo group, ${counts.fixtureCompanies} test fixtures`);
  console.log(`✓ Users: ${counts.users}`);
  console.log(`✓ Projects: ${counts.projects}`);
  console.log(`✓ Clients: ${counts.clients}`);
  console.log(`✓ Tasks: ${counts.tasks}`);
  console.log(`✓ Documents: ${counts.documents}`);
  console.log(`✓ Company members: ${counts.members} (invitations: ${invitations})`);
  console.log(`✓ Calendar: ${calendar.events} company, project, team and personal events`);
  console.log(`✓ Meetings: ${meetings.meetings} meetings, ${meetings.series} weekly series`);
  console.log(`✓ Daily logs: ${dailyLogs.logs} logs, ${dailyLogs.photos} site photos, ${dailyLogs.links} QA/QC and HSE links`);
  console.log(`✓ Structure: ${structure.buildings} buildings, ${structure.floors} floors, ${structure.units} units`);
  console.log(`✓ Unit sales: ${unitSales.forSale} for sale, ${unitSales.onHold} on hold, ${unitSales.reserved} reserved, ${unitSales.sold} sold`);
  console.log(`✓ Unit finance: ${unitFinance.contracts} units under a live sale contract, ${unitFinance.schedules} active schedules, ${unitFinance.payments} contract payments, ${unitFinance.requests} open contract requests`);
  console.log(`✓ Unit publishing: ${unitPublishing.published} published, ${unitPublishing.waiting} waiting for review, ${unitPublishing.revision} sent back, ${unitPublishing.files} unit files`);
  console.log(`✓ Planning: ${planning.phases} phases, ${planning.milestones} milestones, ${planning.dependencies} dependencies, ${planning.blockers} blockers`);
  console.log(`✓ Announcements: ${announcements.announcements} announcements (${announcements.targets} acknowledgment targets), ${announcements.favorites} favorites, ${announcements.recent} recent items`);
  console.log(`✓ Contractors & engineering: ${engineering.contractors} contractors, ${engineering.workPackages} work packages, ${engineering.compliance} compliance items, ${engineering.documents} engineering documents, ${engineering.rfis} RFIs, ${engineering.submittals} submittals, ${engineering.transmittals} transmittals`);
  console.log(`✓ Timesheets: ${timesheets.weeks} weeks, ${timesheets.logs} work logs, ${timesheets.approvers} approver assignments`);
  console.log(`✓ Approvals: ${approvals.policies} purchase-order policy, ${approvals.chains} order in a chain, ${approvals.delegations} delegation`);
  console.log(
    `✓ Finance: ${finance.invoices} invoices, ${finance.expenses} expenses, ` +
      `${finance.payments} payments, ${finance.budgets} budgets, ${finance.commitments} commitments`,
  );
  console.log(
    `✓ HR: ${hr.employees} employment records, ${hr.compensation} pay records, ` +
      `${hr.leave} leave requests, ${hr.balances} balances, ${hr.attendance} attendance days`,
  );
  console.log(`✓ Recruitment: ${recruitment.candidates} candidates, ${recruitment.requests} account requests`);
  console.log(
    `✓ Sales: ${sales.leads} leads, ${sales.opportunities} opportunities, ` +
      `${sales.proposals} proposals, ${sales.approvals} approvals`,
  );
  console.log(
    `✓ Legal: ${legal.contracts} contracts, ${legal.parties} parties, ` +
      `${legal.obligations} obligations, ${legal.amendments} amendments, ${legal.approvals} approvals`,
  );
  console.log(
    `✓ Procurement: ${procurement.suppliers} suppliers, ${procurement.requests} requests, ` +
      `${procurement.rfqs} RFQs, ${procurement.quotes} quotes, ${procurement.orders} orders, ` +
      `${procurement.receipts} receipts`,
  );
  console.log(
    `✓ Inventory: ${inventory.items} items, ${inventory.warehouses} warehouses, ` +
      `${inventory.movements} movements, ${inventory.balances} balances`,
  );
  console.log(
    `✓ QA/QC: ${qaqc.templates} templates, ${qaqc.requests} requests, ` +
      `${qaqc.inspections} inspections, ${qaqc.defects} defects, ${qaqc.ncrs} NCRs, ` +
      `${qaqc.actions} corrective actions`,
  );
  console.log(
    `✓ HSE: ${hse.hazards} hazards, ${hse.incidents} incidents, ${hse.inspections} inspections, ` +
      `${hse.assessments} risk assessments, ${hse.actions} actions, ${hse.permits} permits, ` +
      `${hse.toolbox} toolbox talks, ${hse.ppe} PPE checks, ${hse.observations} environmental, ` +
      `${hse.stopWorks} stop-work`,
  );
  console.log(`✓ Activities: ${activities}`);
  console.log("✓ Seed validation passed");
  console.log(
    `\nSign in as any of the ${PRIMARY_DEMO_ACCOUNTS.length} demo personas, password: ${DEMO_PASSWORD}`,
  );
  for (const account of PRIMARY_DEMO_ACCOUNTS) {
    console.log(`  ${account.username.padEnd(22)} ${account.assignment}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
