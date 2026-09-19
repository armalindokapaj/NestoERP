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
 * ARVELA's personas (D-01 §87) are listed first, as the demo that is shown;
 * the five-company demo's follow. `prisma/seed/arvela/people.ts` creates
 * ARVELA's, and a test holds this list to it.
 *
 * Fictional identities only.
 */
import { roles, type PositionLevel, type RoleKey } from "./roles";

/** Shared by every seeded account. Development credentials only (PRD #9 §25). */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

/** ARVELA's accounts: their own password where one is set (D-01 §87), else the demo's — as the ARVELA seed sets them. */
export const ARVELA_DEMO_PASSWORD = process.env.ARVELA_DEMO_PASSWORD || DEMO_PASSWORD;

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

export const ARVELA_ACCOUNT_SECTIONS: Record<DemoAccountSection, string> = {
  platform: "Platform",
  group: "ARVELA Group",
  company: "ARVELA INFRASTRUKTURA",
  contractor: "VELAR - NDERTIM",
  examples: "Other ARVELA companies",
};

/** ARVELA's personas (D-01 §87; docs/demo-arvela.md): its group heads, Liqeni Park's company and its builder, and the other companies' directors. */
export const ARVELA_DEMO_ACCOUNTS: DemoAccount[] = [
  { username: "arvela.platform-admin", role: "PLATFORM_ADMIN", position: "MEMBER", section: "platform", assignment: "Platform Administrator" },
  { username: "arvela.owner", role: "OWNER", position: "GROUP_HEAD", section: "group", assignment: "Group Owner" },
  { username: "arvela.it", role: "GROUP_IT", position: "GROUP_HEAD", section: "group", assignment: "Group IT Manager" },
  { username: "arvela.hr", role: "HR", position: "GROUP_HEAD", section: "group", assignment: "Group HR Head" },
  { username: "arvela.architecture", role: "ARCHITECT", position: "GROUP_HEAD", section: "group", assignment: "Group Architecture Head" },
  { username: "arvela.engineering", role: "ENGINEER", position: "GROUP_HEAD", section: "group", assignment: "Group Engineering Head" },
  { username: "arvela.projects", role: "PROJECT_MANAGER", position: "GROUP_HEAD", section: "group", assignment: "Group Project Management Head" },
  { username: "arvela.finance", role: "FINANCE", position: "GROUP_HEAD", section: "group", assignment: "Group Finance Head" },
  { username: "arvela.legal", role: "LEGAL", position: "GROUP_HEAD", section: "group", assignment: "Group Legal Head" },
  { username: "arvela.sales", role: "SALES", position: "GROUP_HEAD", section: "group", assignment: "Group Sales Head" },
  { username: "arvela.procurement", role: "PROCUREMENT", position: "GROUP_HEAD", section: "group", assignment: "Group Procurement Head" },
  { username: "arvela.inventory", role: "INVENTORY", position: "GROUP_HEAD", section: "group", assignment: "Group Inventory & Logistics Head" },
  { username: "arvela.qaqc", role: "QAQC", position: "GROUP_HEAD", section: "group", assignment: "Group QA/QC Head" },
  { username: "arvela.hse", role: "HSE", position: "GROUP_HEAD", section: "group", assignment: "Group HSE Head" },
  { username: "avi.director", role: "CEO", position: "COMPANY_MANAGER", section: "company", assignment: "Company Director" },
  { username: "avi.pm", role: "PROJECT_MANAGER", position: "MEMBER", section: "company", assignment: "Project Manager · Liqeni Park" },
  { username: "avi.architect", role: "ARCHITECT", position: "COMPANY_MANAGER", section: "company", assignment: "Architect" },
  { username: "avi.engineering", role: "ENGINEER", position: "COMPANY_MANAGER", section: "company", assignment: "Engineering Manager" },
  { username: "avi.finance", role: "FINANCE", position: "COMPANY_MANAGER", section: "company", assignment: "Finance Manager" },
  { username: "avi.procurement", role: "PROCUREMENT", position: "COMPANY_MANAGER", section: "company", assignment: "Procurement Manager" },
  { username: "avi.sales", role: "SALES", position: "COMPANY_MANAGER", section: "company", assignment: "Sales Manager" },
  { username: "avi.hr", role: "HR", position: "COMPANY_MANAGER", section: "company", assignment: "HR Manager" },
  { username: "avi.legal", role: "LEGAL", position: "COMPANY_MANAGER", section: "company", assignment: "Legal Counsel" },
  { username: "avi.finance-specialist", role: "FINANCE", position: "MEMBER", section: "company", assignment: "Finance Specialist" },
  { username: "avi.sales-agent", role: "SALES", position: "MEMBER", section: "company", assignment: "Sales Agent" },
  { username: "avi.viewer", role: "VIEWER", position: "MEMBER", section: "company", assignment: "Board Observer · read only" },
  // Liqeni Park's builder: its site team has a login in ARVELA INFRASTRUKTURA too.
  { username: "velar.director", role: "CEO", position: "COMPANY_MANAGER", section: "contractor", assignment: "Company Director" },
  { username: "velar.civil", role: "ENGINEER", position: "MEMBER", section: "contractor", assignment: "Civil Engineer · Liqeni Park" },
  { username: "velar.hr", role: "HR", position: "COMPANY_MANAGER", section: "contractor", assignment: "HR Manager" },
  { username: "velar.buyer", role: "PROCUREMENT", position: "MEMBER", section: "contractor", assignment: "Procurement Specialist" },
  { username: "velar.hse-officer", role: "HSE", position: "MEMBER", section: "contractor", assignment: "HSE Officer · Liqeni Park" },
  { username: "ideal.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "Arvela Ndertim · Director" },
  { username: "unika.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "UNIKA CONSTRUCTION · Director" },
  { username: "velsol.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "VELSOL ENERGY · Director" },
  { username: "smi.director", role: "CEO", position: "COMPANY_MANAGER", section: "examples", assignment: "Bay Marina Invest · Director" },
];

export function demoAccountByUsername(username: string): DemoAccount | undefined {
  return PRIMARY_DEMO_ACCOUNTS.find((account) => account.username === username);
}

/** The credentials a one-click demo sign-in uses: ARVELA's persona with ARVELA's password, or the demo's. */
export function demoSignInFor(username: string): { username: string; password: string } | undefined {
  if (ARVELA_DEMO_ACCOUNTS.some((account) => account.username === username)) {
    return { username, password: ARVELA_DEMO_PASSWORD };
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
