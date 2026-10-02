import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { renameCompany, renameCompanySchema } from "@/lib/modules/settings/company-settings.service";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/** Renaming the company: the CEO may, roles without company.name.update may not. */

let companyId: string;
let originalName: string;
let startedAt: Date;

beforeAll(async () => {
  const ceo = await loginAs("CEO");
  companyId = ceo.companyId;
  originalName = (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).name;
  startedAt = new Date();
});

afterEach(async () => {
  await prisma.company.update({ where: { id: companyId }, data: { name: originalName } });
  await prisma.auditEvent.deleteMany({
    where: { companyId, actionKey: AuditAction.COMPANY_RENAMED, occurredAt: { gte: startedAt } },
  });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("renameCompany", () => {
  it("lets the CEO rename the company and records the change", async () => {
    const ceo = await loginAs("CEO");
    await renameCompany(ceo, { name: "Renamed Holdings" });

    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.name).toBe("Renamed Holdings");

    const event = await prisma.auditEvent.findFirst({
      where: { companyId, actionKey: AuditAction.COMPANY_RENAMED, occurredAt: { gte: startedAt } },
    });
    expect(event).not.toBeNull();
  });

  it("refuses a role without company.name.update", async () => {
    const hr = await loginAs("HR");
    await expect(renameCompany(hr, { name: "Nope Ltd" })).rejects.toBeInstanceOf(AccessError);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).name).toBe(originalName);
  });

  it("rejects a blank or one-letter name", () => {
    expect(renameCompanySchema.safeParse({ name: "  " }).success).toBe(false);
    expect(renameCompanySchema.safeParse({ name: "A" }).success).toBe(false);
    expect(renameCompanySchema.safeParse({ name: "  Acme  " })).toMatchObject({ success: true, data: { name: "Acme" } });
  });
});
