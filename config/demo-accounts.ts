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
 * Fictional identities only.
 */
import { roles, type PositionLevel, type RoleKey } from "./roles";

/** Shared by every seeded account. Development credentials only (PRD #9 §25). */
export const DEMO_PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

/** How the sign-in screen groups the personas (E-06 §59): by the level they work at. */
export type DemoAccountSection = "platform" | "group" | "company" | "examples";

export const DEMO_ACCOUNT_SECTIONS: Record<DemoAccountSection, string> = {
  platform: "Platform",
  group: "Group",
  company: "Aurelia Construction",
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

export function demoAccountByUsername(username: string): DemoAccount | undefined {
  return PRIMARY_DEMO_ACCOUNTS.find((account) => account.username === username);
}

/** The first curated account holding a role — every one of the sixteen has one. */
export function demoAccountForRole(role: RoleKey): DemoAccount | undefined {
  return PRIMARY_DEMO_ACCOUNTS.find((account) => account.role === role);
}

export function demoAccountLabel(account: DemoAccount): string {
  return `${roles[account.role].label} — ${account.assignment}`;
}
