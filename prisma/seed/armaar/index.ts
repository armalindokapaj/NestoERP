/**
 * The ARMAAR Group demo tenant (Demo PRD D-01; ADR 0005).
 *
 *   pnpm seed:armaar
 *
 * A second parent group beside the five-company demo. The main seed builds it
 * too; this command adds it to a database that already exists. A presenter
 * gets a tenant that looks like ARMAAR's — its thirteen companies, its
 * departments, its people, its public project portfolio and a working day of
 * operations — with public facts kept apart from synthetic data (§2, §3).
 *
 * Idempotent: every record has a stable id, so running it again updates in
 * place and adds nothing (§73, §110). It needs the migrations applied, and seeds
 * the access configuration itself, so it also runs on an otherwise empty
 * database. Never in production without ALLOW_DEMO_SEED (PRD #9 §6), and its
 * password is its own: ARMAAR_DEMO_PASSWORD, or in development the demo's
 * (§87, "credentials managed separately").
 */
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../../../lib/auth/password";
import { seedAccessConfiguration } from "../access";
import { armaarPassword, describeArmaar, seedArmaar } from "./seed";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword(armaarPassword());
  await seedAccessConfiguration(prisma);
  // Concise, and never a password or a hash (PRD #9 §240).
  for (const line of describeArmaar(await seedArmaar(prisma, passwordHash))) console.log(line);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
