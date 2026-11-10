import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { syncDevice } from "@/lib/auth/device.service";
import { hasRecentAuthentication } from "@/lib/auth/recent-auth";
import type { UserContext } from "@/lib/context/types";
import { effectivePolicyForUser } from "@/lib/core/security/mobile-policy.service";
import { authorizationSnapshotFor } from "@/lib/core/sync/authorization.service";
import { actOnOwnDevice, adminActOnDevice, getDevice, getPolicyView, listDevices, restoreOwnDevice, savePolicy } from "@/lib/modules/security/security.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * The group owner is protected (the user, 2026-11-10: "Group owner is
 * protected."). Nobody else in the tenant — the CEO, a CEO access holder,
 * Group IT — signs out, revokes, blocks, marks lost, restores or forces a new
 * sign-in on an Owner's device; another Owner of the group may, and the Owner
 * on their own. A company's own mobile policy does not bind the Owner: the
 * platform and the group's level do.
 */

const HOLDER_MEMBER = "member_architect";
/** Aurelia's Viewer, made an Owner of the group for one test: the seed has one. */
const SECOND_OWNER_MEMBER = "member_viewer";
const ACTIONS = ["SIGN_OUT", "REAUTH", "REVOKE", "LOST", "BLOCK", "RESTORE"] as const;
/** Every action once, each revocation lifted again so the next can run. */
const EVERY_ACTION = ["SIGN_OUT", "REAUTH", "REVOKE", "RESTORE", "LOST", "RESTORE", "BLOCK", "RESTORE"] as const;
const COMPANY_KEY = `COMPANY:${COMPANY.a}`;
const GROUP_KEY = "GROUP:group_demo_nesto";

const installs: string[] = [];
let startedAt: Date;
let viewerRoleId: string;
let policies: Awaited<ReturnType<typeof prisma.mobileSecurityPolicy.findMany>>;

const install = () => {
  const id = `owprot${Array.from({ length: 26 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
  installs.push(id);
  return id;
};

/** A phone for this person, registered from a session of its own (signing the device out ends that session, not the test's). */
async function deviceOf(context: UserContext, appVersion = "9.9.9"): Promise<string> {
  const installId = install();
  await syncDevice(context, { installId, platform: "ios", appVersion, appBuild: "1", osVersion: "17.2", reportedRisk: [] });
  return (await prisma.deviceRegistration.findUniqueOrThrow({ where: { userId_installId: { userId: context.userId, installId } }, select: { id: true } })).id;
}

async function putPoliciesBack() {
  await prisma.mobileSecurityPolicy.deleteMany({ where: { scopeKey: { in: [COMPANY_KEY, GROUP_KEY] } } });
  for (const row of policies) await prisma.mobileSecurityPolicy.create({ data: { ...row, settings: row.settings as never } });
}

beforeAll(async () => {
  startedAt = new Date(Date.now() - 1000);
  await prisma.companyMember.update({ where: { id: HOLDER_MEMBER }, data: { ceoAccess: true, ceoAccessGrantedAt: new Date(), accessVersion: { increment: 1 } } });
  viewerRoleId = (await prisma.companyMember.findUniqueOrThrow({ where: { id: SECOND_OWNER_MEMBER }, select: { roleId: true } })).roleId;
  policies = await prisma.mobileSecurityPolicy.findMany({ where: { scopeKey: { in: [COMPANY_KEY, GROUP_KEY] } } });
});

afterAll(async () => {
  await prisma.companyMember.update({ where: { id: HOLDER_MEMBER }, data: { ceoAccess: false, ceoAccessGrantedAt: null, ceoAccessGrantedByMemberId: null, accessVersion: { increment: 1 } } });
  await prisma.companyMember.update({ where: { id: SECOND_OWNER_MEMBER }, data: { roleId: viewerRoleId, accessVersion: { increment: 1 } } });
  await putPoliciesBack();
  const devices = (await prisma.deviceRegistration.findMany({ where: { installId: { in: installs } }, select: { id: true } })).map((row) => row.id);
  await prisma.session.updateMany({ where: { deviceId: { in: devices } }, data: { deviceId: null } });
  await prisma.auditEvent.deleteMany({ where: { entityType: "Device", entityId: { in: devices } } });
  await prisma.authEvent.deleteMany({ where: { OR: devices.map((id) => ({ metadata: { path: ["deviceId"], equals: id } })) } });
  await prisma.deviceRegistration.deleteMany({ where: { id: { in: devices } } });
  await prisma.auditEvent.deleteMany({ where: { actionKey: "MOBILE_POLICY_CHANGED", occurredAt: { gte: startedAt } } });
  await prisma.authEvent.deleteMany({ where: { type: "POLICY_CHANGED", createdAt: { gte: startedAt } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const administrators = async () =>
  [
    ["the CEO", await loginAs("CEO")],
    ["an Architect with CEO access", await loginAs("ARCHITECT")],
    ["Group IT", await loginAs("GROUP_IT")],
    ["Group IT in the Group workspace", await loginAs("GROUP_IT", { workspace: "GROUP" })],
  ] as const;

describe("the group owner's devices", () => {
  it("are what the test says they are", async () => {
    const [ceo, holder, it, owner] = await Promise.all([loginAs("CEO"), loginAs("ARCHITECT"), loginAs("GROUP_IT"), loginAs("OWNER")]);
    expect(ceo.role).toBe("CEO");
    expect(holder).toMatchObject({ role: "ARCHITECT", ceoAccess: true });
    expect(it.role).toBe("GROUP_IT");
    expect(owner.role).toBe("OWNER");
  });

  it("are refused to the CEO, a CEO access holder and Group IT for every action, and nothing happens to them", async () => {
    const ownerDevice = await deviceOf(await loginAs("OWNER"));
    for (const [who, context] of await administrators()) {
      // They see it, read-only and marked as the group owner's.
      expect((await getDevice(context, ownerDevice)).protected, who).toBe(true);
      expect((await listDevices(context, { q: "owner" })).rows.find((row) => row.id === ownerDevice)?.protected, who).toBe(true);
      for (const action of ACTIONS) {
        await expect(adminActOnDevice(context, ownerDevice, { action }), `${who}: ${action}`).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
          message: "The group owner manages their own devices and sessions.",
          details: { code: "OWNER_PROTECTED" },
        });
      }
    }
    const after = await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: ownerDevice }, select: { status: true, revokedAt: true, sessions: { select: { id: true } } } });
    expect(after.status).toBe("ACTIVE");
    expect(after.revokedAt).toBeNull();
    expect(after.sessions).toHaveLength(1);
    expect(await prisma.authEvent.count({ where: { metadata: { path: ["deviceId"], equals: ownerDevice }, type: { not: "DEVICE_REGISTERED" } } })).toBe(0);
  });

  it("leaves the same people every action on anyone else's device", async () => {
    for (const [who, context] of await administrators()) {
      const device = await deviceOf(await loginAs("ENGINEER"));
      expect((await getDevice(context, device)).protected, who).toBe(false);
      for (const action of EVERY_ACTION) await expect(adminActOnDevice(context, device, { action }), `${who}: ${action}`).resolves.toBeDefined();
      expect((await prisma.deviceRegistration.findUniqueOrThrow({ where: { id: device } })).status, who).toBe("ACTIVE");
    }
  });

  it("are another Owner's of the group to act on, and the Owner's own", async () => {
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "OWNER" }, select: { id: true } });
    await prisma.companyMember.update({ where: { id: SECOND_OWNER_MEMBER }, data: { roleId: ownerRole.id, accessVersion: { increment: 1 } } });
    try {
      const second = await loginAs("VIEWER");
      expect(second.role).toBe("OWNER");
      const ownerDevice = await deviceOf(await loginAs("OWNER"));
      expect((await getDevice(second, ownerDevice)).protected).toBe(false);
      for (const action of EVERY_ACTION) await expect(adminActOnDevice(second, ownerDevice, { action }), `second Owner: ${action}`).resolves.toBeDefined();

      // The second Owner is protected from the CEO in turn.
      const secondsDevice = await deviceOf(await loginAs("VIEWER"));
      await expect(adminActOnDevice(await loginAs("CEO"), secondsDevice, { action: "BLOCK" })).rejects.toMatchObject({ details: { code: "OWNER_PROTECTED" } });

      // The Owner on their own phone: from Security, and from the administrators' page.
      const owner = await loginAs("OWNER");
      const own = await deviceOf(await loginAs("OWNER"));
      expect((await getDevice(owner, own)).protected).toBe(false);
      await expect(actOnOwnDevice(owner, own, "SIGN_OUT")).resolves.toMatchObject({ current: false });
      await expect(actOnOwnDevice(owner, own, "REVOKE")).resolves.toBeDefined();
      await expect(restoreOwnDevice(owner, own)).resolves.toBeUndefined();
      for (const action of EVERY_ACTION) await expect(adminActOnDevice(owner, own, { action }), `the Owner, own device: ${action}`).resolves.toBeDefined();
    } finally {
      await prisma.companyMember.update({ where: { id: SECOND_OWNER_MEMBER }, data: { roleId: viewerRoleId, accessVersion: { increment: 1 } } });
    }
  });
});

describe("the group owner's mobile policy", () => {
  it("is not tightened by a strict company policy the CEO saves, which binds everybody else in the company", async () => {
    const [ceo, owner, engineer] = await Promise.all([loginAs("CEO"), loginAs("OWNER"), loginAs("ENGINEER")]);
    const ownerBefore = await effectivePolicyForUser(owner.userId);
    const engineerBefore = await effectivePolicyForUser(engineer.userId);
    expect(ownerBefore.recentAuthMinutes).toBeGreaterThan(5);
    const groupRow = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: GROUP_KEY } });
    expect((groupRow?.settings as { allowCompanyOverride?: boolean } | null)?.allowCompanyOverride).not.toBe(false);
    try {
      await savePolicy(ceo, { scope: "COMPANY", id: COMPANY.a }, {
        appLockRequired: true,
        appLockTimeoutSeconds: 0,
        offlineAuthorizationHours: 1,
        recentAuthMinutes: 1,
        documentExportAllowed: false,
        notificationPreviewPolicy: "HIDDEN",
        minimumAppVersion: "99.0.0",
      });

      // Every reader of a person's policy: the merge itself, push previews and the export rule read it as is.
      const ownerAfter = await effectivePolicyForUser(owner.userId);
      expect(ownerAfter).toEqual(ownerBefore);
      const engineerAfter = await effectivePolicyForUser(engineer.userId);
      expect(engineerAfter).not.toEqual(engineerBefore);
      expect(engineerAfter).toMatchObject({ appLockRequired: true, appLockTimeoutSeconds: 0, offlineAuthorizationHours: 1, recentAuthMinutes: 1, documentExportAllowed: false, notificationPreviewPolicy: "HIDDEN", minimumAppVersion: "99.0.0" });

      // Recent sign-in, which sensitive actions on the web use too: five minutes ago is recent for the Owner only.
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000);
      await prisma.session.updateMany({ where: { id: { in: [owner.sessionId, engineer.sessionId] } }, data: { recentAuthAt: fiveMinutesAgo } });
      expect(await hasRecentAuthentication(owner)).toBe(true);
      expect(await hasRecentAuthentication(engineer)).toBe(false);

      // The offline authorization snapshot.
      const now = new Date();
      const hours = async (context: UserContext) => (new Date((await authorizationSnapshotFor(context, now)).offlineAccessExpiresAt).getTime() - now.getTime()) / 3_600_000;
      expect(await hours(owner)).toBe(ownerBefore.offlineAuthorizationHours);
      expect(await hours(engineer)).toBe(1);

      // The device check: the company's minimum version stops the engineer's app, not the Owner's.
      const ownerState = await syncDevice(await loginAs("OWNER"), { installId: install(), platform: "ios", appVersion: "9.9.9", appBuild: "1", osVersion: "17.2", reportedRisk: [] });
      const engineerState = await syncDevice(await loginAs("ENGINEER"), { installId: install(), platform: "ios", appVersion: "9.9.9", appBuild: "1", osVersion: "17.2", reportedRisk: [] });
      expect(ownerState.compliance.action).not.toBe("REQUIRE_UPDATE");
      expect(ownerState.policy.appLockRequired).toBe(ownerBefore.appLockRequired);
      expect(engineerState.compliance.action).toBe("REQUIRE_UPDATE");

      // The company's own view of its people still shows its level, and says it does not reach the group owner (the page).
      const view = await getPolicyView(ceo);
      expect(view.companies.find((c) => c.target.scope === "COMPANY" && c.target.id === COMPANY.a)?.effective).toMatchObject({ recentAuthMinutes: 1, appLockRequired: true });
    } finally {
      await putPoliciesBack();
    }
  });

  it("still follows the group's own level, which only the Owner and Group IT set", async () => {
    const owner = await loginAs("OWNER");
    try {
      await expect(savePolicy(await loginAs("CEO"), { scope: "PARENT_GROUP", id: owner.parentGroupId }, { appLockRequired: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await savePolicy(owner, { scope: "PARENT_GROUP", id: owner.parentGroupId }, { appLockRequired: true, recentAuthMinutes: 10, offlineAuthorizationHours: 48 });
      expect(await effectivePolicyForUser(owner.userId)).toMatchObject({ appLockRequired: true, recentAuthMinutes: 10, offlineAuthorizationHours: 48 });
      // A company below it may tighten for its own people; the Owner stays on the group's.
      await savePolicy(await loginAs("CEO"), { scope: "COMPANY", id: COMPANY.a }, { recentAuthMinutes: 2 });
      expect((await effectivePolicyForUser(owner.userId)).recentAuthMinutes).toBe(10);
      expect((await effectivePolicyForUser((await loginAs("ENGINEER")).userId)).recentAuthMinutes).toBe(2);
    } finally {
      await putPoliciesBack();
    }
  });
});
