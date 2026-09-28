import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import {
  activityLabel, dashboardActivity, dashboardAttention, dashboardOrganizations, dashboardProjects, dashboardSummary, dashboardUsage, threeDState,
} from "@/lib/modules/platform/platform-dashboard.query";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * The Platform Admin Dashboard (Dashboard PRD §7-§10, §11-§17, §61, §75).
 * Numbers are checked against the database directly, so the Dashboard and the
 * directories it links to cannot drift apart.
 */

const NAME = "T-DASH Standalone Studio";
let admin: PlatformContext;
let companyId: string | undefined;

async function remove() {
  const rows = await prisma.company.findMany({ where: { name: NAME }, select: { id: true, parentGroupId: true } });
  for (const row of rows) {
    await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId: row.id }, { entityId: row.id }, { parentGroupId: row.parentGroupId }] } });
    for (const model of ["companyNumberingScheme", "companyStorageQuota", "financeSettings", "companyIntegrationSettings", "companySettings", "companyModule", "departmentAssignment", "department", "projectType", "projectUnitType", "activity"] as const) {
      await (prisma[model] as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where: { companyId: row.id } });
    }
    await prisma.company.delete({ where: { id: row.id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: row.parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: row.parentGroupId } });
  }
}

beforeAll(async () => {
  await remove();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await remove();
  await cleanupSessions();
});

describe("Platform Admin Dashboard", () => {
  it("counts from the database: groups and companies once each, accounts not employees (§7-§10)", async () => {
    const summary = await dashboardSummary(admin);
    expect(summary.organizations.groups).toBe(await prisma.parentGroup.count({ where: { isTestFixture: false, kind: "GROUP", status: { not: "ARCHIVED" } } }));
    expect(summary.organizations.companies).toBe(await prisma.company.count({ where: { parentGroup: { isTestFixture: false } } }));
    expect(summary.organizations.total).toBe(summary.organizations.groups + summary.organizations.companies);
    expect(summary.users.total).toBe(await prisma.user.count());
    expect(summary.users.active + summary.users.inactive + summary.users.suspended).toBe(summary.users.total);
    expect(summary.projects.total).toBe(await prisma.project.count({ where: { archivedAt: null, status: { not: "ARCHIVED" }, company: { parentGroup: { isTestFixture: false } } } }));
  });

  it("a new standalone company is one more company, a standalone organization row, and an activity entry (§8, §15, §41)", async () => {
    const before = await dashboardSummary(admin);
    ({ companyId } = await createCompany(admin, createCompanySchema.parse({ name: NAME })));
    const after = await dashboardSummary(admin);
    expect(after.organizations.companies).toBe(before.organizations.companies + 1);
    expect(after.organizations.standalone).toBe(before.organizations.standalone + 1);
    expect(after.organizations.groups).toBe(before.organizations.groups);

    const organizations = await dashboardOrganizations(admin);
    expect(organizations.length).toBeLessThanOrEqual(5);
    expect(organizations[0]).toMatchObject({ id: companyId, name: NAME, type: "Standalone company", companies: null, users: 0 });

    const activity = await dashboardActivity(admin);
    expect(activity.length).toBeLessThanOrEqual(6);
    expect(activity[0]).toMatchObject({ label: "Company created", href: `/admin/organizations/${companyId}` });
  });

  it("raises a suspended company as a warning and drops it once reactivated (§11-§13, §50, §51)", async () => {
    await prisma.company.update({ where: { id: companyId }, data: { status: "SUSPENDED" } });
    const raised = await dashboardAttention(admin, 50);
    const item = raised.items.find((row) => row.id === `company:${companyId}`);
    expect(item).toMatchObject({ severity: "warning", entity: NAME, href: `/admin/organizations/${companyId}` });
    const order = { critical: 0, warning: 1, info: 2 };
    expect(raised.items.map((row) => order[row.severity])).toEqual([...raised.items.map((row) => order[row.severity])].sort((a, b) => a - b));

    await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });
    expect((await dashboardAttention(admin, 50)).items.some((row) => row.id === `company:${companyId}`)).toBe(false);
  });

  it("keeps 3D audience apart from project lifecycle, and lists at most five projects (§9, §21, §22)", async () => {
    expect(threeDState(null)).toBe("Not configured");
    expect(threeDState({ visibility: "PUBLIC", deletedAt: null })).toBe("Public");
    expect(threeDState({ visibility: "COMPANY_ONLY", deletedAt: null })).toBe("Company only");
    expect(threeDState({ visibility: "OFFLINE", deletedAt: null })).toBe("Offline");
    const projects = await dashboardProjects(admin);
    expect(projects.length).toBeLessThanOrEqual(5);
    for (const row of projects) expect(["ACTIVE", "PENDING", "FINISHED", "ARCHIVED"]).toContain(row.status);
  });

  it("reports only measured usage: no quota invented, module and 3D totals from the database (§27-§31)", async () => {
    const usage = await dashboardUsage(admin);
    expect(usage.modules.assignments).toBeGreaterThanOrEqual(0);
    expect(usage.modules.available).toBeGreaterThan(0);
    expect(usage.threeD.configured).toBe(usage.threeD.public + usage.threeD.companyOnly + usage.threeD.offline);
    expect(usage.storage.usedBytes).toBeGreaterThanOrEqual(0);
  });

  it("names actions for people, not keys (§15, §55)", () => {
    expect(activityLabel("PLATFORM_COMPANY_ATTACHED_TO_GROUP")).toBe("Company attached to group");
  });

  it("refuses a context without Platform Admin dashboard access (§61, §76)", async () => {
    const tenant = { ...admin, permissions: [] } as PlatformContext;
    for (const read of [dashboardSummary, dashboardAttention, dashboardActivity, dashboardOrganizations, dashboardProjects, dashboardUsage]) {
      await expect(read(tenant)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
