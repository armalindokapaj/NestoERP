/**
 * The NESTO demo company and its development accounts (spec §65).
 *
 * Single source of truth for the demo roster. The seed creates these records,
 * the login page offers them for one-click sign-in, and scripts/verify-roles.ts
 * signs in as each of them — all from this list, so they can never disagree.
 *
 * Adding a role means adding it here and re-running `pnpm db:seed`.
 */
import { ROLE_KEYS, roles, type RoleKey } from "./roles";

/** Shared by every seeded account. Development credentials only. */
export const DEMO_PASSWORD = "nesto1234";

export const DEMO_COMPANY = {
  slug: "nesto-demo-construction",
  name: "NESTO Demo Construction",
  industry: "Construction & Engineering",
  country: "Portugal",
  address: "Rua da Alfândega 42, 1100-016 Lisboa",
  email: "hello@nestodemo.test",
  phone: "+351 21 000 0000",
  website: "https://nestodemo.test",
  logo: null as string | null,
};

export type DemoAccount = {
  email: string;
  firstName: string;
  lastName: string;
  role: RoleKey;
  department: string;
  jobTitle: string;
  phone: string;
};

export const demoAccounts: DemoAccount[] = [
  { email: "owner@nesto.test", firstName: "Elias", lastName: "Moreau", role: "OWNER", department: "Executive", jobTitle: "Owner", phone: "+351 910 000 001" },
  { email: "admin@nesto.test", firstName: "Clara", lastName: "Jensen", role: "ADMIN", department: "Administration", jobTitle: "Platform Administrator", phone: "+351 910 000 002" },
  { email: "it@nesto.test", firstName: "Viktor", lastName: "Sorensen", role: "IT", department: "IT", jobTitle: "IT Manager", phone: "+351 910 000 003" },
  { email: "hr@nesto.test", firstName: "Aisha", lastName: "Karim", role: "HR", department: "Human Resources", jobTitle: "HR Manager", phone: "+351 910 000 004" },
  { email: "ceo@nesto.test", firstName: "Sofia", lastName: "Almeida", role: "CEO", department: "Executive", jobTitle: "Chief Executive Officer", phone: "+351 910 000 005" },
  { email: "pm@nesto.test", firstName: "Liam", lastName: "Novak", role: "PROJECT_MANAGER", department: "Projects", jobTitle: "Senior Project Manager", phone: "+351 910 000 006" },
  { email: "architect@nesto.test", firstName: "Marta", lastName: "Lehmann", role: "ARCHITECT", department: "Design", jobTitle: "Lead Architect", phone: "+351 910 000 007" },
  { email: "engineer@nesto.test", firstName: "Omar", lastName: "Haddad", role: "ENGINEER", department: "Engineering", jobTitle: "Structural Engineer", phone: "+351 910 000 008" },
  { email: "finance@nesto.test", firstName: "Daniel", lastName: "Okonkwo", role: "FINANCE", department: "Finance", jobTitle: "Finance Manager", phone: "+351 910 000 009" },
  { email: "legal@nesto.test", firstName: "Elena", lastName: "Costa", role: "LEGAL", department: "Legal", jobTitle: "Legal Counsel", phone: "+351 910 000 010" },
  { email: "sales@nesto.test", firstName: "Priya", lastName: "Raman", role: "SALES", department: "Sales", jobTitle: "Business Development Lead", phone: "+351 910 000 011" },
  { email: "procurement@nesto.test", firstName: "Jonas", lastName: "Weber", role: "PROCUREMENT", department: "Procurement", jobTitle: "Procurement Manager", phone: "+351 910 000 012" },
  { email: "inventory@nesto.test", firstName: "Nina", lastName: "Petrova", role: "INVENTORY", department: "Operations", jobTitle: "Stock Controller", phone: "+351 910 000 013" },
  { email: "qaqc@nesto.test", firstName: "Tomas", lastName: "Rivera", role: "QAQC", department: "Quality", jobTitle: "QA/QC Engineer", phone: "+351 910 000 014" },
  { email: "hse@nesto.test", firstName: "Hannah", lastName: "Berg", role: "HSE", department: "Health & Safety", jobTitle: "HSE Officer", phone: "+351 910 000 015" },
  { email: "viewer@nesto.test", firstName: "Sam", lastName: "Whitfield", role: "VIEWER", department: "General", jobTitle: "Observer", phone: "+351 910 000 016" },
];

const byRole = new Map<RoleKey, DemoAccount>(
  demoAccounts.map((account) => [account.role, account]),
);

export function demoAccountForRole(role: RoleKey): DemoAccount | undefined {
  return byRole.get(role);
}

/** The roster in the role order used everywhere else in the product. */
export const demoAccountsInRoleOrder: DemoAccount[] = ROLE_KEYS.map((key) =>
  byRole.get(key),
).filter((account): account is DemoAccount => Boolean(account));

/**
 * Fails loudly during development if a role has no demo account, so the
 * "one account per role" guarantee cannot quietly lapse.
 */
export function rolesMissingDemoAccount(): RoleKey[] {
  return ROLE_KEYS.filter((key) => !byRole.has(key));
}

export function demoAccountLabel(account: DemoAccount): string {
  return roles[account.role].label;
}
