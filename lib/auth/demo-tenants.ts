import { DEMO_ACCOUNT_SECTIONS, DEMO_PASSWORD, PRIMARY_DEMO_ACCOUNTS, demoAccountByUsername, type DemoAccountSection } from "@/config/demo-accounts";
import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { roles, type RoleKey } from "@/config/roles";
import { prisma } from "@/lib/database/prisma";
import { SIGN_IN_ACCOUNT, signInWorkspace } from "./credentials";
import { verifyPassword } from "./password";
import { normaliseUsername } from "./username";

/**
 * The demo accounts a developer can be (E-06 §48, D-01 §87, C-01 §13, §17, §41).
 *
 * Two kinds, and nothing else: the curated five-company personas in
 * `config/demo-accounts.ts`, and the active logins of a parent group seeded as
 * a demo (`isDemo`). A demo tenant is data, never product behaviour (D-01 §92),
 * so its people are read from the database rather than listed here: the
 * group's heads, then each active company's employees who have a login — the
 * company with the most projects first. Test fixtures are never a demo tenant.
 *
 * One roster and one eligibility rule for both ways in: the sign-in page's
 * one-click picker and the in-app demo user switcher.
 */

export type DemoTenantPersona = { username: string; name: string; role: RoleKey; title: string };
export type DemoTenantCompany = { name: string; personas: DemoTenantPersona[] };
export type DemoTenant = { name: string; heads: DemoTenantPersona[]; companies: DemoTenantCompany[] };

const DEPARTMENT_ORDER = new Map<string, number>(GROUP_DEPARTMENTS.map((department, index) => [department.key, index]));
const EMPLOYED = ["ACTIVE", "ON_LEAVE"] as const;

/** The company's director first, then by role as the product orders them. */
function rank(role: RoleKey): string {
  return role === "CEO" ? "" : roles[role].code;
}

function roleKey(key: string | undefined): RoleKey | null {
  return key && Object.hasOwn(roles, key) ? (key as RoleKey) : null;
}

const nameOf = (user: { firstName: string; lastName: string }) => `${user.firstName} ${user.lastName}`;

export async function listDemoTenants(): Promise<DemoTenant[]> {
  const groups = await prisma.parentGroup.findMany({
    where: { isDemo: true, isTestFixture: false },
    orderBy: { name: "asc" },
    select: {
      name: true,
      departmentAssignments: {
        where: { positionLevel: "GROUP_HEAD", status: "ACTIVE", companyId: null, user: { status: "ACTIVE" } },
        select: {
          functionalRoleKey: true,
          groupDepartment: { select: { key: true } },
          user: { select: { username: true, firstName: true, lastName: true, personProfile: { select: { jobTitle: true } } } },
        },
      },
      companies: {
        where: { status: "ACTIVE" },
        select: {
          name: true,
          _count: { select: { projects: true } },
          employeeProfiles: {
            where: {
              employmentStatus: { in: [...EMPLOYED] },
              companyMember: { status: "ACTIVE", user: { status: "ACTIVE" } },
            },
            select: {
              jobTitle: true,
              companyMember: {
                select: { jobTitle: true, role: { select: { key: true } }, user: { select: { username: true, firstName: true, lastName: true } } },
              },
            },
          },
        },
      },
    },
  });

  return groups.map((group) => {
    const heads = new Map<string, DemoTenantPersona & { order: number }>();
    for (const position of group.departmentAssignments) {
      const role = roleKey(position.functionalRoleKey);
      const { username } = position.user;
      if (!role || heads.has(username)) continue;
      const title = position.user.personProfile?.jobTitle ?? roles[role].label;
      heads.set(username, { username, name: nameOf(position.user), role, title, order: DEPARTMENT_ORDER.get(position.groupDepartment.key) ?? GROUP_DEPARTMENTS.length });
    }

    const companies = group.companies
      .map((company) => ({
        name: company.name,
        projects: company._count.projects,
        personas: company.employeeProfiles
          .flatMap((employment) => {
            const member = employment.companyMember;
            const role = roleKey(member?.role.key);
            if (!member || !role || heads.has(member.user.username)) return [];
            return [{ username: member.user.username, name: nameOf(member.user), role, title: employment.jobTitle ?? member.jobTitle ?? roles[role].label }];
          })
          .sort((a, b) => rank(a.role).localeCompare(rank(b.role)) || a.username.localeCompare(b.username)),
      }))
      .filter((company) => company.personas.length > 0)
      .sort((a, b) => b.projects - a.projects || b.personas.length - a.personas.length || a.name.localeCompare(b.name))
      .map(({ name, personas }) => ({ name, personas }));

    return {
      name: group.name,
      heads: [...heads.values()]
        .sort((a, b) => a.order - b.order || a.username.localeCompare(b.username))
        .map(({ username, name, role, title }) => ({ username, name, role, title })),
      companies,
    };
  });
}

/* The roster, as the picker and the switcher show it ------------------------ */

export type DemoAccountOption = {
  code: string;
  label: string;
  /** The person's name; empty for a curated persona the database does not hold yet. */
  name: string;
  assignment: string;
  username: string;
};

/** A heading and its personas: the level they work at (E-06 §59), or one company of a demo tenant. */
export type DemoSectionOption = {
  name: string;
  accounts: DemoAccountOption[];
  /** Folded under its heading until opened. */
  folded?: boolean;
};

/** One demo's personas: a demo tenant read from its data (D-01 §87), or the curated five-company demo. */
export type DemoRosterOption = {
  name: string;
  /** What is inside while it is folded. */
  summary: string;
  sections: DemoSectionOption[];
  folded?: boolean;
};

function option(role: RoleKey, username: string, name: string, assignment: string): DemoAccountOption {
  return { code: roles[role].code, label: roles[role].label, name, assignment, username };
}

/**
 * The rosters: each demo tenant's people as its data has them, its busiest
 * company open (D-01 §87), then the curated five-company demo, folded.
 */
export async function demoRosters(): Promise<DemoRosterOption[]> {
  // A convenience: a database it cannot read leaves the curated personas, by username.
  const [tenants, curated] = await Promise.all([
    listDemoTenants().catch((): DemoTenant[] => []),
    prisma.user
      .findMany({ where: { username: { in: PRIMARY_DEMO_ACCOUNTS.map((account) => account.username) } }, select: { username: true, firstName: true, lastName: true } })
      .catch(() => []),
  ]);
  const curatedNames = new Map(curated.map((user) => [user.username, nameOf(user)]));
  const sections = new Map<DemoAccountSection, DemoAccountOption[]>();
  for (const account of PRIMARY_DEMO_ACCOUNTS) {
    const entry = option(account.role, account.username, curatedNames.get(account.username) ?? "", account.assignment);
    sections.set(account.section, [...(sections.get(account.section) ?? []), entry]);
  }
  return [
    ...tenants.map((tenant) => ({
      name: tenant.name,
      summary: `${tenant.heads.length} group heads, ${tenant.companies.length} companies`,
      sections: [
        { name: tenant.name, accounts: tenant.heads.map((head) => option(head.role, head.username, head.name, head.title)) },
        ...tenant.companies.map((company, index) => ({
          name: company.name,
          accounts: company.personas.map((persona) => option(persona.role, persona.username, persona.name, persona.title)),
          folded: index > 0,
        })),
      ],
    })),
    {
      name: "Five-company demo",
      summary: "Aurelia Construction and four other companies",
      sections: [...sections].map(([section, accounts]) => ({ name: DEMO_ACCOUNT_SECTIONS[section], accounts })),
      folded: tenants.length > 0,
    },
  ];
}

/* Who may be signed into this way ------------------------------------------ */

export type DemoAccountRefusal = "UNKNOWN" | "NOT_SEEDED" | "INACTIVE" | "NO_WORKSPACE" | "PASSWORD_REFUSED";

export type DemoAccountTarget =
  | {
      allowed: true;
      userId: string;
      username: string;
      name: string;
      /** A Platform Admin: the session names no membership (E-06 §19). */
      platform: boolean;
      /** Where a normal sign-in of this account lands (C-01 §26, §27). */
      landing: "/platform-admin" | "/dashboard";
    }
  | { allowed: false; reason: DemoAccountRefusal };

/** Development messages: none names a password, a hash or an internal detail (C-01 §46). */
export const DEMO_ACCOUNT_REFUSALS: Record<DemoAccountRefusal, string> = {
  UNKNOWN: "Unknown demo account.",
  NOT_SEEDED: "Demo account not found. Run pnpm db:seed.",
  INACTIVE: "That demo account is not active.",
  NO_WORKSPACE: "That demo account has no active company to sign in to.",
  PASSWORD_REFUSED: "The demo password was refused: a demo tenant seeded with a password of its own signs in through the form.",
};

/**
 * Whether a username may be signed into without typing a password, and where
 * that sign-in would land (C-01 §13, §18, §20).
 *
 * Everything the credentials check will decide is decided here first, by the
 * same rules — the account active, a workspace to start in, the demo password
 * its password — so a demo user switch that passes this does not end the
 * current session only to be refused. Anything but a curated persona or a demo
 * tenant's login is UNKNOWN, whether or not it exists: a customer's account is
 * never a target, and the answer does not say it is there.
 */
export async function resolveDemoAccountTarget(input: string): Promise<DemoAccountTarget> {
  const username = normaliseUsername(input);
  const curated = demoAccountByUsername(username) !== undefined;
  const account = username
    ? await prisma.user.findUnique({
        where: { username },
        include: { ...SIGN_IN_ACCOUNT, personProfile: { select: { parentGroup: { select: { isDemo: true, isTestFixture: true } } } } },
      })
    : null;
  const group = account?.personProfile?.parentGroup;
  const demoTenant = group?.isDemo === true && !group.isTestFixture;

  if (!curated && !demoTenant) return { allowed: false, reason: "UNKNOWN" };
  if (!account) return { allowed: false, reason: "NOT_SEEDED" };
  if (account.status !== "ACTIVE") return { allowed: false, reason: "INACTIVE" };
  const workspace = signInWorkspace(account);
  if (!workspace) return { allowed: false, reason: "NO_WORKSPACE" };
  const lapsed = account.temporaryPasswordExpiresAt !== null && account.temporaryPasswordExpiresAt.getTime() <= Date.now();
  if (lapsed || !(await verifyPassword(DEMO_PASSWORD, account.passwordHash))) return { allowed: false, reason: "PASSWORD_REFUSED" };

  return {
    allowed: true,
    userId: account.id,
    username: account.username,
    name: nameOf(account),
    platform: workspace.platform,
    landing: workspace.platform ? "/platform-admin" : "/dashboard",
  };
}
