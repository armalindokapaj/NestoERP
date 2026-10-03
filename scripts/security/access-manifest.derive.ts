/**
 * The expected-access manifest, derived (AUD-06 §2 first deliverable, §5, RP-01).
 *
 * Nothing here is a second, hand-written role truth. Every fact is read from
 * the source the product itself reads:
 *
 *   config/roles.ts, config/modules.ts, config/access.ts,
 *   config/permissions.ts, config/role-defaults.ts   the role × position × module matrix
 *   config/demo-accounts.ts                           the curated sign-in personas
 *   prisma/seed/demo/**, prisma/seed/fixtures/**      the five-company demo and the test fixtures
 *   prisma/seed/business.ts, team.ts                  project teams and the invited account
 *
 * and each seeded membership's module access is computed by the product's own
 * resolver — `assembleContext` (lib/context/build-context.ts), which is what a
 * signed-in session gets — from the role, the position `positionFor` derives
 * from the seeded department assignments, the grants and the company's module
 * switches. The Group workspace verdicts are `hasGroupStanding` and
 * `mayEnterGroupWorkspace` over those same contexts.
 *
 * Where a seed fact lives in a non-exported literal (the demo's project teams
 * in business.ts), it is read from the source with the TypeScript parser and
 * the derivation fails loudly when the shape it expects is gone, rather than
 * guessing. tests/security/access-manifest.test.ts compares the result with
 * what the seeded database and the real resolver answer.
 */
import { readFileSync } from "node:fs";

import type { User } from "@prisma/client";
import ts from "typescript";

import { DATA_SCOPES, type AccessLevel, type DataScope } from "../../config/access";
import { PRIMARY_DEMO_ACCOUNTS } from "../../config/demo-accounts";
import { GROUP_DEPARTMENTS, groupDepartmentId, type GroupDepartmentKey } from "../../config/group-departments";
import { MODULE_KEYS, type ModuleKey } from "../../config/modules";
import type { Permission } from "../../config/permissions";
import { defaultAccessFor } from "../../config/role-defaults";
import { POSITION_LEVELS, ROLE_KEYS, roles, type PositionLevel, type RoleKey } from "../../config/roles";
import { assembleContext, hasGroupStanding, mayEnterGroupWorkspace } from "../../lib/context/build-context";
import type { ContextAssignment, ContextGrant } from "../../lib/context/organization-access";
import type { UserContext } from "../../lib/context/types";
import { DEMO_COMPANIES, DEMO_COMPANY_CODES, DEMO_GROUP, DEMO_PROJECTS } from "../../prisma/seed/demo/projects";
import { COMPANY_USERS, GROUP_USERS, PLATFORM_USERS, POSITIONS, isMemberOf, memberId as demoMemberId, personaIn } from "../../prisma/seed/demo/users";
import {
  COMPANY_SUSPENDED,
  FIXTURE_GROUP,
  FIXTURE_OWNER,
  FIXTURE_PROJECTS,
  FIXTURE_TENANT,
  FIXTURE_TENANT_DISABLED_MODULES,
  FIXTURE_WORKS,
  INVITED_USER,
  NEGATIVE_USERS,
  SOLO_COMPANY,
  SOLO_GROUP,
  SOLO_OWNER,
  SUSPENDED_COMPANY_USER,
  TENANT_USERS,
} from "../../prisma/seed/fixtures/constants";
import { fixtureMemberOf } from "../../prisma/seed/fixtures/organization";

export const ACCESS_MANIFEST_PATH = "docs/security/access-manifest.json";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export type ModuleCell = { accessLevel: AccessLevel; scope: DataScope; permissions: Permission[] };
export type ProfileCell = ModuleCell & { enabled: boolean };

export type ManifestProject = { projectId: string; name: string; manager: boolean };

export type ManifestMembership = {
  companyId: string;
  company: string;
  companyStatus: "ACTIVE" | "SUSPENDED";
  membershipId: string;
  membershipStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "INVITED";
  role: RoleKey;
  /** What `positionFor` derives from the seeded department assignments. */
  position: PositionLevel;
  /** The group department key of the membership's branch, or null when the company runs no such branch. */
  department: GroupDepartmentKey | null;
  jobTitle: string | null;
  /** Whether this company is the person's employing legal entity. Null where the seed records none. */
  employing: boolean | null;
  projects: ManifestProject[];
  grants: ContextGrant[];
  /** Whether a session can work here: user, membership, company and group all active. */
  usable: boolean;
  /** Key into `profiles`: the resolver's per-module {accessLevel, scope, enabled, permissions}, or null when not usable. */
  profile: string | null;
};

export type ManifestPersona = {
  username: string;
  userId: string;
  name: string;
  tenant: "platform" | "demo" | "fixture";
  parentGroupId: string | null;
  /** How the persona is reached on the sign-in screen: the curated roster, a demo tenant's data-driven roster, or not at all. */
  picker: "curated" | null;
  /** config/demo-accounts.ts's statement about a curated persona, kept beside what the seed derives so the two can be compared. */
  curated: { role: RoleKey; position: PositionLevel; assignment: string } | null;
  userStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  platformRole: RoleKey | null;
  memberships: ManifestMembership[];
  /** Where a fresh sign-in lands: the platform, the oldest usable membership's company, or nowhere. */
  signIn: { outcome: "PLATFORM" | "COMPANY" | "GROUP" | "REFUSED"; companyId: string | null };
  groupWorkspace: { standing: boolean; mayEnter: boolean };
};

export type AccessManifest = {
  $comment: string;
  sources: string[];
  accessLevels: readonly AccessLevel[];
  dataScopes: readonly DataScope[];
  modules: readonly ModuleKey[];
  roles: Array<{ key: RoleKey; label: string; department: string; readOnly: boolean; platformOnly: boolean }>;
  /** config/role-defaults.ts, cell by cell, as `LEVEL/SCOPE`; the permissions of every combination a persona holds are in `profiles`. */
  roleMatrix: Record<RoleKey, Record<PositionLevel, Record<ModuleKey, string>>>;
  tenants: Array<{ parentGroupId: string; name: string; standalone: boolean; companies: Array<{ id: string; name: string; status: "ACTIVE" | "SUSPENDED"; disabledModules: ModuleKey[] }> }>;
  personas: ManifestPersona[];
  profiles: Record<string, Record<ModuleKey, ProfileCell>>;
};

/* -------------------------------------------------------------------------- */
/* Seed inputs, normalised                                                     */
/* -------------------------------------------------------------------------- */

type SeedCompany = { id: string; name: string; status: "ACTIVE" | "SUSPENDED"; parentGroupId: string; disabledModules: ModuleKey[]; departments: readonly GroupDepartmentKey[] };
type SeedPosition = { department: GroupDepartmentKey; role: RoleKey; level: Exclude<PositionLevel, "MEMBER">; companyId: string | null };
type SeedLogin = {
  companyId: string;
  membershipId: string;
  status: ManifestMembership["membershipStatus"];
  role: RoleKey;
  department: GroupDepartmentKey | null;
  jobTitle: string | null;
  employing: boolean | null;
};
type SeedAccount = {
  username: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  tenant: ManifestPersona["tenant"];
  parentGroupId: string | null;
  userStatus: ManifestPersona["userStatus"];
  platformRole: RoleKey | null;
  picker: ManifestPersona["picker"];
  logins: SeedLogin[];
  positions: SeedPosition[];
  grants: ContextGrant[];
};
type SeedProject = { id: string; name: string; companyId: string; managerUserId: string; teamUserIds: string[] };

const ALL_DEPARTMENTS = GROUP_DEPARTMENTS.map((department) => department.key);

/** The seed files a derivation reads; listed in the manifest so a reviewer knows where to look. */
const SOURCES = [
  "config/access.ts",
  "config/demo-accounts.ts",
  "config/group-departments.ts",
  "config/modules.ts",
  "config/permissions.ts",
  "config/role-defaults.ts",
  "config/roles.ts",
  "lib/context/build-context.ts (assembleContext, hasGroupStanding, mayEnterGroupWorkspace)",
  "lib/context/organization-access.ts (positionFor, grantsInCompany)",
  "prisma/seed/business.ts",
  "prisma/seed/demo/organization.ts",
  "prisma/seed/demo/projects.ts",
  "prisma/seed/demo/users.ts",
  "prisma/seed/fixtures/constants.ts",
  "prisma/seed/fixtures/organization.ts",
  "prisma/seed/team.ts",
];

/* The demo's project teams: a non-exported literal in business.ts ---------- */

function parseSource(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findArrayDeclaration(source: ts.SourceFile, name: string): ts.ArrayLiteralExpression[] {
  const found: ts.ArrayLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
      if (ts.isArrayLiteralExpression(init)) found.push(init);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name && ts.isStringLiteralLike(property.initializer)) return property.initializer.text;
  }
  return null;
}

function stringArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name && ts.isArrayLiteralExpression(property.initializer)) {
      return property.initializer.elements.map((element) => {
        if (!ts.isStringLiteralLike(element)) throw new Error(`access manifest: ${name} holds a non-literal; the seed's shape changed`);
        return element.text;
      });
    }
  }
  return null;
}

/**
 * business.ts: `const PROJECTS = [{ ...DEMO_PROJECTS.a, manager, team }]`, each
 * team member placed with `members.in(companyId, userId)` — the stand-in rule
 * of `personIn` — and the manager added to the team.
 */
function demoProjects(): SeedProject[] {
  const source = parseSource("prisma/seed/business.ts");
  const [array] = findArrayDeclaration(source, "PROJECTS");
  if (!array) throw new Error("access manifest: prisma/seed/business.ts no longer declares PROJECTS");
  return array.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) throw new Error("access manifest: a demo project is not an object literal");
    const spread = element.properties.find(ts.isSpreadAssignment);
    const code = spread && ts.isPropertyAccessExpression(spread.expression) && ts.isIdentifier(spread.expression.expression) && spread.expression.expression.text === "DEMO_PROJECTS" ? spread.expression.name.text : null;
    const project = code ? DEMO_PROJECTS[code as keyof typeof DEMO_PROJECTS] : undefined;
    const manager = stringProperty(element, "manager");
    const team = stringArrayProperty(element, "team");
    if (!project || !manager || !team) throw new Error("access manifest: a demo project lost its DEMO_PROJECTS spread, manager or team");
    const users = [...new Set([...team, manager])].map((user) => personaIn(project.companyId, user));
    return { id: project.id, name: project.name, companyId: project.companyId, managerUserId: personaIn(project.companyId, manager), teamUserIds: users };
  });
}

/**
 * business.ts: the fixture tenant's two projects carry its owner and viewer;
 * Fixture Works' finished and archived projects carry its owner. Asserted
 * against the source so a change there is a failure here, not a silent drift.
 */
function fixtureProjects(): SeedProject[] {
  const text = readFileSync("prisma/seed/business.ts", "utf8");
  if (!text.includes("for (const memberId of [ownerB, viewerB])") || !text.includes("for (const projectId of [FIXTURE_PROJECTS.finished, FIXTURE_PROJECTS.archived])")) {
    throw new Error("access manifest: the fixture project teams in prisma/seed/business.ts changed shape; update the derivation");
  }
  const source = parseSource("prisma/seed/business.ts");
  const tenant = findArrayDeclaration(source, "projects")
    .flatMap((array) => array.elements)
    .filter(ts.isObjectLiteralExpression)
    .map((object) => ({ id: stringProperty(object, "id"), name: stringProperty(object, "name") }))
    .filter((project): project is { id: string; name: string } => Boolean(project.id && project.name));
  const tenantIds = [FIXTURE_PROJECTS.tenantOne, FIXTURE_PROJECTS.tenantTwo];
  if (tenantIds.some((id) => !tenant.some((project) => project.id === id))) throw new Error("access manifest: fixture tenant projects not found in prisma/seed/business.ts");
  const [ownerB, viewerB] = TENANT_USERS;
  return [
    ...tenant.filter((project) => tenantIds.includes(project.id as (typeof tenantIds)[number])).map((project) => ({ id: project.id, name: project.name, companyId: FIXTURE_TENANT, managerUserId: ownerB.id, teamUserIds: [ownerB.id, viewerB.id] })),
    { id: FIXTURE_PROJECTS.finished, name: "Finished fixture project", companyId: FIXTURE_WORKS, managerUserId: FIXTURE_OWNER.id, teamUserIds: [FIXTURE_OWNER.id] },
    { id: FIXTURE_PROJECTS.archived, name: "Archive Test Project", companyId: FIXTURE_WORKS, managerUserId: FIXTURE_OWNER.id, teamUserIds: [FIXTURE_OWNER.id] },
  ];
}

/* The five-company demo ----------------------------------------------------- */

function demoCompanies(): SeedCompany[] {
  return DEMO_COMPANY_CODES.map((code) => ({ id: DEMO_COMPANIES[code].id, name: DEMO_COMPANIES[code].name, status: "ACTIVE" as const, parentGroupId: DEMO_GROUP.id, disabledModules: [], departments: ALL_DEPARTMENTS }));
}

function demoAccounts(): SeedAccount[] {
  const curated = new Set(PRIMARY_DEMO_ACCOUNTS.map((account) => account.username));
  const platform: SeedAccount[] = PLATFORM_USERS.map((user) => ({
    username: user.username,
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tenant: "platform",
    parentGroupId: null,
    userStatus: "ACTIVE",
    platformRole: user.role,
    picker: curated.has(user.username) ? "curated" : null,
    logins: [],
    positions: [],
    grants: [],
  }));
  const people: SeedAccount[] = [...GROUP_USERS, ...COMPANY_USERS].map((user) => ({
    username: user.username,
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tenant: "demo",
    parentGroupId: DEMO_GROUP.id,
    userStatus: "ACTIVE",
    platformRole: null,
    picker: curated.has(user.username) ? "curated" : null,
    // Memberships are made company by company, Aurelia first (demo/organization.ts).
    logins: DEMO_COMPANY_CODES.map((code) => DEMO_COMPANIES[code].id)
      .filter((companyId) => isMemberOf(user.id, companyId))
      .map((companyId) => ({ companyId, membershipId: demoMemberId(user.id, companyId), status: "ACTIVE" as const, role: user.role, department: user.department, jobTitle: user.jobTitle, employing: null })),
    positions: POSITIONS.filter((position) => position.userId === user.id).map((position) => ({ department: position.department, role: position.role, level: position.level, companyId: position.companyId })),
    grants: [],
  }));
  return [...platform, ...people];
}

/* The test fixtures --------------------------------------------------------- */

function fixtureCompanies(): SeedCompany[] {
  return [
    { id: FIXTURE_TENANT, name: "Fixture Tenant GmbH", status: "ACTIVE", parentGroupId: FIXTURE_GROUP.id, disabledModules: [...FIXTURE_TENANT_DISABLED_MODULES], departments: ALL_DEPARTMENTS },
    { id: FIXTURE_WORKS, name: "Fixture Works", status: "ACTIVE", parentGroupId: FIXTURE_GROUP.id, disabledModules: [], departments: ALL_DEPARTMENTS },
    // A suspended company gets no department branches (fixtures/organization.ts).
    { id: COMPANY_SUSPENDED, name: "NESTO Suspended Company", status: "SUSPENDED", parentGroupId: FIXTURE_GROUP.id, disabledModules: [], departments: [] },
    { id: SOLO_COMPANY, name: "Solo Studio", status: "ACTIVE", parentGroupId: SOLO_GROUP.id, disabledModules: [], departments: ALL_DEPARTMENTS },
  ];
}

function fixtureAccounts(): SeedAccount[] {
  const account = (user: { id: string; username: string; firstName: string; lastName: string; email: string }, parentGroupId: string, userStatus: SeedAccount["userStatus"], logins: SeedLogin[]): SeedAccount => ({
    username: user.username,
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    tenant: "fixture",
    parentGroupId,
    userStatus,
    platformRole: null,
    picker: null,
    logins,
    positions: [],
    grants: [],
  });
  const login = (userId: string, companyId: string, role: RoleKey, department: GroupDepartmentKey | null, jobTitle: string | null, status: SeedLogin["status"] = "ACTIVE"): SeedLogin => ({
    companyId,
    membershipId: fixtureMemberOf(userId) ?? (userId === INVITED_USER.id ? "member_invited" : `member_${userId}`),
    status,
    role,
    department,
    jobTitle,
    employing: null,
  });
  return [
    ...TENANT_USERS.map((user) => account(user, FIXTURE_GROUP.id, "ACTIVE", [login(user.id, FIXTURE_TENANT, user.role, user.department, user.jobTitle)])),
    account(FIXTURE_OWNER, FIXTURE_GROUP.id, "ACTIVE", [login(FIXTURE_OWNER.id, FIXTURE_WORKS, FIXTURE_OWNER.role, FIXTURE_OWNER.department, FIXTURE_OWNER.jobTitle)]),
    ...NEGATIVE_USERS.map((user) => account(user, FIXTURE_GROUP.id, user.userStatus, [login(user.id, FIXTURE_WORKS, "VIEWER", "projects", "Test Fixture", user.membershipStatus)])),
    account(SUSPENDED_COMPANY_USER, FIXTURE_GROUP.id, "ACTIVE", [login(SUSPENDED_COMPANY_USER.id, COMPANY_SUSPENDED, "OWNER", null, "Owner")]),
    // prisma/seed/team.ts: an account with an INVITED Viewer membership at Fixture Works, nothing active.
    account(INVITED_USER, FIXTURE_GROUP.id, "ACTIVE", [login(INVITED_USER.id, FIXTURE_WORKS, "VIEWER", "projects", "Consultant", "INVITED")]),
    account(SOLO_OWNER, SOLO_GROUP.id, "ACTIVE", [login(SOLO_OWNER.id, SOLO_COMPANY, SOLO_OWNER.role, SOLO_OWNER.department, SOLO_OWNER.jobTitle)]),
  ];
}

/* -------------------------------------------------------------------------- */
/* Resolution through the product's own resolver                               */
/* -------------------------------------------------------------------------- */

const departmentName = (key: GroupDepartmentKey) => GROUP_DEPARTMENTS.find((department) => department.key === key)!.name;

function assignmentsOf(account: SeedAccount): ContextAssignment[] {
  return account.positions.map((position, index) => ({
    id: `manifest_${account.userId}_${index}`,
    groupDepartmentId: groupDepartmentId(account.parentGroupId!, position.department),
    groupDepartmentKey: position.department,
    groupDepartmentName: departmentName(position.department),
    companyId: position.companyId,
    companyDepartmentId: null,
    functionalRoleKey: position.role,
    positionLevel: position.level,
  }));
}

function enabledModulesOf(company: SeedCompany): ModuleKey[] {
  // resolveEnabledModules: the dashboard is the shell; everything else is the company's switch.
  return MODULE_KEYS.filter((key) => key === "dashboard" || !company.disabledModules.includes(key));
}

/** One membership's context, assembled exactly as `resolveContextForSession` assembles it. */
function contextFor(account: SeedAccount, login: SeedLogin, company: SeedCompany, companiesInGroup: number, groupName: string): UserContext {
  const user = { id: account.userId, firstName: account.firstName, lastName: account.lastName, email: account.email, phone: null, avatarUrl: null } as unknown as User;
  const membership = {
    id: login.membershipId,
    jobTitle: login.jobTitle,
    department: login.department ? { id: `${company.id}:${login.department}`, key: login.department, name: departmentName(login.department) } : null,
    company: {
      id: company.id,
      slug: company.id,
      name: company.name,
      legalName: null,
      logoUrl: null,
      industry: null,
      country: null,
      address: null,
      email: null,
      phone: null,
      website: null,
      parentGroupId: company.parentGroupId,
      parentGroup: { id: company.parentGroupId, slug: company.parentGroupId, name: groupName, status: "ACTIVE", isDemo: false, logoUrl: null, _count: { companies: companiesInGroup } },
    },
  } as unknown as Parameters<typeof assembleContext>[0]["membership"];
  return assembleContext({ user, membership, sessionId: "access-manifest", role: login.role, enabledModules: enabledModulesOf(company), assignments: assignmentsOf(account), grants: account.grants });
}

function profileKey(role: RoleKey, position: PositionLevel, company: SeedCompany, grants: readonly ContextGrant[]): string {
  const off = company.disabledModules.length > 0 ? ` -off(${[...company.disabledModules].sort().join(",")})` : "";
  const granted = grants.length > 0 ? ` +grants(${grants.map((grant) => `${grant.moduleKey}:${grant.accessLevel}@${grant.scopeType}`).sort().join(",")})` : "";
  return `${role}@${position}${off}${granted}`;
}

function sortedObject<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
}

/* -------------------------------------------------------------------------- */
/* The manifest                                                                */
/* -------------------------------------------------------------------------- */

export function deriveAccessManifest(): AccessManifest {
  const tenants = [
    { parentGroupId: DEMO_GROUP.id, name: DEMO_GROUP.name, companies: demoCompanies() },
    { parentGroupId: FIXTURE_GROUP.id, name: FIXTURE_GROUP.name, companies: fixtureCompanies().filter((company) => company.parentGroupId === FIXTURE_GROUP.id) },
    { parentGroupId: SOLO_GROUP.id, name: SOLO_GROUP.name, companies: fixtureCompanies().filter((company) => company.parentGroupId === SOLO_GROUP.id) },
  ];
  const companies = new Map(tenants.flatMap((tenant) => tenant.companies.map((company) => [company.id, company] as const)));
  const groupOf = new Map<string, (typeof tenants)[number]>(tenants.map((tenant) => [tenant.parentGroupId, tenant]));

  const projects = [...demoProjects(), ...fixtureProjects()];
  const accounts = [...demoAccounts(), ...fixtureAccounts()];

  const usernames = new Set<string>();
  for (const account of accounts) {
    if (usernames.has(account.username)) throw new Error(`access manifest: username ${account.username} is seeded twice`);
    usernames.add(account.username);
  }

  const profiles = new Map<string, Record<ModuleKey, ProfileCell>>();
  const curatedBy = new Map(PRIMARY_DEMO_ACCOUNTS.map((account) => [account.username, account]));

  const personas: ManifestPersona[] = accounts.map((account) => {
    const group = account.parentGroupId ? groupOf.get(account.parentGroupId) : undefined;
    const contexts: UserContext[] = [];
    const memberships = account.logins.map((login): ManifestMembership => {
      const company = companies.get(login.companyId);
      if (!company || !group) throw new Error(`access manifest: ${account.username} has a login in unknown company ${login.companyId}`);
      const usable = account.userStatus === "ACTIVE" && login.status === "ACTIVE" && company.status === "ACTIVE";
      const context = contextFor(account, login, company, group.companies.length, group.name);
      const onProjects = projects
        .filter((project) => project.companyId === company.id && project.teamUserIds.includes(account.userId))
        .map((project) => ({ projectId: project.id, name: project.name, manager: project.managerUserId === account.userId }))
        .sort((a, b) => a.projectId.localeCompare(b.projectId));

      let profile: string | null = null;
      if (usable) {
        contexts.push(context);
        profile = profileKey(login.role, context.position, company, account.grants);
        const cells = Object.fromEntries(
          MODULE_KEYS.map((moduleKey) => {
            const access = context.moduleAccess[moduleKey];
            return [moduleKey, { accessLevel: access.accessLevel, scope: access.scope, enabled: access.enabled, permissions: [...access.permissions].sort() }];
          }),
        ) as Record<ModuleKey, ProfileCell>;
        const known = profiles.get(profile);
        if (known && JSON.stringify(known) !== JSON.stringify(cells)) throw new Error(`access manifest: profile ${profile} resolves two ways`);
        profiles.set(profile, cells);
      }

      return {
        companyId: company.id,
        company: company.name,
        companyStatus: company.status,
        membershipId: login.membershipId,
        membershipStatus: login.status,
        role: login.role,
        position: context.position,
        department: login.department,
        jobTitle: login.jobTitle,
        employing: login.employing,
        projects: onProjects,
        grants: account.grants,
        usable,
        profile,
      };
    });

    const first = memberships.find((membership) => membership.usable);
    const standalone = group ? group.companies.length === 1 : false;
    const standing = hasGroupStanding(contexts);
    const mayEnter = mayEnterGroupWorkspace(contexts);
    // resolveContextForSession: a fresh session opens the Group workspace only for group-level standing.
    const signIn: ManifestPersona["signIn"] = account.platformRole
      ? { outcome: "PLATFORM", companyId: null }
      : !first
        ? { outcome: "REFUSED", companyId: null }
        : { outcome: !standalone && mayEnter && standing ? "GROUP" : "COMPANY", companyId: first.companyId };

    const curated = curatedBy.get(account.username);
    return {
      username: account.username,
      userId: account.userId,
      name: `${account.firstName} ${account.lastName}`,
      tenant: account.tenant,
      parentGroupId: account.parentGroupId,
      picker: account.picker,
      curated: curated ? { role: curated.role, position: curated.position, assignment: curated.assignment } : null,
      userStatus: account.userStatus,
      platformRole: account.platformRole,
      memberships,
      signIn,
      groupWorkspace: { standing, mayEnter },
    };
  });

  const roleMatrix = Object.fromEntries(
    ROLE_KEYS.map((role) => [
      role,
      Object.fromEntries(
        POSITION_LEVELS.map((position) => [
          position,
          Object.fromEntries(
            MODULE_KEYS.map((moduleKey) => {
              const cell = defaultAccessFor(role, moduleKey, position);
              return [moduleKey, `${cell.accessLevel}/${cell.scope}`];
            }),
          ),
        ]),
      ),
    ]),
  ) as AccessManifest["roleMatrix"];

  return {
    $comment: "Generated by `pnpm security:access-manifest` (scripts/security/access-manifest.ts) from the role matrix and the seed. Do not edit by hand; CI fails when it is stale (AUD-06 §2, RP-01, RP-24).",
    sources: SOURCES,
    accessLevels: ["NONE", "VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"],
    dataScopes: DATA_SCOPES,
    modules: MODULE_KEYS,
    roles: ROLE_KEYS.map((key) => ({ key, label: roles[key].label, department: roles[key].department, readOnly: Boolean(roles[key].readOnly), platformOnly: Boolean(roles[key].platformOnly) })),
    roleMatrix,
    tenants: tenants.map((tenant) => ({
      parentGroupId: tenant.parentGroupId,
      name: tenant.name,
      standalone: tenant.companies.length === 1,
      companies: tenant.companies.map((company) => ({ id: company.id, name: company.name, status: company.status, disabledModules: [...company.disabledModules].sort() })),
    })),
    personas,
    profiles: sortedObject([...profiles.entries()]),
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering: stable, and readable in a diff                                   */
/* -------------------------------------------------------------------------- */

const INLINE_LIMIT = 160;

function render(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // A list of names is one line however long: it is read as a set.
    if (value.every((item) => item === null || typeof item !== "object")) return JSON.stringify(value);
    return `[\n${value.map((item) => `${inner}${render(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const flat = JSON.stringify(value);
  if (flat.length <= INLINE_LIMIT && entries.every(([, item]) => item === null || typeof item !== "object" || (Array.isArray(item) && item.every((element) => typeof element !== "object")))) {
    return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(", ")} }`;
  }
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, inner)}`).join(",\n")}\n${indent}}`;
}

export function renderAccessManifest(manifest: AccessManifest): string {
  return `${render(manifest, "")}\n`;
}
