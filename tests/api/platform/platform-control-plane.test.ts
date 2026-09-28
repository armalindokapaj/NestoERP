import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveFeatureFlag } from "@/lib/modules/platform/platform-control.query";
import {
  createFeatureFlag,
  createPlatformPerson,
  createPlatformUser,
  repairBrokenMembership,
  revokePlatformSession,
  saveMaintenanceSetting,
  setFeatureFlagOverride,
  setGroupStatus,
  setPlatformModule,
} from "@/lib/modules/platform/platform-control.service";
import { getMaintenanceState } from "@/lib/core/maintenance/platform-maintenance";
import { cleanupSessions, COMPANY, loginAs, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

describe("Platform Admin control plane", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const flagKey = `control_plane_${suffix.replaceAll("-", "_")}`;
  const groupSlug = `control-plane-${suffix}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string | undefined;
  let companyId: string | undefined;
  let personId: string | undefined;
  let userId: string | undefined;
  let brokenMembershipId: string | undefined;

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
  });

  afterAll(async () => {
    await prisma.platformSetting.deleteMany({ where: { key: "maintenance.enabled" } });
    await prisma.featureFlag.deleteMany({ where: { key: flagKey } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (personId) await prisma.personProfile.deleteMany({ where: { id: personId } });
    if (brokenMembershipId) await prisma.companyMember.deleteMany({ where: { id: brokenMembershipId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    if (groupId) {
      await prisma.auditEvent.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    }
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("resolves a company feature override without leaking it to another company", async () => {
    const flag = await createFeatureFlag(admin, { key: flagKey, name: "Control plane isolation", defaultState: "OFF", reason: "Verify company isolation" });
    await setFeatureFlagOverride(admin, flag.id, { scopeType: "COMPANY", scopeId: COMPANY.a, state: "ON", reason: "Enable only in company A" });

    const companyA = await prisma.company.findUniqueOrThrow({ where: { id: COMPANY.a }, select: { parentGroupId: true } });
    const companyB = await prisma.company.findUniqueOrThrow({ where: { id: COMPANY.b }, select: { parentGroupId: true } });
    await expect(resolveFeatureFlag(flagKey, { companyId: COMPANY.a, parentGroupId: companyA.parentGroupId })).resolves.toMatchObject({ state: "ON", source: "COMPANY" });
    await expect(resolveFeatureFlag(flagKey, { companyId: COMPANY.b, parentGroupId: companyB.parentGroupId })).resolves.toMatchObject({ state: "OFF", source: "DEFAULT" });
  });

  it("revokes a tenant session immediately and writes an audit event", async () => {
    const tenant = await loginAs("OWNER");
    await revokePlatformSession(admin, tenant.sessionId, "Security review ended the session");
    expect(await prisma.session.findUnique({ where: { id: tenant.sessionId } })).toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { actionKey: "PLATFORM_SESSION_REVOKED", entityId: tenant.sessionId } })).toMatchObject({ actorUserId: admin.userId, reason: "Security review ended the session" });
  });

  it("suspends a group, revokes its sessions, preserves tenant data and audits the action", async () => {
    const group = await prisma.parentGroup.create({ data: { slug: groupSlug, name: "Control Plane Test Group", status: "ACTIVE", activatedAt: new Date() } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `${groupSlug}-company`, name: "Control Plane Test Company", parentGroupId: group.id } });
    companyId = company.id;
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } });
    const session = await prisma.session.create({ data: { sessionToken: `control_plane_${suffix}`, userId: owner.id, currentCompanyId: company.id, expiresAt: new Date(Date.now() + 60_000) } });

    await setGroupStatus(admin, group.id, "SUSPENDED", "Emergency tenant suspension test");
    expect(await prisma.parentGroup.findUnique({ where: { id: group.id }, select: { status: true } })).toEqual({ status: "SUSPENDED" });
    expect(await prisma.company.findUnique({ where: { id: company.id } })).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { parentGroupId: group.id, actionKey: "PLATFORM_GROUP_STATUS_CHANGED" } })).toBe(1);
  });

  it("resumes a handed-over group as active and never back into setup", async () => {
    await expect(setGroupStatus(admin, groupId!, "IMPLEMENTING", "Try to reopen setup")).rejects.toMatchObject({ details: { code: "ALREADY_HANDED_OVER" } });
    await setGroupStatus(admin, groupId!, "ACTIVE", "Suspension lifted");
    expect(await prisma.parentGroup.findUnique({ where: { id: groupId! }, select: { status: true } })).toEqual({ status: "ACTIVE" });
  });

  it("never activates a group suspended during setup except through the checklist (IMPLEMENTING → SUSPENDED → ACTIVE)", async () => {
    const setup = await prisma.parentGroup.create({ data: { slug: `${groupSlug}-setup`, name: "Control Plane Setup Group", status: "IMPLEMENTING" } });
    try {
      await setGroupStatus(admin, setup.id, "SUSPENDED", "Customer paused the rollout");
      await expect(setGroupStatus(admin, setup.id, "ACTIVE", "Try to skip the checklist")).rejects.toMatchObject({ code: "CONFLICT", details: { code: "ACTIVATION_REQUIRES_CHECKLIST" } });
      await setGroupStatus(admin, setup.id, "IMPLEMENTING", "Customer resumed the rollout");
      expect(await prisma.parentGroup.findUnique({ where: { id: setup.id }, select: { status: true, activatedAt: true } })).toEqual({ status: "IMPLEMENTING", activatedAt: null });
      await expect(setGroupStatus(admin, setup.id, "ACTIVE", "Try to skip the checklist")).rejects.toMatchObject({ details: { code: "ACTIVATION_REQUIRES_CHECKLIST" } });
    } finally {
      await prisma.auditEvent.deleteMany({ where: { parentGroupId: setup.id } });
      await prisma.parentGroup.delete({ where: { id: setup.id } });
    }
  });

  it("applies company Settings' module policy from the console, integration blockers included", async () => {
    const modules = await prisma.module.findMany({ where: { key: { in: ["procurement", "inventory", "qaqc", "clients", "sales"] } }, select: { id: true, key: true } });
    await prisma.companyModule.createMany({ data: modules.filter((row) => row.key !== "sales" && row.key !== "clients").map((row) => ({ companyId: companyId!, moduleId: row.id, enabled: true })) });
    await prisma.companyIntegrationSettings.create({ data: { companyId: companyId!, qualityGateForInventoryReceipts: true } });
    try {
      await expect(setPlatformModule(admin, { companyId: companyId!, moduleKey: "procurement", enabled: false, reason: "Try to break the gate" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "INTEGRATION_DEPENDENCY_BLOCKED" } });
      await expect(setPlatformModule(admin, { companyId: companyId!, moduleKey: "sales", enabled: true, reason: "Try without clients" })).rejects.toMatchObject({ details: { code: "MODULE_DEPENDENCY_BLOCKED" } });
      await expect(setPlatformModule(admin, { companyId: companyId!, moduleKey: "clients", enabled: false, reason: "Shared module" })).rejects.toMatchObject({ code: "CONFLICT" });
      const before = await prisma.company.findUniqueOrThrow({ where: { id: companyId! }, select: { configVersion: true } });
      await setPlatformModule(admin, { companyId: companyId!, moduleKey: "clients", enabled: true, reason: "Enable clients" });
      expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId! }, select: { configVersion: true } })).configVersion).toBe(before.configVersion + 1);
    } finally {
      await prisma.companyIntegrationSettings.deleteMany({ where: { companyId: companyId! } });
      await prisma.companyModule.deleteMany({ where: { companyId: companyId! } });
    }
  });

  it("creates a Person separately from a one-time user credential", async () => {
    const created = await createPlatformPerson(admin, { parentGroupId: groupId!, firstName: "Mira", lastName: "Control", lifecycleStatus: "EMPLOYEE", reason: "Create support test person" });
    personId = created.id;
    expect(await prisma.user.count({ where: { personProfileId: created.id } })).toBe(0);

    const account = await createPlatformUser(admin, { personProfileId: created.id, username: `mira.${suffix}`.slice(0, 32), reason: "Provision requested login" });
    userId = account.userId;
    expect(account.temporaryPassword.length).toBeGreaterThan(10);
    expect(await prisma.user.findUnique({ where: { id: account.userId }, select: { mustChangePassword: true, personProfileId: true } })).toEqual({ mustChangePassword: true, personProfileId: created.id });
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_USER_CREATED", entityId: account.userId } })).toBe(1);
  });

  it("repairs a cross-group membership through a validated audited action", async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "OWNER" }, select: { id: true } });
    const member = await prisma.companyMember.create({ data: { companyId: companyId!, userId: owner.id, roleId: role.id, status: "ACTIVE" } });
    brokenMembershipId = member.id;
    await repairBrokenMembership(admin, member.id, "Deactivate cross-group integrity violation");
    expect(await prisma.companyMember.findUnique({ where: { id: member.id }, select: { status: true } })).toEqual({ status: "INACTIVE" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { actionKey: "PLATFORM_MEMBERSHIP_CHANGED", entityId: member.id } });
    expect(audit).toMatchObject({ reason: "Deactivate cross-group integrity violation", actorUserId: admin.userId });
    expect(audit.changesJson).toBeTruthy();
  });

  it("persists maintenance policy without affecting the Platform Admin session", async () => {
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: false, reason: "Scheduled maintenance validation" });
    await expect(getMaintenanceState()).resolves.toMatchObject({ enabled: false });
    expect(await prisma.session.findUnique({ where: { id: admin.sessionId } })).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_MAINTENANCE_CHANGED", actorUserId: admin.userId } })).toBeGreaterThan(0);
  });
});
