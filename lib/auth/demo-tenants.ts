import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { roles, type RoleKey } from "@/config/roles";
import { prisma } from "@/lib/database/prisma";

/**
 * Demo tenants' people, for the development sign-in screen (E-06 §48, D-01 §87).
 *
 * A parent group seeded as a demo (`isDemo`) is data, never product behaviour
 * (D-01 §92), so its people are read from the database rather than listed
 * here: the group's heads, then each active company's employees who have a
 * login — the company with the most projects first. Test fixtures are never a
 * demo tenant. The curated five-company personas stay in
 * `config/demo-accounts.ts`.
 */

export type DemoTenantPersona = { username: string; role: RoleKey; title: string };
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
          user: { select: { username: true, personProfile: { select: { jobTitle: true } } } },
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
              companyMember: { select: { jobTitle: true, role: { select: { key: true } }, user: { select: { username: true } } } },
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
      heads.set(username, { username, role, title, order: DEPARTMENT_ORDER.get(position.groupDepartment.key) ?? GROUP_DEPARTMENTS.length });
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
            return [{ username: member.user.username, role, title: employment.jobTitle ?? member.jobTitle ?? roles[role].label }];
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
        .map(({ username, role, title }) => ({ username, role, title })),
      companies,
    };
  });
}

/** Whether a username is an active login of a demo tenant: one-click sign-in accepts it (never a fixture's). */
export async function isDemoTenantLogin(username: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { username, status: "ACTIVE", personProfile: { parentGroup: { isDemo: true, isTestFixture: false } } },
  });
  return count > 0;
}
