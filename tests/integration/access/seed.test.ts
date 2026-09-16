import { afterAll, describe, expect, it } from "vitest";

import { MODULE_KEYS } from "@/config/modules";
import { PERMISSIONS } from "@/config/permissions";
import { roleModuleAccess } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { prisma } from "../../helpers";

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

describe("seeded demo data (PRD #9 §235)", () => {
  it("creates two active companies plus the suspended fixture", async () => {
    expect(await prisma.company.count({ where: { status: "ACTIVE" } })).toBe(2);
    expect(await prisma.company.count({ where: { status: "SUSPENDED" } })).toBe(1);
  });

  it("creates the required Company A volumes", async () => {
    const companyId = "company_demo_a";

    expect(await prisma.client.count({ where: { companyId } })).toBeGreaterThanOrEqual(12);
    expect(await prisma.contact.count({ where: { companyId } })).toBeGreaterThanOrEqual(18);
    expect(await prisma.project.count({ where: { companyId } })).toBeGreaterThanOrEqual(7);
    expect(await prisma.task.count({ where: { companyId } })).toBeGreaterThanOrEqual(36);
    expect(await prisma.document.count({ where: { companyId } })).toBeGreaterThanOrEqual(24);
    expect(await prisma.activity.count({ where: { companyId } })).toBeGreaterThanOrEqual(40);
  });

  it("spreads tasks across every status and priority (PRD #9 §50, §51)", async () => {
    const companyId = "company_demo_a";

    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED", "COMPLETED", "ARCHIVED"] as const) {
      expect(await prisma.task.count({ where: { companyId, status } }), status).toBeGreaterThan(0);
    }
    expect(
      await prisma.task.count({ where: { companyId, priority: "CRITICAL" } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("creates overdue, due-today and future tasks (PRD #9 §52)", async () => {
    const companyId = "company_demo_a";
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

  it("creates the negative authentication fixtures (PRD #9 §31)", async () => {
    for (const email of [
      "inactive-user@nesto.test",
      "suspended-user@nesto.test",
      "inactive-membership@nesto.test",
      "suspended-membership@nesto.test",
    ]) {
      expect(await prisma.user.findUnique({ where: { email } }), email).not.toBeNull();
    }
  });

  it("switches several modules off for Company B (PRD #9 §13)", async () => {
    const disabled = await prisma.companyModule.count({
      where: { companyId: "company_demo_b", enabled: false },
    });
    expect(disabled).toBeGreaterThanOrEqual(7);
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
          companyId: "company_demo_a",
          code: "PRJ-001",
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
      where: { companyId: "company_demo_a" },
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
