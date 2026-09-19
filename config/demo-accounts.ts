/**
 * The demo sign-in roster (E-06 §48, §59, §99).
 *
 * The curated personas the development login screen offers: the Platform
 * Admin, the group's Owner, IT and department heads, and the people of one
 * company. The demo seeds many more accounts — every company's CEO and project
 * manager, local managers and members — and test fixtures besides; none of
 * those is a button here (E-06 §150).
 *
 * The seed (`prisma/seed/demo/users.ts`) creates these accounts and checks that
 * each exists with the role and position named here.
 *
 * ARMAAR's personas (D-01 §87) are listed first, as the demo that is shown;
 * the five-company demo's follow. `prisma/seed/armaar/people.ts` creates
 * ARMAAR's, and a test holds this list to it.
 *
 * Fictional identities only.
 */
import { roles, type PositionLevel, type RoleKey } from "./roles";

/** Shared by every seeded account. Development credentials only (PRD #9 §25). */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

/** ARMAAR's accounts: their own password where one is set (D-01 §87), else the demo's — as the ARMAAR seed sets them. */
export const ARMAAR_DEMO_PASSWORD = process.env.ARMAAR_DEMO_PASSWORD || DEMO_PASSWORD;

/** How the sign-in screen groups the personas (E-06 §59): by the level they work at. */
export type DemoAccountSection = "platform" | "group" | "company" | "contractor" | "examples";

export const DEMO_ACCOUNT_SECTIONS: Record<DemoAccountSection, string> = {
  platform: "Platform",
  group: "Group",
  company: "Aurelia Construction",
  contractor: "Contractor",
  examples: "Other companies",
};

export type DemoAccount = {
  username: string;
  role: RoleKey;
  /** The position the role is held with where the account starts (E-06 §7). */
  position: PositionLevel;
  section: DemoAccountSection;
  /** What the persona is, in the words the organization uses. */
  assignment: string;
};

export const PRIMARY_DEMO_ACCOUNTS: DemoAccount[] = [
  { username: "platform-admin", role: "PLATFORM_ADMIN", position: "MEMBER", section: "platform", assignment: "NESTO Platform" },
  { username: "owner", role: "OWNER", position: "GROUP_HEAD", section: "group", assignment: "Group Owner" },
  { username: "group-it", role: "GROUP_IT", position: "GROUP_HEAD", section: "group", assignment: "Head of Group IT" },
  { username: "group-hr", role: "HR", position: "GROUP_HEAD", section: "group", assignment: "Head of Group HR" },
  { username: "group-architecture", role: "ARCHITECT", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Architecture" },
  { username: "group-engineering", role: "ENGINEER", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Engineering" },
  { username: "group-finance", role: "FINANCE", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Finance" },
  { username: "group-legal", role: "LEGAL", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Legal" },
  { username: "group-sales", role: "SALES", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Sales" },
  { username: "group-procurement", role: "PROCUREMENT", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Procurement" },
  { username: "group-inventory", role: "INVENTORY", position: "GROUP_HEAD", section: "group", assignment: "Head of Group Inventory" },
  { username: "group-qaqc", role: "QAQC", position: "GROUP_HEAD", section: "group", assignment: "Head of Group QA/QC" },
  { username: "group-hse", role: "HSE", position: "GROUP_HEAD", section: "group", assignment: "Head of Group HSE" },
  { username: "ceo-a", role: "CEO", position: "MEMBER", section: "company", assignment: "CEO · Aurelia Construction" },
  { username: "pm-a", role: "PROJECT_MANAGER", position: "MEMBER", section: "company", assignment: "Project Manager · Riverside Residences" },
  { username: "architect-a", role: "ARCHITECT", position: "MEMBER", section: "company", assignment: "Architect · Aurelia Construction" },
  { username: "viewer-a", role: "VIEWER", position: "MEMBER", section: "company", assignment: "Viewer · Riverside Residences" },
  // One person from each other company, as §59 lists them.
  { username: "pm-b", role: "PROJECT_MANAGER", position: "MEMBER", section: "examples", assignment: "Project Manager · Meridian Developments" },
  { username: "finance-c", role: "FINANCE", position: "MEMBER", section: "examples", assignment: "Finance · Terra Infrastructure" },
  { username: "architect-d", role: "ARCHITECT", position: "MEMBER", section: "examples", assignment: "Architect · Forma Engineering" },
  { username: "hse-e", role: "HSE", position: "MEMBER", section: "examples", assignment: "HSE · Nova Hospitality Development" },
];

export const ARMAAR_ACCOUNT_SECTIONS: Record<DemoAccountSection, string> = {
  platform: "Platform",
  group: "ARMAAR Group",
  company: "BUILDING CONSTRUCTION INVEST",
  contractor: "ARLIS - NDERTIM",
  examples: "Other ARMAAR companies",
};

/** ARMAAR's personas (D-01 §87; docs/demo-armaar.md): its group heads, Tirana Lake's company and its builder, and the other companies' directors. */
export const ARMAAR_DEMO_ACCOUNTS: DemoAccount[] = [
  { username: "armaar.platform-admin", role: "PLATFORM_ADMIN", position: "MEMBER", section: "platform", assignment: "Platform Administrator" },
  { username: "armaar.owner", role: "OWNER", position: "GROUP_HEAD", section: "group", assignment: "Group Owner" },
  { username: "armaar.it", role: "GROUP_IT", position: "GROUP_HEAD", section: "group", assignment: "Group IT Manager" },
  { username: "armaar.hr", role: "HR", position: "GROUP_HEAD", section: "group", assignment: "Group HR Head" },
  { username: "armaar.architecture", role: "ARCHITECT", position: "GROUP_HEAD", section: "group", assignment: "Group Architecture Head" },
  { username: "armaar.engineering", role: "ENGINEER", position: "GROUP_HEAD", section: "group", assignment: "Group Engineering Head" },
  { username: "armaar.projects", role: "PROJECT_MANAGER", position: "GROUP_HEAD", section: "group", assignment: "Group Project Management Head" },
  { username: "armaar.finance", role: "FINANCE", position: "GROUP_HEAD", section: "group", assignment: "Group Finance Head" },
  { username: "armaar.legal", role: "LEGAL", position: "GROUP_HEAD", section: "group", assignment: "Group Legal Head" },
  { username: "armaar.sales", role: "SALES", position: "GROUP_HEAD", section: "group", assignment: "Group Sales Head" },
  { username: "armaar.procurement", role: "PROCUREMENT", position: "GROUP_HEAD", section: "group", assignment: "Group Procurement Head" },
  { username: "armaar.inventory", role: "INVENTORY", position: "GROUP_HEAD", section: "group", assignment: "Group Inventory & Logistics Head" },
  { username: "armaar.qaqc", role: "QAQC", position: "GROUP_HEAD", section: "group", assignment: "Group QA/QC Head" },
  { username: "armaar.hse", role: "HSE", position: "GROUP_HEAD", section: "group", assignment: "Group HSE Head" },
  { username: "bci.director", role: "CEO", position: "COMPANY_MANAGER", section: "company", assignment: "Company Director" },
  { username: "bci.pm", role: "PROJECT_MANAGER", position: "MEMBER", section: "company", assignment: "Project Manager · Tirana Lake" },
  { username: "bci.architect", role: "ARCHITECT", position: "COMPANY_MANAGER", section: "company", assignment: "Architect" },
  { username: "bci.engineering", role: "ENGINEER", position: "COMPANY_MANAGER", section: "company", assignment: "Engineering Manager" },
  { username: "bci.finance", role: "FINANCE", position: "COMPANY_MANAGER", section: "company", assignment: "Finance Manager" },
  { username: "bci.procurement", role: "PROCUREMENT", position: "COMPANY_MANAGER", section: "company", assignment: "Procurement Manager" },
  { username: "bci.sales", role: "SALES", position: "COMPANY_MANAGER", section: "company", assignment: "Sales Manager" },
  { username: "bci.hr", role: "HR", position: "COMPANY_MANAGER", section: "company", assignment: "HR Manager" },
  { username: "bci.legal", role: "LEGAL", position: "COMPANY_MANAGER", section: "company", assignment: "Legal Counsel" },
  { username: "bci.finance-specialist", role: "FINANCE", position: "MEMBER", section: "company", assignment: "Finance Specialist" },
  { username: "bci.sales-agent", role: "SALES", position: "MEMBER", section: "company", assignment: "Sales Agent" },
  { username: "bci.viewer", role: "VIEWER", position: "MEMBER", section: "company", assignment: "Board Observer · read only" },
  // Tirana Lake's builder: its site team has a login in BUILDING CONSTRUCTION INVEST too.
  { username: "arlis.director", role: "CEO", position: "COMPANY_MANAGER", section: "contractor", assignment: "Company Director" },
  { username: "arlis.civil", role: "ENGINEER", position: "MEMBER", section: "contractor", assignment: "Civil Engineer · Tirana Lake" },
  { username: "arlis.hr", role: "HR", position: "COMPANY_MANAGER", section: "contractor", assignment: "HR Manager" },
  { username: "arlis.buyer", role: "PROCUREMENT", position: "MEMBER", section: "contractor", assignment: "Procurement Specialist" },
  { username: "arlis.hse-officer", role: "HSE", position: "MEMBER", section: "contractor", assignment: "HSE Officer · Tirana Lake" },
  { username: "ideal.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "IDEAL Construction · Director" },
  { username: "unico.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "UNICO CONSTRUCTION · Director" },
  { username: "arsol.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "ARSOL ENERGY · Director" },
  { username: "smi.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "Saranda Marina Invest · Director" },
];

export function demoAccountByUsername(username: string): DemoAccount | undefined {
  return PRIMARY_DEMO_ACCOUNTS.find((account) => account.username === username);
}

/** The credentials a one-click demo sign-in uses: ARMAAR's persona with ARMAAR's password, or the demo's. */
export function demoSignInFor(username: string): { username: string; password: string } | undefined {
  if (ARMAAR_DEMO_ACCOUNTS.some((account) => account.username === username)) {
    return { username, password: ARMAAR_DEMO_PASSWORD };
  }
  const account = demoAccountByUsername(username);
  return account ? { username: account.username, password: DEMO_PASSWORD } : undefined;
}

/** The first curated account holding a role — every one of the sixteen has one. */
export function demoAccountForRole(role: RoleKey): DemoAccount | undefined {
  return PRIMARY_DEMO_ACCOUNTS.find((account) => account.role === role);
}

export function demoAccountLabel(account: DemoAccount): string {
  return `${roles[account.role].label} — ${account.assignment}`;
}
