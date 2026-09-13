import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clearOutbox, readOutbox } from "@/lib/mail";
import { bootstrapCompany, validateModuleSelection } from "@/lib/modules/company/company-bootstrap.service";
import { acceptInvite } from "@/lib/modules/team/invitations/invite.service";
import { prisma } from "../../helpers";

/**
 * Production company bootstrap (PRD #38 §19, §21, §135).
 *
 * Provisions a company the way an operator would, then proves the Owner can
 * accept and that a rerun converges instead of duplicating.
 */

const SLUG = "prd38-bootstrap-test";
const OWNER = "prd38-bootstrap-owner@nesto.test";

async function removeCompany() {
  const company = await prisma.company.findUnique({ where: { slug: SLUG }, select: { id: true } });
  const owner = await prisma.user.findUnique({ where: { email: OWNER }, select: { id: true } });
  if (company) {
    const companyId = company.id;
    await prisma.mailDelivery.deleteMany({ where: { companyId } });
    await prisma.auditEvent.deleteMany({ where: { companyId } });
    await prisma.activity.deleteMany({ where: { companyId } });
    await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
    await prisma.companyInvite.deleteMany({ where: { companyId } });
    await prisma.companyMember.deleteMany({ where: { companyId } });
    await prisma.companyNumberingScheme.deleteMany({ where: { companyId } });
    await prisma.companyStorageQuota.deleteMany({ where: { companyId } });
    await prisma.financeSettings.deleteMany({ where: { companyId } });
    await prisma.companyIntegrationSettings.deleteMany({ where: { companyId } });
    await prisma.companySettings.deleteMany({ where: { companyId } });
    await prisma.companyModule.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
  if (owner) {
    await prisma.authEvent.deleteMany({ where: { userId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }
}

beforeAll(async () => {
  await removeCompany();
  clearOutbox();
});

afterAll(async () => {
  await removeCompany();
  await prisma.$disconnect();
});

describe("bootstrapCompany", () => {
  it("refuses a core module switched off, or a dependency missing", () => {
    expect(validateModuleSelection(["settings"])).toEqual(["settings is a core module and cannot be disabled"]);
    expect(validateModuleSelection(["clients"])).toEqual(
      expect.arrayContaining(["sales needs clients enabled", "contracts needs clients enabled"]),
    );
    expect(validateModuleSelection(["hse", "qaqc"])).toEqual([]);
  });

  it("provisions a working company and invites its Owner, with no demo seed", async () => {
    const result = await bootstrapCompany({
      name: "PRD 38 Bootstrap Test",
      slug: SLUG,
      ownerEmail: OWNER,
      disabledModules: ["hse"],
      timezone: "Europe/Tirane",
    });

    expect(result.companyCreated).toBe(true);
    expect(result.owner.state).toBe("INVITED");
    const companyId = result.companyId;

    const [modules, settings, integration, numbering, quota, finance, audit] = await Promise.all([
      prisma.companyModule.findMany({ where: { companyId }, include: { module: true } }),
      prisma.companySettings.findUnique({ where: { companyId } }),
      prisma.companyIntegrationSettings.findUnique({ where: { companyId } }),
      prisma.companyNumberingScheme.count({ where: { companyId } }),
      prisma.companyStorageQuota.findUnique({ where: { companyId } }),
      prisma.financeSettings.findUnique({ where: { companyId } }),
      prisma.auditEvent.findFirst({ where: { companyId, actionKey: "COMPANY_CREATED" } }),
    ]);

    expect(modules.length).toBeGreaterThan(10);
    expect(modules.find((row) => row.module.key === "hse")?.enabled).toBe(false);
    expect(modules.find((row) => row.module.key === "projects")?.enabled).toBe(true);
    expect(settings?.timezone).toBe("Europe/Tirane");
    expect(integration).not.toBeNull();
    expect(numbering).toBeGreaterThan(0);
    expect(quota).not.toBeNull();
    expect(finance).not.toBeNull();
    expect(audit).not.toBeNull();

    const message = readOutbox().at(-1);
    expect(message?.to).toBe(OWNER);
    expect(message?.subject).toContain("PRD 38 Bootstrap Test");
  });

  it("converges on a rerun: no second company, no second invitation", async () => {
    const again = await bootstrapCompany({ name: "Renamed On Rerun", slug: SLUG, ownerEmail: OWNER });
    expect(again.companyCreated).toBe(false);
    expect(again.owner.state).toBe("INVITATION_PENDING");

    const company = await prisma.company.findUniqueOrThrow({ where: { slug: SLUG } });
    expect(company.name).toBe("PRD 38 Bootstrap Test");
    expect(await prisma.companyInvite.count({ where: { companyId: company.id } })).toBe(1);
    // An administrator's module choice survives a rerun that did not mention it.
    const hse = await prisma.companyModule.findFirstOrThrow({ where: { companyId: company.id, module: { key: "hse" } } });
    expect(hse.enabled).toBe(false);
  });

  it("lets the invited Owner set their password and become the active Owner", async () => {
    const invited = readOutbox().find((message) => message.to === OWNER);
    const token = invited?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    const accepted = await acceptInvite({
      token: token!,
      firstName: "First",
      lastName: "Owner",
      password: "a-long-enough-owner-password",
    });

    const membership = await prisma.companyMember.findUniqueOrThrow({
      where: { id: accepted.membershipId },
      include: { role: true },
    });
    expect(membership).toMatchObject({ status: "ACTIVE" });
    expect(membership.role.key).toBe("OWNER");

    const rerun = await bootstrapCompany({ name: "PRD 38 Bootstrap Test", slug: SLUG, ownerEmail: OWNER });
    expect(rerun.owner.state).toBe("ALREADY_ACTIVE");
  });
});
