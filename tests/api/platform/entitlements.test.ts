import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { resolveEnabledModules } from "@/lib/context/build-context";
import { savePlan, applyEntitlementChanges, entitlementDirectory, getCompanyEntitlements, moduleHolders, previewPlanChange, setCompanyLimits } from "@/lib/modules/entitlements/entitlement.service";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createPlatformProject, setCompanyStatus } from "@/lib/modules/platform/platform-control.service";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";
import { applyModuleChange } from "@/lib/modules/settings/module-toggle.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Plans, entitlements and limits (Admin Modules PRD #4 §17-§23, §27, §49, §64,
 * §68, §86, §88).
 */

const NAME = "T-ENT Minerva Studio";
let admin: PlatformContext;
let companyId: string;

async function remove() {
  await prisma.auditEvent.deleteMany({ where: { entityType: "EntitlementPlan", entityLabelSnapshot: "T-ENT Plan" } });
  await prisma.entitlementPlan.deleteMany({ where: { key: "t-ent-plan" } });
  const rows = await prisma.company.findMany({ where: { name: NAME }, select: { id: true, parentGroupId: true } });
  for (const row of rows) {
    await prisma.project.deleteMany({ where: { companyId: row.id } });
    for (const model of ["companyNumberingScheme", "companyStorageQuota", "financeSettings", "companyIntegrationSettings", "companySettings", "companyModule", "departmentAssignment", "department", "projectType", "projectUnitType", "activity", "companyEntitlement"] as const) {
      await (prisma[model] as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where: { companyId: row.id } });
    }
    await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId: row.id }, { entityId: row.id }, { parentGroupId: row.parentGroupId }] } });
    await prisma.company.delete({ where: { id: row.id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: row.parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: row.parentGroupId } });
  }
}

const modules = (id: string) => resolveEnabledModules(id);
const version = async () => (await getCompanyEntitlements(admin, companyId)).version;

beforeAll(async () => {
  await remove();
  admin = await loginAsPlatformAdmin();
  ({ companyId } = await createCompany(admin, createCompanySchema.parse({ name: NAME })));
});

afterAll(async () => {
  await remove();
  await cleanupSessions();
});

describe("module entitlements", () => {
  it("a new company holds the default plan and nothing changes for it (§86)", async () => {
    const data = await getCompanyEntitlements(admin, companyId);
    expect(data.plan.name).toBe("Full NESTO");
    expect(data.modules.find((row) => row.key === "finance")).toMatchObject({ state: "Enabled", entitled: true });
    expect(data.modules.find((row) => row.key === "dashboard")).toMatchObject({ state: "Required" });
    expect(await modules(companyId)).toContain("finance");
  });

  it("disabling a module removes it from the company at once, and keeps its data (§17, §18, §32, §73)", async () => {
    const switchedOn = await prisma.companyModule.count({ where: { companyId, enabled: true } });
    await applyEntitlementChanges(admin, companyId, { version: await version(), changes: [{ moduleKey: "finance", mode: "DISABLED" }], reason: "Contract amendment #2" });
    expect(await modules(companyId)).not.toContain("finance");
    // The company's own switch is untouched: re-granting restores it as it was.
    expect(await prisma.companyModule.count({ where: { companyId, enabled: true } })).toBe(switchedOn);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: companyId, actionKey: "PLATFORM_ENTITLEMENTS_CHANGED" }, orderBy: { occurredAt: "desc" } });
    expect(event.reason).toBe("Contract amendment #2");
    expect((await moduleHolders(admin, "finance")).some((row) => row.id === companyId)).toBe(false);
  });

  it("the company cannot switch on what it was not granted (§1, §3)", async () => {
    const finance = await prisma.module.findUniqueOrThrow({ where: { key: "finance" }, select: { id: true } });
    await prisma.companyModule.updateMany({ where: { companyId, moduleId: finance.id }, data: { enabled: false } });
    await expect(applyModuleChange(companyId, "finance", true, async () => undefined)).rejects.toMatchObject({ blocker: { code: "MODULE_NOT_ENTITLED" } });
  });

  it("refuses a result that breaks a dependency, all or nothing (§20, §64)", async () => {
    const before = await version();
    await expect(applyEntitlementChanges(admin, companyId, { version: before, changes: [{ moduleKey: "hr", mode: "ENABLED" }, { moduleKey: "projects", mode: "DISABLED" }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await version()).toBe(before);
    expect((await getCompanyEntitlements(admin, companyId)).modules.find((row) => row.key === "projects")?.state).toBe("Enabled");
  });

  it("refuses a save made against an older version (§64)", async () => {
    await expect(applyEntitlementChanges(admin, companyId, { version: (await version()) - 1, changes: [] })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("trials end on their own date, server-side (§21, §22)", async () => {
    const past = new Date(Date.now() - 86_400_000);
    await applyEntitlementChanges(admin, companyId, { version: await version(), changes: [{ moduleKey: "finance", mode: "TRIAL", startsAt: new Date(Date.now() - 10 * 86_400_000), endsAt: new Date(Date.now() + 86_400_000) }] });
    expect(await modules(companyId)).toContain("dashboard");
    expect((await getCompanyEntitlements(admin, companyId)).modules.find((row) => row.key === "finance")?.state).toBe("Trial");
    await prisma.companyModuleEntitlement.update({ where: { companyId_moduleKey: { companyId, moduleKey: "finance" } }, data: { endsAt: past } });
    expect((await getCompanyEntitlements(admin, companyId)).modules.find((row) => row.key === "finance")).toMatchObject({ state: "Expired", entitled: false });
  });

  it("previews and applies a plan change: Documents Only keeps Documents, withholds the rest (§27, §46)", async () => {
    const documents = await prisma.entitlementPlan.findUniqueOrThrow({ where: { key: "documents" } });
    const preview = await previewPlanChange(admin, companyId, documents.id);
    expect(preview.keep).toEqual(["Documents"]);
    expect(preview.disable).toContain("Projects");
    await applyEntitlementChanges(admin, companyId, { version: await version(), planId: documents.id, changes: [{ moduleKey: "finance", mode: "INHERIT" }] });
    const enabled = await modules(companyId);
    expect(enabled).toContain("documents");
    expect(enabled).not.toContain("projects");
    expect((await entitlementDirectory(admin, { q: NAME })).rows[0]).toMatchObject({ plan: "Documents Only", modules: 1 });
  });

  it("enforces the project limit and keeps entitlements through suspension (§49, §68, §69)", async () => {
    await setCompanyLimits(admin, companyId, { maxActiveUsers: null, maxProjects: 1, maxStorageGb: 5, reason: "Pilot" });
    await createPlatformProject(admin, { companyId, code: "TENT-1", name: "First", status: "ACTIVE", reason: "Pilot" });
    await expect(createPlatformProject(admin, { companyId, code: "TENT-2", name: "Second", status: "ACTIVE", reason: "Pilot" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "PROJECT_LIMIT_REACHED" } });
    expect((await prisma.companyStorageQuota.findUniqueOrThrow({ where: { companyId } })).maxStorageBytes).toBe(BigInt(5 * 1024 ** 3));

    const rows = await prisma.companyModuleEntitlement.count({ where: { companyId } });
    await setCompanyStatus(admin, companyId, "SUSPENDED", "Unpaid");
    await setCompanyStatus(admin, companyId, "ACTIVE", "Paid");
    expect(await prisma.companyModuleEntitlement.count({ where: { companyId } })).toBe(rows);
    expect((await getCompanyEntitlements(admin, companyId)).plan.name).toBe("Documents Only");
  });

  it("saves a plan template, refusing one that breaks a dependency (§6, §24, §25)", async () => {
    await expect(savePlan(admin, null, { name: "T-ENT Plan", key: "t-ent-plan", moduleKeys: ["sales"], maxActiveUsers: null, maxProjects: null, maxStorageGb: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const { id } = await savePlan(admin, null, { name: "T-ENT Plan", key: "t-ent-plan", moduleKeys: ["projects", "clients", "sales"], maxActiveUsers: "15", maxProjects: "", maxStorageGb: null });
    expect(await prisma.entitlementPlan.findUniqueOrThrow({ where: { id } })).toMatchObject({ moduleKeys: ["projects", "clients", "sales"], maxActiveUsers: 15, maxProjects: null, status: "ACTIVE" });
  });

  it("refuses a context without module permissions (§33)", async () => {
    await expect(getCompanyEntitlements({ ...admin, permissions: [] } as PlatformContext, companyId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(applyEntitlementChanges({ ...admin, permissions: ["platform.module.view"] } as PlatformContext, companyId, { version: 0, changes: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
