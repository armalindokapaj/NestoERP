/**
 * NESTO V0.1 development seed (spec §65).
 *
 * Creates one demo company and one account per role, from the shared roster in
 * config/demo-company.ts. Idempotent — safe to run repeatedly.
 */
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";

import {
  DEMO_COMPANY,
  DEMO_PASSWORD,
  demoAccounts,
  rolesMissingDemoAccount,
} from "../config/demo-company";
import { MODULE_KEYS, modules } from "../config/modules";
import { ROLE_KEYS, roles } from "../config/roles";

const prisma = new PrismaClient();

async function main() {
  // "One account per role" is a guarantee the seed refuses to break.
  const missing = rolesMissingDemoAccount();
  if (missing.length > 0) {
    throw new Error(
      `No demo account defined for: ${missing.join(", ")}. Add them to config/demo-company.ts.`,
    );
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const company = await prisma.company.upsert({
    where: { slug: DEMO_COMPANY.slug },
    update: { ...DEMO_COMPANY },
    create: { ...DEMO_COMPANY },
  });

  console.log(`Company: ${company.name}`);

  for (const account of demoAccounts) {
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        firstName: account.firstName,
        lastName: account.lastName,
        phone: account.phone,
        passwordHash,
        status: "ACTIVE",
      },
      create: {
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        phone: account.phone,
        passwordHash,
        status: "ACTIVE",
      },
    });

    await prisma.companyMember.upsert({
      where: { companyId_userId: { companyId: company.id, userId: user.id } },
      update: {
        role: account.role as Role,
        department: account.department,
        jobTitle: account.jobTitle,
        status: "ACTIVE",
      },
      create: {
        companyId: company.id,
        userId: user.id,
        role: account.role as Role,
        department: account.department,
        jobTitle: account.jobTitle,
        status: "ACTIVE",
      },
    });
  }

  console.log(`Users: ${demoAccounts.length} accounts, one per role`);

  // Module catalogue + company activation (spec §48).
  for (const key of MODULE_KEYS) {
    const definition = modules[key];
    const record = await prisma.module.upsert({
      where: { key },
      update: { name: definition.label },
      create: { key, name: definition.label, status: "AVAILABLE" },
    });

    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId: company.id, moduleId: record.id } },
      update: { enabled: true },
      create: { companyId: company.id, moduleId: record.id, enabled: true },
    });
  }

  console.log(`Modules: ${MODULE_KEYS.length} enabled for ${company.name}`);
  console.log(`\nSign in with any of the accounts below, password: ${DEMO_PASSWORD}`);
  for (const key of ROLE_KEYS) {
    const account = demoAccounts.find((item) => item.role === key)!;
    console.log(`  ${account.email.padEnd(26)} ${roles[key].label}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
