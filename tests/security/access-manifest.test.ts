import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accessAtLeast, type AccessLevel } from "@/config/access";
import { PRIMARY_DEMO_ACCOUNTS } from "@/config/demo-accounts";
import { MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { isMutatingPermission } from "@/config/permissions";
import { defaultAccessFor, grantPermissions } from "@/config/role-defaults";
import { POSITION_LEVELS, ROLE_KEYS, roles } from "@/config/roles";
import { loadGroupMemberContexts } from "@/lib/context/build-context";
import {
  ACCESS_MANIFEST_PATH,
  deriveAccessManifest,
  renderAccessManifest,
  type AccessManifest,
  type ManifestMembership,
  type ManifestPersona,
} from "../../scripts/security/access-manifest.derive";
import { prisma } from "../helpers";

/**
 * The expected-access manifest (AUD-06 §2 first deliverable, §5, RP-01, RP-24).
 *
 * docs/security/access-manifest.json is derived from the role matrix and the
 * seed, through the product's own resolver. This proves four things about it:
 *
 *   it is current            the committed file is exactly a fresh derivation
 *   it is complete           every curated persona, every role × position ×
 *                            module cell, every profile's every module
 *   it grants nothing extra  no membership holds a permission, level or scope
 *                            its role, position and grants do not give it —
 *                            checked against config/role-defaults.ts directly
 *   it is the truth          the seeded database, read by the real resolver
 *                            (`loadGroupMemberContexts`), answers the same
 *                            memberships, positions, departments, projects and
 *                            module access, persona by persona (RP-01)
 */

const committed = JSON.parse(readFileSync(ACCESS_MANIFEST_PATH, "utf8")) as AccessManifest;
let manifest: AccessManifest;

const persona = (username: string): ManifestPersona => {
  const found = manifest.personas.find((candidate) => candidate.username === username);
  if (!found) throw new Error(`manifest has no persona ${username}`);
  return found;
};
const usable = (entry: ManifestPersona) => entry.memberships.filter((membership) => membership.usable);

/** Who heads a group function, as the demo defines it — nobody else does (E-06 §51, §52). */
const EXPECTED_GROUP_HEADS = [
  "owner", "group-it", "group-hr", "group-architecture", "group-engineering", "group-finance", "group-legal",
  "group-sales", "group-procurement", "group-inventory", "group-qaqc", "group-hse",
].sort();

beforeAll(() => {
  manifest = deriveAccessManifest();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the committed manifest (RP-24)", () => {
  it("is exactly a fresh derivation — `pnpm security:access-manifest` regenerates it", () => {
    expect(readFileSync(ACCESS_MANIFEST_PATH, "utf8")).toBe(renderAccessManifest(manifest));
    expect(committed.personas.length).toBe(manifest.personas.length);
  });

  it("names every role, position and module of the matrix", () => {
    expect(manifest.roles.map((role) => role.key)).toEqual([...ROLE_KEYS]);
    expect(manifest.modules).toEqual(MODULE_KEYS);
    for (const role of ROLE_KEYS) {
      for (const position of POSITION_LEVELS) {
        expect(Object.keys(manifest.roleMatrix[role][position]).sort(), `${role}@${position}`).toEqual([...MODULE_KEYS].sort());
        for (const moduleKey of MODULE_KEYS) {
          const cell = defaultAccessFor(role, moduleKey, position);
          expect(manifest.roleMatrix[role][position][moduleKey]).toBe(`${cell.accessLevel}/${cell.scope}`);
        }
      }
    }
    for (const [key, profile] of Object.entries(manifest.profiles)) {
      expect(Object.keys(profile).sort(), key).toEqual([...MODULE_KEYS].sort());
    }
  });

  it("gives every usable membership a profile and every profile a user", () => {
    const used = new Set<string>();
    for (const entry of manifest.personas) {
      for (const membership of entry.memberships) {
        if (membership.usable) {
          expect(membership.profile, `${entry.username} in ${membership.companyId}`).toBeTruthy();
          expect(manifest.profiles[membership.profile!], membership.profile!).toBeDefined();
          used.add(membership.profile!);
        } else {
          expect(membership.profile).toBeNull();
        }
      }
    }
    expect([...used].sort()).toEqual(Object.keys(manifest.profiles).sort());
  });
});

describe("curated personas (RP-01)", () => {
  it("every account on the curated sign-in roster is in the manifest with the role and position config/demo-accounts.ts names", () => {
    expect(PRIMARY_DEMO_ACCOUNTS.length).toBeGreaterThan(0);
    for (const account of PRIMARY_DEMO_ACCOUNTS) {
      const entry = persona(account.username);
      expect(entry.picker, account.username).toBe("curated");
      expect(entry.userStatus).toBe("ACTIVE");
      if (roles[account.role].platformOnly) {
        // Held through PlatformAccess, never a company membership (E-06 §6.1, §116).
        expect(entry.platformRole).toBe(account.role);
        expect(entry.memberships).toEqual([]);
        expect(entry.signIn.outcome).toBe("PLATFORM");
        continue;
      }
      const home = usable(entry)[0];
      expect(home, `${account.username} has a usable membership`).toBeDefined();
      expect(home.role, account.username).toBe(account.role);
      expect(home.position, account.username).toBe(account.position);
      expect(entry.signIn.companyId).toBe(home.companyId);
    }
  });

  it("the representative personas the PRD lists are all present (§5)", () => {
    // Group Owner, Group IT, a department head, a company CEO, a specialist, a
    // project manager, a project member, a cross-company member, a viewer, the Platform Admin.
    expect(persona("owner").memberships.every((membership) => membership.role === "OWNER")).toBe(true);
    expect(persona("group-it").memberships.every((membership) => membership.role === "GROUP_IT")).toBe(true);
    expect(persona("group-finance").memberships.every((membership) => membership.position === "GROUP_HEAD")).toBe(true);
    expect(usable(persona("ceo-a")).map((membership) => [membership.companyId, membership.role])).toEqual([["company_demo_a", "CEO"]]);
    expect(usable(persona("finance-c")).map((membership) => [membership.companyId, membership.role, membership.position])).toEqual([["company_demo_c", "FINANCE", "MEMBER"]]);
    expect(usable(persona("pm-a"))[0].projects).toEqual([{ projectId: "project_a", name: "Riverside Residences", manager: true }]);
    expect(usable(persona("viewer-a"))[0].projects.map((project) => project.projectId)).toEqual(["project_a"]);
    expect(usable(persona("multi-architect")).map((membership) => membership.companyId)).toEqual(["company_demo_a", "company_demo_d"]);
    expect(persona("multi-architect").groupWorkspace).toEqual({ standing: false, mayEnter: true });
    expect(persona("viewer-a").groupWorkspace).toEqual({ standing: false, mayEnter: false });
    expect(persona("platform-admin").platformRole).toBe("PLATFORM_ADMIN");
  });

  it("only the group's heads hold a GROUP_HEAD position, in every company they work in", () => {
    const heads = manifest.personas.filter((entry) => entry.memberships.some((membership) => membership.position === "GROUP_HEAD")).map((entry) => entry.username).sort();
    expect(heads).toEqual(EXPECTED_GROUP_HEADS);
    for (const username of EXPECTED_GROUP_HEADS) {
      expect(persona(username).memberships.every((membership) => membership.position === "GROUP_HEAD"), username).toBe(true);
    }
  });
});

describe("no persona holds more than its role, position and grants derive (manifest ⊆ derivation)", () => {
  const LEVELS: AccessLevel[] = ["NONE", "VIEW", "CONTRIBUTE", "APPROVE", "MANAGE"];
  const SCOPE_RANK = ["SELF", "ASSIGNED", "PROJECT", "DEPARTMENT", "COMPANY", "GROUP", "SYSTEM"];

  it("every module of every usable membership stays within config/role-defaults.ts", () => {
    let checked = 0;
    for (const entry of manifest.personas) {
      for (const membership of usable(entry)) {
        const company = manifest.tenants.flatMap((tenant) => tenant.companies).find((candidate) => candidate.id === membership.companyId)!;
        const profile = manifest.profiles[membership.profile!];
        const readOnly = Boolean(roles[membership.role].readOnly);
        for (const moduleKey of MODULE_KEYS) {
          const cell = profile[moduleKey];
          const where = `${entry.username} ${membership.companyId} ${moduleKey}`;
          const disabled = moduleKey !== "dashboard" && company.disabledModules.includes(moduleKey);
          if (disabled) {
            // A switched-off module is not held at all (PRD #7 §59).
            expect(cell, where).toMatchObject({ enabled: false, accessLevel: "NONE", permissions: [] });
            continue;
          }
          const preset = defaultAccessFor(membership.role, moduleKey, membership.position);
          const grants = membership.grants.filter((grant) => grant.moduleKey === moduleKey && grant.accessLevel !== "NONE");
          const allowed = new Set<string>([...preset.permissions, ...grants.flatMap((grant) => grantPermissions(moduleKey as ModuleKey, grant.accessLevel))]);
          const extra = cell.permissions.filter((permission) => !allowed.has(permission));
          expect(extra, where).toEqual([]);
          const ceiling = grants.reduce<AccessLevel>((level, grant) => (accessAtLeast(level, grant.accessLevel) ? level : grant.accessLevel), preset.accessLevel);
          expect(LEVELS.indexOf(cell.accessLevel), where).toBeLessThanOrEqual(LEVELS.indexOf(ceiling));
          const widest = grants.some((grant) => grant.scopeType === "GROUP") ? "GROUP" : grants.length > 0 ? "COMPANY" : preset.scope;
          expect(SCOPE_RANK.indexOf(cell.scope), where).toBeLessThanOrEqual(Math.max(SCOPE_RANK.indexOf(preset.scope), SCOPE_RANK.indexOf(widest)));
          // A read-only role never holds a write, whatever it was handed (PRD #5 §27).
          if (readOnly) expect(cell.permissions.filter((permission) => isMutatingPermission(permission)), where).toEqual([]);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("a viewer can read but not write — and a project manager beside them can (positive control)", () => {
    const viewer = manifest.profiles[usable(persona("viewer-a"))[0].profile!];
    const manager = manifest.profiles[usable(persona("pm-a"))[0].profile!];
    expect(viewer.tasks.permissions).toContain("task.view");
    expect(viewer.tasks.permissions).not.toContain("task.create");
    expect(manager.tasks.permissions).toContain("task.create");
  });

  it("a disabled module is off for the fixture tenant's owner and on for the demo owner (positive control)", () => {
    const tenant = manifest.profiles[usable(persona("tenant-owner"))[0].profile!];
    const demo = manifest.profiles[usable(persona("owner"))[0].profile!];
    expect(tenant.finance).toMatchObject({ enabled: false, accessLevel: "NONE", permissions: [] });
    expect(demo.finance.enabled).toBe(true);
    expect(demo.finance.permissions.length).toBeGreaterThan(0);
  });
});

describe("the seeded database, read by the real resolver, agrees (RP-01)", () => {
  const SEEDED_GROUPS = ["group_demo_nesto", "group_fixture", "group_fixture_solo"];

  it("every persona's user, status and platform access are seeded as the manifest says", async () => {
    const users = await prisma.user.findMany({
      where: { username: { in: manifest.personas.map((entry) => entry.username) } },
      select: { id: true, username: true, firstName: true, lastName: true, status: true, platformAccess: { select: { roleKey: true, status: true } } },
    });
    const byUsername = new Map(users.map((user) => [user.username, user]));
    for (const entry of manifest.personas) {
      const user = byUsername.get(entry.username);
      expect(user, `${entry.username} is seeded`).toBeDefined();
      expect({ id: user!.id, name: `${user!.firstName} ${user!.lastName}`, status: user!.status }, entry.username).toEqual({ id: entry.userId, name: entry.name, status: entry.userStatus });
      expect(user!.platformAccess?.status === "ACTIVE" ? user!.platformAccess.roleKey : null, entry.username).toBe(entry.platformRole);
    }
  });

  it("every membership, its status, role, department and project team match the database — and the personas have no others", async () => {
    const userIds = manifest.personas.map((entry) => entry.userId);
    const rows = await prisma.companyMember.findMany({
      where: { userId: { in: userIds } },
      select: {
        id: true,
        userId: true,
        companyId: true,
        status: true,
        role: { select: { key: true } },
        department: { select: { groupDepartment: { select: { key: true } } } },
        company: { select: { status: true } },
        projectMemberships: { where: { status: "ACTIVE" }, select: { projectId: true } },
      },
    });
    const expected = manifest.personas.flatMap((entry) => entry.memberships.map((membership) => ({ entry, membership })));
    expect(rows.length).toBe(expected.length);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const { entry, membership } of expected) {
      const row = byId.get(membership.membershipId);
      const where = `${entry.username} ${membership.companyId}`;
      expect(row, where).toBeDefined();
      expect(
        { userId: row!.userId, companyId: row!.companyId, status: row!.status, role: row!.role.key, department: row!.department?.groupDepartment?.key ?? null, companyStatus: row!.company.status },
        where,
      ).toEqual({ userId: entry.userId, companyId: membership.companyId, status: membership.membershipStatus, role: membership.role, department: membership.department, companyStatus: membership.companyStatus });
      expect(row!.projectMemberships.map((project) => project.projectId).sort(), where).toEqual(membership.projects.map((project) => project.projectId));
    }
  });

  it("the project managers the manifest names manage those projects in the database", async () => {
    const managed = manifest.personas.flatMap((entry) => entry.memberships.flatMap((membership) => membership.projects.filter((project) => project.manager).map((project) => ({ project: project.projectId, member: membership.membershipId }))));
    const projects = await prisma.project.findMany({ where: { id: { in: managed.map((row) => row.project) } }, select: { id: true, projectManagerMemberId: true } });
    expect(projects.map((project) => ({ project: project.id, member: project.projectManagerMemberId })).sort((a, b) => a.project.localeCompare(b.project))).toEqual(
      [...managed].sort((a, b) => a.project.localeCompare(b.project)),
    );
  });

  it("the only live GROUP_HEAD and COMPANY_MANAGER positions in the seeded groups are the manifest's", async () => {
    const positions = await prisma.departmentAssignment.findMany({
      where: { parentGroupId: { in: SEEDED_GROUPS }, status: "ACTIVE", positionLevel: { in: ["GROUP_HEAD", "COMPANY_MANAGER"] } },
      select: { userId: true, positionLevel: true, companyId: true },
    });
    const heads = [...new Set(positions.filter((position) => position.positionLevel === "GROUP_HEAD").map((position) => position.userId))].sort();
    expect(heads).toEqual(manifest.personas.filter((entry) => EXPECTED_GROUP_HEADS.includes(entry.username)).map((entry) => entry.userId).sort());
    // A company manager's position shows wherever the resolver ranks it first (a group head outranks it).
    for (const position of positions.filter((row) => row.positionLevel === "COMPANY_MANAGER")) {
      const entry = manifest.personas.find((candidate) => candidate.userId === position.userId)!;
      const membership = entry.memberships.find((candidate) => candidate.companyId === position.companyId)!;
      expect(["COMPANY_MANAGER", "GROUP_HEAD"], `${entry.username} ${position.companyId}`).toContain(membership.position);
    }
  });

  it("the real resolver computes, persona by persona, the module access the manifest records", async () => {
    let compared = 0;
    for (const entry of manifest.personas) {
      if (!entry.parentGroupId) continue;
      const contexts = await loadGroupMemberContexts({ userId: entry.userId, parentGroupId: entry.parentGroupId, sessionId: "access-manifest-test" });
      const expected: ManifestMembership[] = usable(entry);
      expect(contexts.map((context) => context.companyId).sort(), entry.username).toEqual(expected.map((membership) => membership.companyId).sort());
      for (const context of contexts) {
        const membership = expected.find((candidate) => candidate.companyId === context.companyId)!;
        const where = `${entry.username} ${context.companyId}`;
        expect({ role: context.role, position: context.position, department: context.department?.key ?? null, membershipId: context.membershipId }, where).toEqual({
          role: membership.role,
          position: membership.position,
          department: membership.department,
          membershipId: membership.membershipId,
        });
        const profile = manifest.profiles[membership.profile!];
        for (const moduleKey of MODULE_KEYS) {
          const access = context.moduleAccess[moduleKey];
          expect({ accessLevel: access.accessLevel, scope: access.scope, enabled: access.enabled, permissions: [...access.permissions].sort() }, `${where} ${moduleKey}`).toEqual(profile[moduleKey]);
        }
        compared += 1;
      }
    }
    expect(compared).toBe(manifest.personas.reduce((sum, entry) => sum + usable(entry).length, 0));
  });
});
