import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";
import { listSecurityEvents, savePolicy } from "@/lib/modules/security/security.service";
import { companySettingsSchema, getCompanySettings, updateCompanySettings } from "@/lib/modules/settings/company-settings.service";
import { getSalesSettings, updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

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

  it("read their company's security events, and none another company recorded about somebody who also works here", async () => {
    // The Owner works in every company of the group: one event in this company, one in a sibling, one in none.
    const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" }, select: { id: true } });
    const sibling = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.id, status: "ACTIVE", companyId: { not: ceo.companyId } }, select: { companyId: true } });
    const [here, there, nowhere] = await Promise.all([
      prisma.authEvent.create({ data: { type: "SESSION_REVOKED", userId: owner.id, companyId: ceo.companyId } }),
      prisma.authEvent.create({ data: { type: "SESSION_REVOKED", userId: owner.id, companyId: sibling.companyId } }),
      prisma.authEvent.create({ data: { type: "LOGIN_FAILED", userId: owner.id, companyId: null } }),
    ]);
    try {
      for (const [who, context] of people()) {
        const ids = new Set((await listSecurityEvents(context, { limit: 200 })).map((event) => event.id));
        expect(ids.has(here.id), who).toBe(true);
        expect(ids.has(nowhere.id), who).toBe(true);
        expect(ids.has(there.id), who).toBe(false);
      }
    } finally {
      await prisma.authEvent.deleteMany({ where: { id: { in: [here.id, there.id, nowhere.id] } } });
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
