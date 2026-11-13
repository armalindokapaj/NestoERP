/**
 * The selling demo: the standard demo seed re-dressed as Arvela Group, an
 * invented group of companies (prisma/seed/showcase). Runs after `prisma/seed.ts`, on the demo database only
 * — the same guard as the seed, and a Platform Admin password of its own.
 *
 *   NESTO_DEMO_PASSWORD        the demo people's (temporary) password
 *   NESTO_DEMO_ADMIN_PASSWORD  the demo Platform Admin's; must differ
 *   NESTO_DEMO_SIGN_IN         "temporary" (default) or "shared"
 *
 * Neither password is ever printed.
 */
import { PrismaClient } from "@prisma/client";

import { DEMO_PASSWORD } from "../config/demo-accounts";
import { hashPassword } from "../lib/auth/password";
import { applyShowcaseDemo } from "./seed/showcase/apply";
import { assertSeedAllowed } from "./seed/guard";

const prisma = new PrismaClient();

async function main() {
  assertSeedAllowed();
  const adminPassword = process.env.NESTO_DEMO_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword === DEMO_PASSWORD) {
    throw new Error("Refusing to dress the Showcase demo: NESTO_DEMO_ADMIN_PASSWORD must be set, and differ from NESTO_DEMO_PASSWORD.");
  }
  const signIn = process.env.NESTO_DEMO_SIGN_IN === "shared" ? "shared" : "temporary";
  const result = await applyShowcaseDemo(prisma, {
    passwordHash: await hashPassword(DEMO_PASSWORD),
    adminPasswordHash: await hashPassword(adminPassword),
    signIn,
  });
  console.log(`✓ Showcase demo: ${result.companies} companies, ${result.projects} projects, ${result.people} people, ${result.comments} comments`);
  console.log(`✓ Sign-in: ${signIn === "temporary" ? "each person changes the demo password at first sign-in" : "everyone uses the demo password"}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
