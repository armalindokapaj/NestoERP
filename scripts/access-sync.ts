/**
 * Access configuration sync (PRD #9 §14-§21, PRD #38 §19).
 *
 * Writes roles, permissions, modules and the role × module × permission matrix
 * from `config/` into the database. Safe in every environment, production
 * included: it is configuration, not demo data, and it never touches a company,
 * a person or a business record. Run it after every deploy that changes the
 * access matrix, and before the first company is bootstrapped.
 *
 *   tsx scripts/access-sync.ts
 */
import { syncAccessConfiguration } from "../lib/core/access/access-sync.service";
import { prisma } from "../lib/database/prisma";

async function main() {
  // Not the validated app environment: this runs during the build, where the runtime secrets and URLs are not all present.
  console.log(`Access sync — environment=${process.env.APP_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development"}\n`);
  const result = await syncAccessConfiguration(prisma);
  console.log(
    `  ${result.roles} roles, ${result.permissions} permissions, ${result.modules} modules, ` +
      `${result.rolePermissions} role permissions, ${result.roleModuleAccess} module access rows\n`,
  );
}

main()
  .catch((error) => {
    console.error("Access sync failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .then(() => process.exit(0));
