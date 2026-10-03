import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { setCompanyStatus } from "@/lib/modules/platform/platform-control.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import {
  deleteCompany, deleteGroup, listArchivedDocuments, listDeletedTenants, purgeCompany, purgeGroup, restoreArchivedDocument, restoreCompany, restoreGroup,
} from "@/lib/modules/platform/platform-recovery.service";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Platform Recovery: delete is a status that ends access and keeps every row,
 * restore returns the tenant as it was, and the permanent purge is a separate
 * typed-name action that leaves no row behind.
 */

const STANDALONE = "T-RC Standalone Co";
const GROUP = "T-RC Group";
const GROUP_SLUG = "t-rc-group";
const A = "T-RC Alpha";
const B = "T-RC Beta";

let admin: PlatformContext;

async function removeAll(): Promise<void> {
  const companies = await prisma.company.findMany({ where: { OR: [{ name: { in: [STANDALONE, A, B] } }, { parentGroup: { slug: GROUP_SLUG } }] }, select: { id: true, parentGroupId: true } });
  const groups = await prisma.parentGroup.findMany({ where: { OR: [{ slug: GROUP_SLUG }, { id: { in: companies.map((row) => row.parentGroupId) } }] }, select: { id: true } });
  await prisma.$queryRaw`SELECT platform_purge_tenants(${companies.map((row) => row.id)}::text[], ${groups.map((row) => row.id)}::text[])`;
  await prisma.auditEvent.deleteMany({ where: { entityLabelSnapshot: { in: [STANDALONE, GROUP, A, B] } } });
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("deleting and restoring a company", () => {
  let companyId: string;

  it("refuses to delete without the name typed back, or without permission", async () => {
    ({ companyId } = await createCompany(admin, createCompanySchema.parse({ name: STANDALONE })));
    await expect(deleteCompany(admin, companyId, { reason: "Closing it", confirmationName: "wrong" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(deleteCompany({ ...admin, permissions: [] }, companyId, { reason: "Closing it", confirmationName: STANDALONE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).status).toBe("ACTIVE");
  });

  it("deletes into a recoverable state: access ends, nothing is erased, other changes are refused", async () => {
    await setCompanyStatus(admin, companyId, "SUSPENDED", "Paused for a while");
    await deleteCompany(admin, companyId, { reason: "Closing it", confirmationName: STANDALONE });
    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.status).toBe("DELETED");
    expect(row.statusBeforeDelete).toBe("SUSPENDED");
    expect(row.deletedAt).not.toBeNull();
    expect(row.purgeAfter!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(await prisma.department.count({ where: { companyId } })).toBeGreaterThan(0);
    expect((await listDeletedTenants(admin)).some((tenant) => tenant.id === companyId && tenant.kind === "Company")).toBe(true);
    await expect(setCompanyStatus(admin, companyId, "ACTIVE", "Try to reactivate")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deleteCompany(admin, companyId, { reason: "Again", confirmationName: STANDALONE })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("restores it to the status it had", async () => {
    await restoreCompany(admin, companyId, "Opened by mistake");
    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row).toMatchObject({ status: "SUSPENDED", statusBeforeDelete: null, deletedAt: null, purgeAfter: null });
    await expect(restoreCompany(admin, companyId, "Nothing to restore")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("archived documents come back with their status, and not while the company is deleted", async () => {
    const document = await prisma.document.create({ data: { companyId, name: "T-RC plan.pdf", createdBy: admin.userId, status: "ARCHIVED", preArchiveStatus: "ACTIVE", storageStatus: "ARCHIVED", archivedAt: new Date(), archivedBy: admin.userId }, select: { id: true } });
    expect((await listArchivedDocuments(admin, { q: "T-RC plan" })).rows.map((row) => row.id)).toEqual([document.id]);

    await deleteCompany(admin, companyId, { reason: "Closing it", confirmationName: STANDALONE });
    expect((await listArchivedDocuments(admin, { q: "T-RC plan" })).total).toBe(0);
    await expect(restoreArchivedDocument(admin, document.id, "Needed back")).rejects.toMatchObject({ code: "CONFLICT" });
    await restoreCompany(admin, companyId, "Needed back");

    await restoreArchivedDocument(admin, document.id, "Needed back");
    expect(await prisma.document.findUniqueOrThrow({ where: { id: document.id } })).toMatchObject({ status: "ACTIVE", storageStatus: "AVAILABLE", archivedAt: null, preArchiveStatus: null });
    await expect(restoreArchivedDocument(admin, document.id, "Again")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("removes it for good only once deleted, and takes its private root and its files' rows with it", async () => {
    await expect(purgeCompany(admin, companyId, { reason: "Cleanup", confirmationName: STANDALONE })).rejects.toMatchObject({ code: "CONFLICT" });
    await deleteCompany(admin, companyId, { reason: "Closing it", confirmationName: STANDALONE });
    const root = (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).parentGroupId;
    await expect(purgeCompany(admin, companyId, { reason: "Cleanup", confirmationName: "nope" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await purgeCompany(admin, companyId, { reason: "Cleanup", confirmationName: STANDALONE });
    expect(await prisma.company.count({ where: { id: companyId } })).toBe(0);
    expect(await prisma.parentGroup.count({ where: { id: root } })).toBe(0);
    expect(await prisma.document.count({ where: { companyId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_COMPANY_PURGED", entityId: companyId } })).toBe(1);
  });
});

describe("deleting and restoring a group", () => {
  let groupId: string;
  let alpha: string;
  let beta: string;

  it("takes every company down with it, and restores only those it took", async () => {
    ({ id: groupId } = await createParentGroup(admin, createParentGroupSchema.parse({ name: GROUP, slug: GROUP_SLUG })));
    alpha = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: A, slug: "t-rc-alpha" }))).companyId;
    beta = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: B, slug: "t-rc-beta" }))).companyId;

    await deleteCompany(admin, alpha, { reason: "Closed earlier", confirmationName: A });
    await deleteGroup(admin, groupId, { reason: "Winding up", confirmationName: GROUP });
    expect((await prisma.parentGroup.findUniqueOrThrow({ where: { id: groupId } })).status).toBe("DELETED");
    expect(await prisma.company.findMany({ where: { id: { in: [alpha, beta] } }, select: { id: true, status: true, deletedWithGroup: true } })).toEqual(expect.arrayContaining([{ id: alpha, status: "DELETED", deletedWithGroup: false }, { id: beta, status: "DELETED", deletedWithGroup: true }]));
    await expect(restoreCompany(admin, beta, "Alone")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(purgeCompany(admin, beta, { reason: "Alone", confirmationName: B })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T-RC Gamma", slug: "t-rc-gamma" }))).rejects.toMatchObject({ code: "CONFLICT" });

    await restoreGroup(admin, groupId, "Not winding up");
    expect((await prisma.parentGroup.findUniqueOrThrow({ where: { id: groupId } })).status).not.toBe("DELETED");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: beta } })).status).toBe("ACTIVE");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: alpha } })).status).toBe("DELETED");
  });

  it("is removed permanently with all its companies", async () => {
    await deleteGroup(admin, groupId, { reason: "Winding up", confirmationName: GROUP });
    await purgeGroup(admin, groupId, { reason: "Cleanup", confirmationName: GROUP });
    expect(await prisma.parentGroup.count({ where: { id: groupId } })).toBe(0);
    expect(await prisma.company.count({ where: { id: { in: [alpha, beta] } } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_GROUP_PURGED", entityId: groupId } })).toBe(1);
  });
});
