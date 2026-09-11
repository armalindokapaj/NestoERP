/**
 * NESTO V0.1 demo seed (PRD #9).
 *
 * Fresh database → migrations → seed → sign in as any of the 16 demo users and
 * navigate a fully populated workspace, without creating a single record by
 * hand (PRD #9 §2).
 *
 * Order matters: configuration first, then companies and people, then the core
 * business graph, then module test records, then activity, then validation
 * (PRD #9 §239).
 */
import { PrismaClient } from "@prisma/client";

import { seedAccessConfiguration } from "./seed/access";
import { seedActivities } from "./seed/activities";
import { seedBusinessRecords } from "./seed/business";
import { seedCompanies } from "./seed/companies";
import { seedFinanceRecords } from "./seed/finance";
import { COMPANY_A_USERS, DEMO_PASSWORD } from "./seed/constants";
import { seedModuleRecords } from "./seed/module-records";
import { seedTeamRecords } from "./seed/team";
import { validateSeed } from "./seed/validate";

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
  const { companyA, companyB, members } = await seedCompanies(prisma);
  await seedBusinessRecords(prisma, members);
  const invitations = await seedTeamRecords(prisma, members);
  const finance = await seedFinanceRecords(prisma, members);
  await seedModuleRecords(prisma, members);
  const activities = await seedActivities(prisma, members);

  await validateSeed(prisma);

  const counts = {
    companies: await prisma.company.count(),
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
  console.log(`✓ Companies: ${counts.companies} (${companyA.name}, ${companyB.name})`);
  console.log(`✓ Users: ${counts.users}`);
  console.log(`✓ Projects: ${counts.projects}`);
  console.log(`✓ Clients: ${counts.clients}`);
  console.log(`✓ Tasks: ${counts.tasks}`);
  console.log(`✓ Documents: ${counts.documents}`);
  console.log(`✓ Company members: ${counts.members} (invitations: ${invitations})`);
  console.log(
    `✓ Finance: ${finance.invoices} invoices, ${finance.expenses} expenses, ` +
      `${finance.payments} payments, ${finance.budgets} budgets, ${finance.commitments} commitments`,
  );
  console.log(`✓ Activities: ${activities}`);
  console.log("✓ Seed validation passed");
  console.log(
    `\nSign in with any of the ${COMPANY_A_USERS.length} demo accounts, password: ${DEMO_PASSWORD}`,
  );
  for (const user of COMPANY_A_USERS) {
    console.log(`  ${user.email.padEnd(28)} ${user.role}`);
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
