import { prisma } from "../../helpers";

/** The seeded tenants (prisma/seed/demo/projects.ts, prisma/seed/fixtures/constants.ts). */
export const COMPANY_A = "company_demo_a";
/**
 * The other tenant: a company in another parent group (E-06 §45). Not
 * `company_demo_b`, which is Meridian, Aurelia's sibling in the demo group.
 */
export const COMPANY_TENANT = "company_fixture_tenant";
/** The tenant's neighbour in the fixture group, where every invitation lives (E-06 §45). */
export const COMPANY_WORKS = "company_fixture";

/**
 * Switches every module on for a company and returns the undo.
 *
 * The fixture tenant deliberately runs with seven modules off (PRD #9 §13,
 * E-06 §46). An isolation attack from the tenant must not be refused by the
 * module guard instead of the company boundary, so the sweep turns them on —
 * and puts back exactly the flags it found, whatever happens in between.
 */
export async function withAllModulesEnabled(companyId: string): Promise<() => Promise<void>> {
  const rows = await prisma.companyModule.findMany({ where: { companyId }, select: { id: true, enabled: true } });
  const disabled = rows.filter((row) => !row.enabled).map((row) => row.id);
  if (disabled.length > 0) {
    await prisma.companyModule.updateMany({ where: { id: { in: disabled } }, data: { enabled: true } });
  }
  return async () => {
    if (disabled.length > 0) {
      await prisma.companyModule.updateMany({ where: { id: { in: disabled } }, data: { enabled: false } });
    }
  };
}
