import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { syncDevice } from "@/lib/auth/device.service";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { adminActOnDevice, getPolicyView, listSecurityEvents, savePolicy } from "@/lib/modules/security/security.service";
import { companySettingsSchema, getCompanySettings, updateCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { getSalesSettings, updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { cleanupSessions, COMPANY, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * The CEO manages the company's settings (the user, 2026-11-10: "CEO can."),
 * and so does a member holding CEO access: Settings → Sales, the finance
 * defaults and the company's mobile policy, as the Owner does. The audit log
 * and the group's own policy level stay the Owner's.
 */

const HOLDER_MEMBER = "member_architect";

let startedAt: Date;
let snapshot: Awaited<ReturnType<typeof prisma.companySettings.findUniqueOrThrow>>;
let policyBefore: Awaited<ReturnType<typeof prisma.mobileSecurityPolicy.findUnique>>;
let ceo: UserContext;
let holder: UserContext;

beforeAll(async () => {
  startedAt = new Date(Date.now() - 1000);
  // An Architect of Aurelia given CEO access on top of their role.
  await prisma.companyMember.update({ where: { id: HOLDER_MEMBER }, data: { ceoAccess: true, ceoAccessGrantedAt: new Date(), accessVersion: { increment: 1 } } });
  ceo = await loginAs("CEO");
  holder = await loginAs("ARCHITECT");
  snapshot = await prisma.companySettings.findUniqueOrThrow({ where: { companyId: ceo.companyId } });
  policyBefore = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: `COMPANY:${ceo.companyId}` } });
});

afterEach(async () => {
  await prisma.companySettings.update({
    where: { companyId: snapshot.companyId },
    data: {
      unitReservationDays: snapshot.unitReservationDays,
      unitSoldRule: snapshot.unitSoldRule,
      defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays,
      defaultTaxRate: snapshot.defaultTaxRate,
    },
  });
  if (policyBefore) await prisma.mobileSecurityPolicy.update({ where: { id: policyBefore.id }, data: { settings: policyBefore.settings as never, version: policyBefore.version } });
  else await prisma.mobileSecurityPolicy.deleteMany({ where: { scopeKey: `COMPANY:${snapshot.companyId}` } });
});

afterAll(async () => {
  await prisma.companyMember.update({ where: { id: HOLDER_MEMBER }, data: { ceoAccess: false, ceoAccessGrantedAt: null, ceoAccessGrantedByMemberId: null, accessVersion: { increment: 1 } } });
  await prisma.auditEvent.deleteMany({
    where: {
      companyId: snapshot.companyId,
      actionKey: { in: [AuditAction.COMPANY_SALES_SETTINGS_UPDATED, AuditAction.COMPANY_SETTINGS_UPDATED, AuditAction.MOBILE_POLICY_CHANGED] },
      actorMemberId: { in: [ceo.membershipId, holder.membershipId] },
      occurredAt: { gte: startedAt },
    },
  });
  await prisma.authEvent.deleteMany({ where: { type: "POLICY_CHANGED", userId: { in: [ceo.userId, holder.userId] }, createdAt: { gte: startedAt } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

const people = () => [
  ["the CEO", ceo],
  ["an Architect with CEO access", holder],
] as const;

describe("the CEO and a CEO access holder manage the company's settings", () => {
  it("are what the test says they are", () => {
    expect(ceo.role).toBe("CEO");
    expect(holder).toMatchObject({ role: "ARCHITECT", ceoAccess: true, companyId: ceo.companyId });
  });

  it("save Settings → Sales: the reservation length and the Sold rule", async () => {
    for (const [who, context] of people()) {
      const days = snapshot.unitReservationDays >= 90 ? 30 : snapshot.unitReservationDays + 1;
      const rule = snapshot.unitSoldRule === "MANUAL_APPROVAL" ? "SIGNED_CONTRACT" : "MANUAL_APPROVAL";
      expect((await getSalesSettings(context)).canUpdate, who).toBe(true);
      const saved = await updateSalesSettings(context, { unitReservationDays: days, unitSoldRule: rule });
      expect(saved, who).toMatchObject({ unitReservationDays: days, unitSoldRule: rule });
      const audit = await prisma.auditEvent.findFirst({ where: { companyId: context.companyId, actionKey: AuditAction.COMPANY_SALES_SETTINGS_UPDATED, actorMemberId: context.membershipId, occurredAt: { gte: startedAt } } });
      expect(audit, who).not.toBeNull();
      await prisma.companySettings.update({ where: { companyId: snapshot.companyId }, data: { unitReservationDays: snapshot.unitReservationDays, unitSoldRule: snapshot.unitSoldRule } });
    }
  });

  it("read and change a finance default", async () => {
    for (const [who, context] of people()) {
      const read = await getCompanySettings(context);
      expect(read, who).toMatchObject({ financeVisible: true, defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays });
      const updated = await updateCompanySettings(
        context,
        companySettingsSchema.parse({ locale: snapshot.locale, timezone: snapshot.timezone, dateFormat: snapshot.dateFormat, defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays + 5 }),
      );
      expect(updated, who).toMatchObject({ financeVisible: true, defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays + 5 });
      await prisma.companySettings.update({ where: { companyId: snapshot.companyId }, data: { defaultPaymentTermsDays: snapshot.defaultPaymentTermsDays } });
    }
  });

  it("save the company's mobile policy, and not the group's level", async () => {
    for (const [who, context] of people()) {
      const groupRow = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: `GROUP:${context.parentGroupId}` } });
      // A group that keeps the policy central refuses every company's own level, the Owner's too.
      if ((groupRow?.settings as { allowCompanyOverride?: boolean } | null)?.allowCompanyOverride !== false) {
        const saved = await savePolicy(context, { scope: "COMPANY", id: context.companyId }, { appLockRequired: true });
        expect(saved.version, who).toBeGreaterThanOrEqual(1);
      }
      await expect(savePolicy(context, { scope: "PARENT_GROUP", id: context.parentGroupId }, { appLockRequired: true }), who).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("cannot edit the group's level with a standing in the group either: a group-wide grant, or a head's Approve", async () => {
    // VIEW is what tests/helpers' grantGroupStanding gives; APPROVE across the group is what heading a group function brings (A/G).
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } });
    for (const accessLevel of ["VIEW", "APPROVE"] as const) {
      const grant = await prisma.accessGrant.create({
        data: { userId: ceo.userId, parentGroupId: ceo.parentGroupId, functionKey: "organization", scopeType: "GROUP", accessLevel, grantedByUserId: owner.id, reason: "test: group standing" },
      });
      try {
        for (const workspace of ["COMPANY", "GROUP"] as const) {
          const who = `${accessLevel} grant, ${workspace} workspace`;
          const standing = await loginAs("CEO", { workspace });
          expect(standing.moduleAccess.organization, who).toMatchObject({ accessLevel, scope: "GROUP" });
          expect(standing.workspace.scopeType, who).toBe(workspace);
          const view = await getPolicyView(standing);
          expect(view.group?.editable, who).toBe(false);
          expect(view.companies.find((c) => c.target.scope === "COMPANY" && c.target.id === ceo.companyId)?.editable, who).toBe(view.companyOverrideAllowed);
          await expect(savePolicy(standing, { scope: "PARENT_GROUP", id: standing.parentGroupId }, { appLockRequired: true }), who).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
      } finally {
        await prisma.accessGrant.delete({ where: { id: grant.id } });
      }
    }
  });

  it("leave the group's level to the Owner and Group IT, who administer the group", async () => {
    for (const [who, context] of [
      ["the Owner", await loginAs("OWNER")],
      ["the Owner in the Group workspace", await loginAs("OWNER", { workspace: "GROUP" })],
      ["Group IT", await loginAs("GROUP_IT")],
      ["Group IT in the Group workspace", await loginAs("GROUP_IT", { workspace: "GROUP" })],
    ] as const) {
      expect((await getPolicyView(context)).group?.editable, who).toBe(true);
    }
  });

  it("read their company's security events, and none another company recorded about somebody who also works here", async () => {
    // The Owner works in every company of the group: one event in this company, one in a sibling, one in none.
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } });
    const sibling = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.id, status: "ACTIVE", companyId: { not: ceo.companyId } }, select: { companyId: true } });
    // Terra's PM works in Terra only. An event about them that carries this company's tag (written before
    // administrators' Group-workspace acts were left untagged) is still about somebody who does not work here.
    const outsider = await prisma.user.findFirstOrThrow({ where: { username: "pm-c" }, select: { id: true, memberships: { select: { companyId: true } } } });
    expect(outsider.memberships).toEqual([{ companyId: COMPANY.c }]);
    const [here, there, nowhere, notOurs] = await Promise.all([
      prisma.authEvent.create({ data: { type: "SESSION_REVOKED", userId: owner.id, companyId: ceo.companyId } }),
      prisma.authEvent.create({ data: { type: "SESSION_REVOKED", userId: owner.id, companyId: sibling.companyId } }),
      prisma.authEvent.create({ data: { type: "LOGIN_FAILED", userId: owner.id, companyId: null } }),
      prisma.authEvent.create({ data: { type: "DEVICE_LOST_REPORTED", userId: outsider.id, companyId: ceo.companyId } }),
    ]);
    try {
      for (const [who, context] of people()) {
        const ids = new Set((await listSecurityEvents(context, { limit: 200 })).map((event) => event.id));
        expect(ids.has(here.id), who).toBe(true);
        expect(ids.has(nowhere.id), who).toBe(true);
        expect(ids.has(there.id), who).toBe(false);
        expect(ids.has(notOurs.id), who).toBe(false);
      }
    } finally {
      await prisma.authEvent.deleteMany({ where: { id: { in: [here.id, there.id, nowhere.id, notOurs.id] } } });
    }
  });

  it("read what a group administrator did from the Group workspace to a phone of somebody who works here, and nothing about anybody else", async () => {
    // Terra's PM works in Terra only; Group IT acts from the Group workspace, whose session sits in Aurelia.
    const pm = await loginAsEmail("pm-c@nesto.test");
    const ceoC = await loginAsEmail("ceo-c@nesto.test");
    const groupIt = await loginAs("GROUP_IT", { workspace: "GROUP" });
    expect(await prisma.companyMember.findMany({ where: { userId: pm.userId }, select: { companyId: true } })).toEqual([{ companyId: COMPANY.c }]);
    expect(ceoC).toMatchObject({ role: "CEO", companyId: COMPANY.c });
    expect(groupIt).toMatchObject({ companyId: COMPANY.a, workspace: { scopeType: "GROUP" } });

    const installId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    await syncDevice(pm, { installId, platform: "ios", appVersion: "9.9.9", appBuild: "1", osVersion: "17.2", reportedRisk: [] });
    const device = await prisma.deviceRegistration.findUniqueOrThrow({ where: { userId_installId: { userId: pm.userId, installId } }, select: { id: true } });
    try {
      await adminActOnDevice(groupIt, device.id, { action: "LOST" });
      await adminActOnDevice(groupIt, device.id, { action: "RESTORE" });
      await adminActOnDevice(groupIt, device.id, { action: "REAUTH" });
      const events = await prisma.authEvent.findMany({ where: { userId: pm.userId, metadata: { path: ["deviceId"], equals: device.id } }, select: { id: true, type: true, companyId: true } });
      const acted = events.filter((event) => event.type !== "DEVICE_REGISTERED");
      expect(new Set(acted.map((event) => event.type))).toEqual(new Set(["DEVICE_LOST_REPORTED", "DEVICE_RESTORED", "SESSIONS_REVOKED", "DEVICE_REAUTH_REQUIRED"]));
      // No company authorised it alone: it is not Aurelia's because the session sat there.
      for (const event of acted) expect(event.companyId, event.type).toBeNull();

      const seenByA = new Set((await listSecurityEvents(ceo, { limit: 200 })).map((event) => event.id));
      const seenByC = new Set((await listSecurityEvents(ceoC, { limit: 200 })).map((event) => event.id));
      for (const event of events) {
        expect(seenByA.has(event.id), `Aurelia's CEO, ${event.type}`).toBe(false);
        expect(seenByC.has(event.id), `Terra's CEO, ${event.type}`).toBe(true);
      }
    } finally {
      await prisma.authEvent.deleteMany({ where: { userId: pm.userId, metadata: { path: ["deviceId"], equals: device.id } } });
      await prisma.auditEvent.deleteMany({ where: { entityType: "Device", entityId: device.id } });
      await prisma.deviceRegistration.delete({ where: { id: device.id } });
    }
  });

  it("read a change to their company's policy level made from the Group workspace, and not another company's", async () => {
    const ceoC = await loginAsEmail("ceo-c@nesto.test");
    const groupIt = await loginAs("GROUP_IT", { workspace: "GROUP" });
    const scopeKey = `COMPANY:${COMPANY.c}`;
    const before = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey } });
    const groupRow = await prisma.mobileSecurityPolicy.findUnique({ where: { scopeKey: `GROUP:${groupIt.parentGroupId}` } });
    if ((groupRow?.settings as { allowCompanyOverride?: boolean } | null)?.allowCompanyOverride === false) return;
    const since = new Date(Date.now() - 1000);
    try {
      await savePolicy(groupIt, { scope: "COMPANY", id: COMPANY.c }, { appLockRequired: true });
      const event = await prisma.authEvent.findFirstOrThrow({ where: { type: "POLICY_CHANGED", userId: groupIt.userId, createdAt: { gte: since } }, select: { id: true, companyId: true } });
      // The company whose level changed, not the company the session sits in.
      expect(event.companyId).toBe(COMPANY.c);
      expect((await listSecurityEvents(ceo, { limit: 200 })).some((row) => row.id === event.id)).toBe(false);
      expect((await listSecurityEvents(ceoC, { limit: 200 })).some((row) => row.id === event.id)).toBe(true);
    } finally {
      if (before) await prisma.mobileSecurityPolicy.update({ where: { id: before.id }, data: { settings: before.settings as never, version: before.version, updatedById: before.updatedById } });
      else await prisma.mobileSecurityPolicy.deleteMany({ where: { scopeKey } });
      await prisma.authEvent.deleteMany({ where: { type: "POLICY_CHANGED", userId: groupIt.userId, createdAt: { gte: since } } });
      await prisma.auditEvent.deleteMany({ where: { actionKey: AuditAction.MOBILE_POLICY_CHANGED, actorUserId: groupIt.userId, occurredAt: { gte: since } } });
    }
  });

  it("are refused the audit log, which stays the Owner's", async () => {
    for (const [who, context] of people()) {
      await expect(listAuditEvents(context, auditQuerySchema.parse({ page: 1, pageSize: 10 })), who).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const owner = await loginAs("OWNER");
    await expect(listAuditEvents(owner, auditQuerySchema.parse({ page: 1, pageSize: 10 }))).resolves.toBeDefined();
  });
});
