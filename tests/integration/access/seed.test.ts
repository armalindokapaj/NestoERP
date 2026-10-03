import { afterAll, describe, expect, it } from "vitest";

import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { MODULE_KEYS } from "@/config/modules";
import { PERMISSIONS } from "@/config/permissions";
import { roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { COMPANY, PROJECT, prisma } from "../../helpers";

/**
 * Seed tests (PRD #9 §117, §167).
 *
 * The database must agree with config/role-defaults.ts, because the resolver
 * reads the configuration while SQL, reporting and future admin tooling read
 * the rows. A drift between them is exactly the kind of fault nobody notices
 * until it matters (PRD #9 §20).
 */
afterAll(async () => {
  await prisma.$disconnect();
});

describe("seeded configuration", () => {
  it("creates all 16 roles", async () => {
    const rows = await prisma.role.findMany({ select: { key: true } });
    expect(rows.map((row) => row.key).sort()).toEqual([...ROLE_KEYS].sort());
  });

  it("creates every module", async () => {
    const rows = await prisma.module.findMany({ select: { key: true } });
    expect(rows).toHaveLength(MODULE_KEYS.length);
  });

  it("creates the whole permission registry", async () => {
    const rows = await prisma.permission.findMany({ select: { key: true } });
    expect(rows.map((row) => row.key).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("stores a role × module access row for every combination", async () => {
    const count = await prisma.roleModuleAccess.count();
    expect(count).toBe(ROLE_KEYS.length * MODULE_KEYS.length);
  });

  it("stores exactly the permissions the matrix grants", async () => {
    for (const role of ROLE_KEYS) {
      const rows = await prisma.rolePermission.findMany({
        where: { role: { key: role } },
        select: { permission: { select: { key: true } } },
      });

      const stored = rows.map((row) => row.permission.key).sort();
      const expected = [
        ...new Set(MODULE_KEYS.flatMap((key) => roleModuleAccess[role][key].permissions)),
      ].sort();

      expect(stored, role).toEqual(expected);
    }
  });

  it("stores the same access level and scope as the matrix", async () => {
    const rows = await prisma.roleModuleAccess.findMany({
      select: {
        accessLevel: true,
        scope: true,
        role: { select: { key: true } },
        module: { select: { key: true } },
      },
    });

    for (const row of rows) {
      const expected =
        roleModuleAccess[row.role.key as (typeof ROLE_KEYS)[number]][
          row.module.key as (typeof MODULE_KEYS)[number]
        ];
      expect(row.accessLevel, `${row.role.key}/${row.module.key}`).toBe(expected.accessLevel);
      expect(row.scope, `${row.role.key}/${row.module.key}`).toBe(expected.scope);
    }
  });
});

describe("seeded demo group (E-06 §42-§47, §131-§134)", () => {
  const DEMO_GROUP = "group_demo_nesto";
  const FIXTURE_GROUP = "group_fixture";
  const DEMO_COMPANIES = [COMPANY.a, COMPANY.b, COMPANY.c, COMPANY.d, COMPANY.e];

  it("creates one visible parent group of five active companies (E-06 §131, §132)", async () => {
    expect(await prisma.parentGroup.findMany({ where: { isTestFixture: false }, select: { id: true, status: true, isDemo: true }, orderBy: { id: "asc" } })).toEqual([
      { id: DEMO_GROUP, status: "ACTIVE", isDemo: false },
    ]);
    const companies = await prisma.company.findMany({ where: { parentGroupId: DEMO_GROUP }, select: { id: true, status: true }, orderBy: { id: "asc" } });
    expect(companies).toEqual(DEMO_COMPANIES.map((id) => ({ id, status: "ACTIVE" })));
  });

  it("keeps the fixture companies in a test fixture group of their own (E-06 §45, §150)", async () => {
    const fixtures = await prisma.company.findMany({ where: { id: { in: [COMPANY.tenant, COMPANY.works, COMPANY.suspended] } }, select: { id: true, status: true, parentGroup: { select: { id: true, isTestFixture: true } } }, orderBy: { id: "asc" } });
    expect(fixtures.map((company) => company.parentGroup)).toEqual(Array(3).fill({ id: FIXTURE_GROUP, isTestFixture: true }));
    expect(fixtures.find((company) => company.id === COMPANY.suspended)?.status).toBe("SUSPENDED");
    expect(await prisma.company.count({ where: { status: "SUSPENDED", parentGroupId: DEMO_GROUP } })).toBe(0);
  });

  it("gives each demo company exactly one visible project (E-06 §44, §131, §133)", async () => {
    for (const [code, companyId] of [["a", COMPANY.a], ["b", COMPANY.b], ["c", COMPANY.c], ["d", COMPANY.d], ["e", COMPANY.e]] as const) {
      const projects = await prisma.project.findMany({ where: { companyId, archivedAt: null }, select: { id: true, code: true } });
      expect(projects, companyId).toEqual([{ id: PROJECT[code], code: `${code.toUpperCase()}-PRJ-001` }]);
    }
    expect(await prisma.project.count({ where: { company: { parentGroupId: DEMO_GROUP }, archivedAt: null } })).toBe(5);
  });

  it("creates every group department and links each company's branch to it (E-06 §47, §132)", async () => {
    const departments = await prisma.groupDepartment.findMany({ where: { parentGroupId: DEMO_GROUP }, select: { key: true } });
    expect(departments.map((department) => department.key).sort()).toEqual(GROUP_DEPARTMENTS.map((department) => department.key).sort());

    for (const companyId of DEMO_COMPANIES) {
      const branches = await prisma.department.findMany({ where: { companyId }, select: { groupDepartment: { select: { key: true, parentGroupId: true } } } });
      expect(branches, companyId).toHaveLength(GROUP_DEPARTMENTS.length);
      for (const branch of branches) expect(branch.groupDepartment?.parentGroupId, companyId).toBe(DEMO_GROUP);
    }
  });

  it("gives the group an Owner, Group IT and department heads (E-06 §132, §134)", async () => {
    for (const userId of ["user_owner", "user_it"]) {
      const member = await prisma.parentGroupMember.findUnique({ where: { parentGroupId_userId: { parentGroupId: DEMO_GROUP, userId } }, select: { status: true } });
      expect(member?.status, userId).toBe("ACTIVE");
      expect(await prisma.companyMember.count({ where: { userId, companyId: { in: DEMO_COMPANIES }, status: "ACTIVE" } }), userId).toBe(5);
    }
    const heads = await prisma.departmentAssignment.findMany({
      where: { parentGroupId: DEMO_GROUP, positionLevel: "GROUP_HEAD", status: "ACTIVE" },
      select: { companyId: true, groupDepartment: { select: { key: true } } },
    });
    expect(heads.every((head) => head.companyId === null)).toBe(true);
    expect(heads.map((head) => head.groupDepartment.key).sort()).toEqual(GROUP_DEPARTMENTS.filter((department) => department.key !== "projects").map((department) => department.key).sort());
  });

  it("keeps the Platform Admin outside every company (E-06 §19, §134)", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "platform-admin@nesto.test" },
      select: { platformAccess: { select: { status: true } }, _count: { select: { memberships: true, parentGroupMemberships: true } } },
    });
    expect(admin.platformAccess?.status).toBe("ACTIVE");
    expect(admin._count).toEqual({ memberships: 0, parentGroupMemberships: 0 });
  });

  it("stacks a group head and a company manager position on one account (E-06 §51, §134)", async () => {
    const positions = await prisma.departmentAssignment.findMany({
      where: { user: { email: "finance@nesto.test" }, status: "ACTIVE", positionLevel: { in: ["GROUP_HEAD", "COMPANY_MANAGER"] } },
      select: { positionLevel: true, companyId: true, companyDepartmentId: true, groupDepartment: { select: { key: true } } },
    });
    expect(positions).toHaveLength(2);
    expect(positions).toEqual(expect.arrayContaining([
      { positionLevel: "COMPANY_MANAGER", companyId: COMPANY.c, companyDepartmentId: expect.any(String), groupDepartment: { key: "finance" } },
      { positionLevel: "GROUP_HEAD", companyId: null, companyDepartmentId: null, groupDepartment: { key: "finance" } },
    ]));
  });

  it("runs each project with its own company's project manager, on the team (E-06 §50, §134)", async () => {
    for (const code of ["a", "b", "c", "d", "e"] as const) {
      const project = await prisma.project.findUniqueOrThrow({
        where: { id: PROJECT[code] },
        select: { companyId: true, projectManagerMemberId: true, projectManager: { select: { companyId: true, role: { select: { key: true } } } }, members: { where: { status: "ACTIVE" }, select: { companyMemberId: true } } },
      });
      expect(project.projectManager, code).toEqual({ companyId: project.companyId, role: { key: "PROJECT_MANAGER" } });
      expect(project.members.map((member) => member.companyMemberId), code).toContain(project.projectManagerMemberId);
    }
  });

  it("puts one person behind every demo account and its employment (E-06 §26, §135)", async () => {
    const accounts = await prisma.user.findMany({
      where: { memberships: { some: { companyId: { in: DEMO_COMPANIES } } } },
      select: { email: true, personProfile: { select: { parentGroupId: true } } },
    });
    expect(accounts.filter((account) => account.personProfile?.parentGroupId !== DEMO_GROUP).map((account) => account.email)).toEqual([]);

    const employments = await prisma.employeeProfile.findMany({
      where: { companyId: { in: DEMO_COMPANIES }, companyMemberId: { not: null } },
      select: { id: true, personProfileId: true, companyMember: { select: { user: { select: { personProfileId: true } } } } },
    });
    expect(employments.length).toBeGreaterThanOrEqual(16);
    expect(employments.filter((employment) => employment.companyMember?.user.personProfileId !== employment.personProfileId).map((employment) => employment.id)).toEqual([]);
  });

  it("walks recruitment from a candidate with no login to a login with the same person (E-06 §56, §57, §135)", async () => {
    const interviewing = await prisma.candidateProfile.findMany({ where: { parentGroupId: DEMO_GROUP, status: "INTERVIEWING" }, select: { person: { select: { firstName: true, lastName: true, user: { select: { id: true } } } } } });
    expect(interviewing.some((candidate) => candidate.person.user === null)).toBe(true);

    const selected = await prisma.candidateProfile.findFirstOrThrow({
      where: { parentGroupId: DEMO_GROUP, status: "SELECTED", person: { firstName: "Adrian", lastName: "Kola" } },
      select: { personProfileId: true, targetCompanyId: true, person: { select: { user: { select: { id: true } } } } },
    });
    expect(selected.person.user).toBeNull();
    expect(selected.targetCompanyId).toBe(COMPANY.c);
    const approved = await prisma.userProvisioningRequest.findFirstOrThrow({
      where: { personProfileId: selected.personProfileId, status: "APPROVED" },
      select: { companyId: true, functionalRoleKey: true, provisionedUserId: true, employeeProfile: { select: { companyMemberId: true, personProfileId: true } } },
    });
    expect(approved).toMatchObject({ companyId: COMPANY.c, functionalRoleKey: "FINANCE", provisionedUserId: null });
    expect(approved.employeeProfile).toEqual({ companyMemberId: null, personProfileId: selected.personProfileId });

    const provisioned = await prisma.userProvisioningRequest.findMany({
      where: { parentGroupId: DEMO_GROUP, status: "PROVISIONED" },
      select: { personProfileId: true, provisionedUser: { select: { personProfileId: true } }, employeeProfile: { select: { personProfileId: true, companyMember: { select: { user: { select: { personProfileId: true } } } } } } },
    });
    expect(provisioned.length).toBeGreaterThanOrEqual(1);
    for (const request of provisioned) {
      expect(request.provisionedUser?.personProfileId).toBe(request.personProfileId);
      expect(request.employeeProfile?.companyMember?.user.personProfileId).toBe(request.personProfileId);
    }
  });

  it("creates the required demo volumes (PRD #9 §235)", async () => {
    const companyId = { in: DEMO_COMPANIES };

    expect(await prisma.client.count({ where: { companyId } })).toBeGreaterThanOrEqual(12);
    expect(await prisma.contact.count({ where: { companyId } })).toBeGreaterThanOrEqual(18);
    expect(await prisma.task.count({ where: { companyId } })).toBeGreaterThanOrEqual(36);
    expect(await prisma.document.count({ where: { companyId } })).toBeGreaterThanOrEqual(24);
    expect(await prisma.activity.count({ where: { companyId } })).toBeGreaterThanOrEqual(40);
    for (const id of DEMO_COMPANIES) {
      expect(await prisma.client.count({ where: { companyId: id } }), id).toBeGreaterThan(0);
      expect(await prisma.task.count({ where: { companyId: id } }), id).toBeGreaterThan(0);
    }
  });

  it("spreads tasks across every status and priority (PRD #9 §50, §51)", async () => {
    const companyId = { in: DEMO_COMPANIES };

    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "ARCHIVED"] as const) {
      expect(await prisma.task.count({ where: { companyId: COMPANY.a, status } }), status).toBeGreaterThan(0);
    }
    expect(
      await prisma.task.count({ where: { companyId, priority: "CRITICAL" } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("creates overdue, due-today and future tasks (PRD #9 §52)", async () => {
    const companyId = COMPANY.a;
    const now = new Date();

    const overdue = await prisma.task.count({
      where: {
        companyId,
        archivedAt: null,
        dueDate: { lt: now },
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
    });
    const future = await prisma.task.count({ where: { companyId, dueDate: { gt: now } } });
    const undated = await prisma.task.count({ where: { companyId, dueDate: null } });

    expect(overdue).toBeGreaterThan(0);
    expect(future).toBeGreaterThan(0);
    expect(undated).toBeGreaterThan(0);
  });

  it("creates the negative authentication fixtures, outside the demo (PRD #9 §31, E-06 §45)", async () => {
    for (const email of [
      "inactive-user@nesto.test",
      "suspended-user@nesto.test",
      "inactive-membership@nesto.test",
      "suspended-membership@nesto.test",
    ]) {
      const user = await prisma.user.findUnique({ where: { email }, select: { memberships: { select: { companyId: true } } } });
      expect(user, email).not.toBeNull();
      expect(user!.memberships.map((membership) => membership.companyId), email).toEqual([COMPANY.works]);
    }
  });

  it("switches seven modules off for the fixture tenant and none in the demo (PRD #9 §13, E-06 §46)", async () => {
    const disabled = await prisma.companyModule.findMany({
      where: { companyId: COMPANY.tenant, enabled: false },
      select: { module: { select: { key: true } } },
    });
    expect(disabled.map((row) => row.module.key)).toEqual(expect.arrayContaining(["finance", "sales", "contracts", "procurement", "inventory", "qaqc", "hse"]));
    expect(await prisma.companyModule.count({ where: { companyId: { in: DEMO_COMPANIES }, enabled: false } })).toBe(0);
  });

  it("never creates a cross-company relation (PRD #9 §115)", async () => {
    const projects = await prisma.project.findMany({
      where: { clientId: { not: null } },
      select: { companyId: true, client: { select: { companyId: true } } },
    });
    for (const project of projects) {
      expect(project.client!.companyId).toBe(project.companyId);
    }

    const tasks = await prisma.task.findMany({
      where: { projectId: { not: null } },
      select: { companyId: true, project: { select: { companyId: true } } },
    });
    for (const task of tasks) {
      expect(task.project!.companyId).toBe(task.companyId);
    }

    const members = await prisma.projectMember.findMany({
      select: {
        companyId: true,
        project: { select: { companyId: true } },
        member: { select: { companyId: true } },
      },
    });
    for (const member of members) {
      expect(member.project.companyId).toBe(member.companyId);
      expect(member.member.companyId).toBe(member.companyId);
    }
  });
});

describe("unique constraints (PRD #9 §194)", () => {
  it("refuses a duplicate project code inside one company", async () => {
    await expect(
      prisma.project.create({
        data: {
          companyId: COMPANY.a,
          code: "A-PRJ-001",
          name: "Duplicate",
          createdBy: "user_owner",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a duplicate email globally", async () => {
    await expect(
      prisma.user.create({
        data: {
          username: "duplicate.probe",
          email: "owner@nesto.test",
          firstName: "Duplicate",
          lastName: "User",
          passwordHash: "x",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a second membership for the same user in one company", async () => {
    const existing = await prisma.companyMember.findFirstOrThrow({
      where: { companyId: COMPANY.a },
    });

    await expect(
      prisma.companyMember.create({
        data: {
          companyId: existing.companyId,
          userId: existing.userId,
          roleId: existing.roleId,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses the same person twice on one project", async () => {
    const existing = await prisma.projectMember.findFirstOrThrow();

    await expect(
      prisma.projectMember.create({
        data: {
          companyId: existing.companyId,
          projectId: existing.projectId,
          companyMemberId: existing.companyMemberId,
        },
      }),
    ).rejects.toThrow();
  });
});
