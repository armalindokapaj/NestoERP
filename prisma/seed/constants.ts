/**
 * Deterministic seed identifiers (PRD #9 §9, E-06 §106).
 *
 * Automated tests address records by these ids, so they must never be random.
 * Running the seed on a clean database always produces the same graph.
 *
 * The demo group's companies and projects live in `demo/projects.ts`, the test
 * fixtures in `fixtures/constants.ts`; this file re-exports both so a module
 * seed has one import. There is deliberately no "Company B" here that means
 * the old second tenant: `COMPANY_B` is Meridian Developments, and the tenant
 * isolation is proven against is `FIXTURE_TENANT`.
 */

export { DEMO_PASSWORD } from "../../config/demo-accounts";

export {
  CLIENT_COMPANY,
  COMPANY_A,
  COMPANY_B,
  COMPANY_C,
  COMPANY_D,
  COMPANY_E,
  DEMO_COMPANIES,
  DEMO_COMPANY_IDS,
  DEMO_GROUP,
  DEMO_PROJECTS,
  PROJECT_IDS,
  companyFor,
  companyOfClient,
  companyOfProject,
  demoCompany,
} from "./demo/projects";

export {
  COMPANY_SUSPENDED,
  DEMO_EXISTING_ACCOUNT_INVITE_TOKEN,
  DEMO_INVITE_TOKEN,
  FIXTURE_GROUP,
  FIXTURE_OWNER,
  FIXTURE_PROJECTS,
  FIXTURE_TENANT,
  FIXTURE_WORKS,
  INVITED_USER,
  INVITE_IDS,
  NEGATIVE_USERS,
  SUSPENDED_COMPANY_USER,
  TENANT_USERS,
} from "./fixtures/constants";

export type { SeedMembers } from "./demo/users";

/**
 * Seed dates are generated relative to this anchor so "overdue", "due today"
 * and "upcoming" stay meaningful however long after the seed runs
 * (PRD #9 §228).
 */
export const SEED_NOW = new Date();

export function daysFromNow(days: number): Date {
  const date = new Date(SEED_NOW);
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}
