import { prisma } from "../../helpers";

/** The seeded tenants (prisma/seed/constants.ts). */
export const COMPANY_A = "company_demo_a";
export const COMPANY_B = "company_demo_b";

/**
 * Switches every module on for a company and returns the undo.
 *
 * Company B deliberately runs with seven modules off (PRD #9 §13). An isolation
 * attack from Company B must not be refused by the module guard instead of the
 * company boundary, so the sweep turns them on — and puts back exactly the
 * flags it found, whatever happens in between.
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
