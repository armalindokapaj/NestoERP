import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveFeatureFlag } from "@/lib/modules/platform/platform-control.query";
import {
  completeThreeDModelUpload,
  createFeatureFlag,
  createPlatformPerson,
  createPlatformUser,
  createThreeDModelUpload,
  provisionThreeDProject,
  publishThreeDVersion,
  repairBrokenMembership,
  revokePlatformSession,
  saveMaintenanceSetting,
  setFeatureFlagOverride,
  setGroupStatus,
} from "@/lib/modules/platform/platform-control.service";
import { getMaintenanceState } from "@/lib/platform/maintenance";
import { createThreeDViewerGrant } from "@/lib/modules/platform/platform-three-d.viewer";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

describe("Platform Admin control plane", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const flagKey = `control_plane_${suffix.replaceAll("-", "_")}`;
  const groupSlug = `control-plane-${suffix}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string | undefined;
  let companyId: string | undefined;
  let personId: string | undefined;
  let userId: string | undefined;
  let threeDProjectId: string | undefined;
  let threeDStorageKey: string | undefined;
  let brokenMembershipId: string | undefined;

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
  });

  afterAll(async () => {
    await prisma.platformSetting.deleteMany({ where: { key: "maintenance.enabled" } });
    await prisma.featureFlag.deleteMany({ where: { key: flagKey } });
    if (threeDProjectId) {
      await prisma.threeDProjectConfiguration.deleteMany({ where: { projectId: threeDProjectId } });
      await prisma.project.deleteMany({ where: { id: threeDProjectId } });
    }
    if (threeDStorageKey) await storageProvider().deleteObject(threeDStorageKey).catch(() => undefined);
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
    const group = await prisma.parentGroup.create({ data: { slug: groupSlug, name: "Control Plane Test Group", status: "ACTIVE" } });
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

  it("turns maintenance mode on without affecting the Platform Admin session", async () => {
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: true, reason: "Scheduled maintenance validation" });
    await expect(getMaintenanceState()).resolves.toMatchObject({ enabled: true });
    expect(await prisma.session.findUnique({ where: { id: admin.sessionId } })).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_MAINTENANCE_CHANGED", actorUserId: admin.userId } })).toBeGreaterThan(0);
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: false, reason: "Scheduled maintenance validation complete" });
  });

  it("publishes a verified 3D version to an authorized tenant viewer only", async () => {
    const project = await prisma.project.create({ data: { companyId: COMPANY.a, code: `CP-${suffix}`.slice(0, 30), name: "Control Plane 3D Test", status: "ACTIVE", createdBy: admin.userId } });
    threeDProjectId = project.id;
    const configuration = await provisionThreeDProject(admin, project.id, "Provision isolated 3D test");
    const bytes = new Uint8Array(12);
    bytes.set(new TextEncoder().encode("glTF"), 0);
    const header = new DataView(bytes.buffer);
    header.setUint32(4, 2, true);
    header.setUint32(8, bytes.length, true);
    const intent = await createThreeDModelUpload(admin, configuration.id, { name: "Verified model", fileName: "verified.glb", sizeBytes: bytes.length, reason: "Upload verified tenant model" });
    const version = await prisma.threeDModelVersion.findUniqueOrThrow({ where: { id: intent.versionId }, select: { storageKey: true } });
    threeDStorageKey = version.storageKey!;
    await storageProvider().putObject(threeDStorageKey, bytes, "model/gltf-binary");
    await completeThreeDModelUpload(admin, intent.versionId, "Verify uploaded tenant model");
    await publishThreeDVersion(admin, configuration.id, intent.versionId, "Publish verified tenant model");

    const owner = await loginAs("OWNER");
    await expect(createThreeDViewerGrant(owner, project.id)).resolves.toMatchObject({ project: { id: project.id }, version: { id: intent.versionId } });
    const outsider = await loginAsEmail(DEMO_EMAIL.tenantViewer);
    await expect(createThreeDViewerGrant(outsider, project.id)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
  });
});
