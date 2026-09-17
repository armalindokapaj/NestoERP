/**
 * The membership lookups every module seed uses, over both groups (E-06 §45,
 * §105).
 *
 * Membership ids are deterministic, so this needs no database: the seed entry
 * point and every test fixture that re-runs one module's seed use the same
 * lookups. The demo group's personas stand in for each other across its
 * companies; a fixture company has exactly the people seeded into it, so
 * asking it for a persona that is not there is a seed bug, not a fallback.
 */
import { COMPANY_SUSPENDED, FIXTURE_TENANT, FIXTURE_WORKS, type SeedMembers } from "./constants";
import { demoMembers } from "./demo/organization";
import { fixtureMemberOf } from "./fixtures/organization";

const FIXTURE_COMPANIES = new Set<string>([FIXTURE_TENANT, FIXTURE_WORKS, COMPANY_SUSPENDED]);

export function seedMembers(): SeedMembers {
  const demo = demoMembers();
  const inFixture = (companyId: string, userId: string) => {
    const memberId = fixtureMemberOf(userId);
    if (!memberId) throw new Error(`Seed: ${userId} has no membership in ${companyId}.`);
    return memberId;
  };
  return {
    get: (userId) => demo.get(userId) ?? fixtureMemberOf(userId),
    in: (companyId, persona) => (FIXTURE_COMPANIES.has(companyId) ? inFixture(companyId, persona) : demo.in(companyId, persona)),
    userIn: (companyId, persona) => (FIXTURE_COMPANIES.has(companyId) ? (inFixture(companyId, persona), persona) : demo.userIn(companyId, persona)),
  };
}
