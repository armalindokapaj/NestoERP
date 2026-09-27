import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { updateComplianceItem, waiveComplianceItem } from "@/lib/modules/contractors/contractor.compliance";
import { updateComplianceSchema, updateContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { updateSubmittalSchema, updateTransmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { updateSubmittal } from "@/lib/modules/engineering/engineering.submittals";
import { updateTransmittal } from "@/lib/modules/engineering/engineering.transmittals";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { code, ENGINEERING_SEED as S, restoreEngineering } from "./fixtures";

/**
 * AUD-09 (Forms & Validation) for the contractor and engineering dialogs:
 * partial edits never erase what a dialog did not carry (FV-05), conditional
 * fields follow the server's explicit policy (FV-10), and a field hidden from
 * a reader is neither cleared nor forgeable by them (FV-10, FV-20). Every
 * expectation is read back from the database.
 */

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

const { PATCH: patchContractor } = await import("@/app/api/contractors/[contractorId]/route");
const { PATCH: patchCompliance } = await import("@/app/api/contractor-compliance/[itemId]/route");

let owner: UserContext;

beforeAll(async () => {
  await restoreEngineering();
  owner = await loginAs("OWNER");
});

afterEach(() => actAs(null));

afterAll(async () => {
  await restoreEngineering();
  await cleanupSessions();
});

async function patch<P>(handler: (request: Request, context: { params: Promise<P> }) => Promise<Response>, params: P, body: unknown) {
  const response = await handler(new Request("http://localhost/api/test", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("contractor edit (FV-05)", () => {
  it("keeps the address line 2, region and supplier a PATCH does not carry; null clears one", async () => {
    await prisma.contractorProfile.update({ where: { id: S.contractors.apex }, data: { addressLine2: "Floor 3", region: "Tiranë" } });
    const before = await prisma.contractorProfile.findUniqueOrThrow({ where: { id: S.contractors.apex }, select: { version: true, supplierId: true, status: true } });
    expect(before.supplierId).toBe("supplier_alba");

    actAs(owner);
    // What the edit dialog of a reader without Procurement sends: no supplier, no address line 2, no region.
    const saved = await patch(patchContractor, { contractorId: S.contractors.apex }, { legalName: "Apex Structural Sh.p.k.", phone: "+355 4 000 0000", expectedVersion: before.version });
    expect(saved.status).toBe(200);
    let row = await prisma.contractorProfile.findUniqueOrThrow({ where: { id: S.contractors.apex }, select: { addressLine2: true, region: true, supplierId: true, status: true, phone: true, legalName: true } });
    expect(row).toEqual({ addressLine2: "Floor 3", region: "Tiranë", supplierId: "supplier_alba", status: before.status, phone: "+355 4 000 0000", legalName: "Apex Structural Sh.p.k." });

    const cleared = await patch(patchContractor, { contractorId: S.contractors.apex }, { legalName: "Apex Structural Sh.p.k.", region: null, expectedVersion: before.version + 1 });
    expect(cleared.status).toBe(200);
    row = await prisma.contractorProfile.findUniqueOrThrow({ where: { id: S.contractors.apex }, select: { addressLine2: true, region: true, supplierId: true, status: true, phone: true, legalName: true } });
    expect(row.region).toBeNull();
    expect(row.addressLine2).toBe("Floor 3");
  });

  it("still refuses an invalid value on its field (positive control of the parser)", async () => {
    const parsed = updateContractorSchema.safeParse({ legalName: "Apex", email: "not-an-email", expectedVersion: 1 });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["email"]);
    expect(updateContractorSchema.parse({ legalName: "Apex", expectedVersion: 1 })).toEqual({ legalName: "Apex", statusReason: null, expectedVersion: 1 });
  });
});

describe("compliance edit (FV-05, FV-10, FV-20)", () => {
  it("keeps a waiver when the edit carries no status, and withdraws it only when a status is chosen", async () => {
    await waiveComplianceItem(owner, S.compliance.brightlineBond, { reason: "Bond replaced by parent-company guarantee" });
    await updateComplianceItem(owner, S.compliance.brightlineBond, updateComplianceSchema.parse({ type: "PERFORMANCE_GUARANTEE", title: "Performance bond (corrected)" }));
    let row = await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.brightlineBond }, select: { status: true, title: true, waivedReason: true, documentId: true } });
    expect(row).toMatchObject({ status: "WAIVED", title: "Performance bond (corrected)", waivedReason: "Bond replaced by parent-company guarantee" });
    expect(row.documentId).toBe("doc_contractor_brightline_bond");

    await updateComplianceItem(owner, S.compliance.brightlineBond, updateComplianceSchema.parse({ type: "PERFORMANCE_GUARANTEE", title: "Performance bond", status: "MISSING" }));
    row = await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.brightlineBond }, select: { status: true, title: true, waivedReason: true, documentId: true } });
    expect(row).toMatchObject({ status: "MISSING", waivedReason: null });
  });

  it("a reader who cannot open files keeps the evidence by omitting it, and is refused when they forge a change", async () => {
    const blind: UserContext = { ...owner, permissions: owner.permissions.filter((permission) => permission !== "document.view") };
    const item = await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.apexLicence }, select: { type: true, title: true, documentId: true } });
    expect(item.documentId).toBe("doc_contractor_apex_licence");

    actAs(blind);
    const kept = await patch(patchCompliance, { itemId: S.compliance.apexLicence }, { type: item.type, title: `${item.title} 2027` });
    expect(kept.status).toBe(200);
    expect((await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.apexLicence }, select: { documentId: true } })).documentId).toBe("doc_contractor_apex_licence");

    const forged = await patch(patchCompliance, { itemId: S.compliance.apexLicence }, { type: item.type, title: "Forged", documentId: null });
    expect(forged.status).toBe(403);
    expect(forged.body?.error.details?.code).toBe("COMPLIANCE_DOCUMENT_FORBIDDEN");
    const after = await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.apexLicence }, select: { documentId: true, title: true } });
    expect(after).toEqual({ documentId: "doc_contractor_apex_licence", title: `${item.title} 2027` });
  });

  it("orders the dates as they will be stored, not only as sent (FV-07)", async () => {
    await prisma.contractorComplianceItem.update({ where: { id: S.compliance.northgateTax }, data: { issuedAt: new Date("2026-06-01T12:00:00Z"), expiresAt: null } });
    await expect(updateComplianceItem(owner, S.compliance.northgateTax, updateComplianceSchema.parse({ type: "TAX_DOCUMENT", title: "Tax clearance", expiresAt: "2026-05-01" }))).rejects.toMatchObject(code("COMPLIANCE_DATES"));
    expect((await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.northgateTax }, select: { expiresAt: true } })).expiresAt).toBeNull();
  });
});

describe("submittal type-dependent fields (FV-10: clear on the server)", () => {
  const base = (row: { title: string; version: number }, overrides: Record<string, unknown>) =>
    updateSubmittalSchema.parse({ title: row.title, submittalType: "SHOP_DRAWING", discipline: null, contractorId: null, workPackageId: null, assignedReviewerMemberId: null, dueAt: null, specificationReference: null, description: null, expectedVersion: row.version, ...overrides });

  it("clears product fields a forged edit puts on a shop drawing; a product type keeps them and an omitted supplier", async () => {
    const id = S.submittals.ductwork;
    let row = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id }, select: { title: true, version: true } });
    await updateSubmittal(owner, id, base(row, { manufacturer: "Forged GmbH", activity: "Forged activity" }));
    let stored = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id }, select: { manufacturer: true, activity: true, supplierId: true, version: true, title: true } });
    expect(stored).toMatchObject({ manufacturer: null, activity: null });

    row = stored;
    await updateSubmittal(owner, id, base(row, { submittalType: "MATERIAL_SUBMITTAL", manufacturer: "Lindab", supplierId: "supplier_buildpro" }));
    stored = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id }, select: { manufacturer: true, activity: true, supplierId: true, version: true, title: true } });
    expect(stored).toMatchObject({ manufacturer: "Lindab", supplierId: "supplier_buildpro" });

    // A reader without Procurement's supplier list: the dialog has no supplier field, so none is sent — kept.
    row = stored;
    await updateSubmittal(owner, id, base(row, { submittalType: "MATERIAL_SUBMITTAL", manufacturer: "Lindab AB" }));
    stored = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id }, select: { manufacturer: true, activity: true, supplierId: true, version: true, title: true } });
    expect(stored).toMatchObject({ manufacturer: "Lindab AB", supplierId: "supplier_buildpro" });

    // Back to a shop drawing: the product fields no longer describe it, and are cleared.
    row = stored;
    await updateSubmittal(owner, id, base(row, {}));
    stored = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id }, select: { manufacturer: true, activity: true, supplierId: true, version: true, title: true } });
    expect(stored).toMatchObject({ manufacturer: null, supplierId: null });
  });
});

describe("transmittal draft edit (FV-05)", () => {
  it("keeps its items when the edit carries none, and an empty list removes them", async () => {
    const id = S.transmittals.draft;
    const before = await prisma.documentTransmittalItem.count({ where: { transmittalId: id } });
    expect(before).toBeGreaterThan(0);
    const header = { direction: "OUTGOING", purpose: "FOR_REVIEW", subject: "Façade package" };
    await updateTransmittal(owner, id, updateTransmittalSchema.parse(header));
    expect(await prisma.documentTransmittalItem.count({ where: { transmittalId: id } })).toBe(before);
    expect((await prisma.documentTransmittal.findUniqueOrThrow({ where: { id }, select: { subject: true } })).subject).toBe("Façade package");

    await updateTransmittal(owner, id, updateTransmittalSchema.parse({ ...header, items: [] }));
    expect(await prisma.documentTransmittalItem.count({ where: { transmittalId: id } })).toBe(0);
  });
});
