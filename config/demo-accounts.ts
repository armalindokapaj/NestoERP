/**
 * The NESTO demo roster (PRD #9 §24, §26, §28, §29).
 *
 * One source of truth for the development accounts: the seed creates them, the
 * login page offers them for one-click sign-in, and the role tests resolve
 * `loginAs("PROJECT_MANAGER")` through it. Adding a role means adding it here
 * and re-running the seed.
 *
 * Fictional identities only — no real personal data (PRD #9 §230).
 */
import { ROLE_KEYS, roles, type RoleKey } from "./roles";

/** Shared by every seeded account. Development credentials only (PRD #9 §25). */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

export type DemoUserSpec = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleKey;
  department: string;
  jobTitle: string;
  phone: string;
};

/** One active demo account per role (PRD #9 §24, §26, §28). */
export const COMPANY_A_USERS: DemoUserSpec[] = [
  { id: "user_owner", email: "owner@nesto.test", firstName: "Olivia", lastName: "Owner", role: "OWNER", department: "management", jobTitle: "Owner", phone: "+351 910 000 001" },
  { id: "user_admin", email: "admin@nesto.test", firstName: "Adam", lastName: "Admin", role: "ADMIN", department: "administration", jobTitle: "Platform Administrator", phone: "+351 910 000 002" },
  { id: "user_it", email: "it@nesto.test", firstName: "Ian", lastName: "Carter", role: "COMPANY_IT", department: "it", jobTitle: "IT Manager", phone: "+351 910 000 003" },
  { id: "user_hr", email: "hr@nesto.test", firstName: "Hannah", lastName: "Reed", role: "HR", department: "hr", jobTitle: "HR Manager", phone: "+351 910 000 004" },
  { id: "user_ceo", email: "ceo@nesto.test", firstName: "Charles", lastName: "Morgan", role: "CEO", department: "management", jobTitle: "Chief Executive Officer", phone: "+351 910 000 005" },
  { id: "user_pm", email: "pm@nesto.test", firstName: "Alex", lastName: "Morgan", role: "PROJECT_MANAGER", department: "projects", jobTitle: "Senior Project Manager", phone: "+351 910 000 006" },
  { id: "user_architect", email: "architect@nesto.test", firstName: "Anna", lastName: "Rossi", role: "ARCHITECT", department: "architecture", jobTitle: "Lead Architect", phone: "+351 910 000 007" },
  { id: "user_engineer", email: "engineer@nesto.test", firstName: "Ethan", lastName: "Cole", role: "ENGINEER", department: "engineering", jobTitle: "Structural Engineer", phone: "+351 910 000 008" },
  { id: "user_finance", email: "finance@nesto.test", firstName: "Fiona", lastName: "Blake", role: "FINANCE", department: "finance", jobTitle: "Finance Manager", phone: "+351 910 000 009" },
  { id: "user_legal", email: "legal@nesto.test", firstName: "Laura", lastName: "Stein", role: "LEGAL", department: "legal", jobTitle: "Legal Counsel", phone: "+351 910 000 010" },
  { id: "user_sales", email: "sales@nesto.test", firstName: "Sophie", lastName: "Grant", role: "SALES", department: "sales", jobTitle: "Business Development Lead", phone: "+351 910 000 011" },
  { id: "user_procurement", email: "procurement@nesto.test", firstName: "Peter", lastName: "Nolan", role: "PROCUREMENT", department: "procurement", jobTitle: "Procurement Manager", phone: "+351 910 000 012" },
  { id: "user_inventory", email: "inventory@nesto.test", firstName: "Isaac", lastName: "Turner", role: "INVENTORY", department: "inventory", jobTitle: "Stock Controller", phone: "+351 910 000 013" },
  { id: "user_qaqc", email: "qaqc@nesto.test", firstName: "Quinn", lastName: "Foster", role: "QAQC", department: "qaqc", jobTitle: "QA/QC Engineer", phone: "+351 910 000 014" },
  { id: "user_hse", email: "hse@nesto.test", firstName: "Henry", lastName: "Stone", role: "HSE", department: "hse", jobTitle: "HSE Officer", phone: "+351 910 000 015" },
  { id: "user_viewer", email: "viewer@nesto.test", firstName: "Victor", lastName: "Lane", role: "VIEWER", department: "projects", jobTitle: "Observer", phone: "+351 910 000 016" },
];

/** Company B exists so tenant isolation can actually be proven (PRD #9 §12). */
export const COMPANY_B_USERS: DemoUserSpec[] = [
  { id: "user_owner_b", email: "owner-b@nesto.test", firstName: "Bruno", lastName: "Keller", role: "OWNER", department: "management", jobTitle: "Owner", phone: "+49 30 000 001" },
  { id: "user_viewer_b", email: "viewer-b@nesto.test", firstName: "Bea", lastName: "Hoffman", role: "VIEWER", department: "projects", jobTitle: "Observer", phone: "+49 30 000 002" },
];


const byRole = new Map<RoleKey, DemoUserSpec>(
  COMPANY_A_USERS.map((account) => [account.role, account]),
);

export function demoAccountForRole(role: RoleKey): DemoUserSpec | undefined {
  return byRole.get(role);
}

/** The roster in the role order used everywhere else in the product. */
export const demoAccountsInRoleOrder: DemoUserSpec[] = ROLE_KEYS.map((key) =>
  byRole.get(key),
).filter((account): account is DemoUserSpec => Boolean(account));

export function demoAccountLabel(account: DemoUserSpec): string {
  return roles[account.role].label;
}

/**
 * Fails loudly if a role has no demo account, so the "one account per role"
 * guarantee cannot quietly lapse.
 */
export function rolesMissingDemoAccount(): RoleKey[] {
  return ROLE_KEYS.filter((key) => !byRole.has(key));
}
