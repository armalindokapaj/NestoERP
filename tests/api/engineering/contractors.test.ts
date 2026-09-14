import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { reconcileAttention } from "@/lib/core/notifications/attention.reconcile";
import { loadRecord } from "@/lib/core/records/record.registry";
import { assignmentOptions, createAssignment, listProjectAssignments, terminateAssignment, updateAssignment } from "@/lib/modules/contractors/contractor.assignments";
import { contractorLegalSummary } from "@/lib/modules/contractors/contractor.commercial";
import { createComplianceItem, listContractorCompliance, runComplianceExpiry, updateComplianceItem, waiveComplianceItem } from "@/lib/modules/contractors/contractor.compliance";
import { createContact, removeContact } from "@/lib/modules/contractors/contractor.contacts";
import { createAssignmentSchema, createComplianceSchema, createContractorSchema, createWorkPackageSchema, updateAssignmentSchema, updateContractorSchema } from "@/lib/modules/contractors/contractor.schema";
import { archiveContractor, createContractor, findDuplicateContractors, getContractor, listContractors, reactivateContractor, updateContractor } from "@/lib/modules/contractors/contractor.service";
import { createRfi } from "@/lib/modules/engineering/engineering.rfis";
import { createRfiSchema } from "@/lib/modules/engineering/engineering.schema";
import { completeWorkPackage, createWorkPackage, getWorkPackage } from "@/lib/modules/work-packages/work-package.service";
import { cleanupSessions, loginAs, loginAsEmail, prisma } from "../../helpers";
import { code, COMPANY_A, ENGINEERING_SEED as S, makeFile, restoreEngineering } from "./fixtures";

/**
 * Contractors, assignments, work packages and compliance against the real
 * database (PRD #46 §284-§287, §299, §304, §306).
 */

let owner: UserContext;
let pm: UserContext;
let engineer: UserContext;
let legal: UserContext;
let qaqc: UserContext;
let viewer: UserContext;
let admin: UserContext;
let ownerB: UserContext;

const contractorInput = (overrides: Record<string, unknown> = {}) => createContractorSchema.parse({ legalName: "Test Scaffold Systems", status: "ACTIVE", ...overrides });

beforeAll(async () => {
  await restoreEngineering();
  [owner, pm, engineer, legal, qaqc, viewer, admin] = await Promise.all((["OWNER", "PROJECT_MANAGER", "ENGINEER", "LEGAL", "QAQC", "VIEWER", "ADMIN"] as const).map((role) => loginAs(role)));
  ownerB = await loginAsEmail("owner-b@nesto.test");
});

afterAll(async () => {
  await restoreEngineering();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("contractor directory (§11-§19, §284)", () => {
  it("creates a contractor, warns about duplicates by name, registration, VAT and supplier, and never merges", async () => {
    const created = await createContractor(pm, contractorInput({ registrationNumber: "TST-001" }));
    expect((await getContractor(pm, created.id)).legalName).toBe("Test Scaffold Systems");

    await expect(createContractor(pm, contractorInput({ legalName: "Test Scaffold Systems Ltd" }))).rejects.toMatchObject(code("CONTRACTOR_DUPLICATE"));
    await expect(createContractor(pm, contractorInput({ legalName: "Another name", registrationNumber: "tst-001" }))).rejects.toMatchObject(code("CONTRACTOR_DUPLICATE"));
    expect((await findDuplicateContractors(pm, { vatNumber: "AL-L91234567A" })).map((row) => row.id)).toEqual([S.contractors.apex]);
    expect((await findDuplicateContractors(pm, { supplierId: "supplier_alba" }))[0].reasons).toContain("Linked to the same supplier");

    const confirmed = await createContractor(pm, contractorInput({ legalName: "Test Scaffold Systems Ltd", confirmDuplicate: true }));
    expect(confirmed.duplicates.length).toBeGreaterThan(0);
    expect(await prisma.contractorProfile.count({ where: { companyId: COMPANY_A, normalizedName: "test scaffold systems" } })).toBe(2);
  });

  it("links a supplier only from this company (§244, §304)", async () => {
    const supplierB = await prisma.supplier.findFirst({ where: { companyId: { not: COMPANY_A } }, select: { id: true } });
    if (supplierB) await expect(createContractor(owner, contractorInput({ legalName: "Cross company", supplierId: supplierB.id }))).rejects.toMatchObject(code("CONTRACTOR_SUPPLIER_INVALID"));
    await expect(createContractor(owner, contractorInput({ legalName: "Made up", supplierId: "supplier_missing" }))).rejects.toMatchObject(code("CONTRACTOR_SUPPLIER_INVALID"));
    await expect(createContractor(qaqc, contractorInput({ legalName: "Quality cannot create" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("edits with a version, refuses archiving while assignments are live, and brings back an archived contractor only with a reason (§18, §19)", async () => {
    const detail = await getContractor(owner, S.contractors.apex);
    const input = updateContractorSchema.parse({ ...detail, supplierId: detail.supplier?.id ?? null, status: "ACTIVE", expectedVersion: detail.version });
    await updateContractor(owner, S.contractors.apex, { ...input, notes: "Updated in a test" });
    await expect(updateContractor(owner, S.contractors.apex, input)).rejects.toMatchObject(code("CONTRACTOR_STALE"));
    await expect(archiveContractor(owner, S.contractors.apex, { status: "ARCHIVED", reason: null, expectedVersion: detail.version + 1 })).rejects.toMatchObject(code("CONTRACTOR_HAS_LIVE_ASSIGNMENTS"));

    const northgate = await getContractor(owner, S.contractors.northgate);
    await archiveContractor(owner, S.contractors.northgate, { status: "ARCHIVED", reason: "Did not prequalify", expectedVersion: northgate.version });
    expect((await getContractor(owner, S.contractors.northgate)).status).toBe("ARCHIVED");
    expect((await listContractors(owner, { page: 1, pageSize: 50, includeArchived: false, q: null, projectId: null })).items.map((row) => row.id)).not.toContain(S.contractors.northgate);
    await expect(archiveContractor(engineer, S.contractors.northgate, { status: "ARCHIVED", reason: null, expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reactivateContractor(owner, S.contractors.northgate, { status: "PROSPECTIVE", reason: "Prequalified on appeal", expectedVersion: northgate.version + 1 });
    const audit = await prisma.auditEvent.findFirst({ where: { companyId: COMPANY_A, actionKey: "CONTRACTOR_REACTIVATED", entityId: S.contractors.northgate }, orderBy: { occurredAt: "desc" } });
    expect(audit?.reason).toBe("Prequalified on appeal");
  });

  it("keeps the directory inside the company, and a viewer to the contractors on their projects (§242, §306)", async () => {
    expect(await loadRecord(ownerB, "contractor", S.contractors.apex)).toBeNull();
    await expect(getContractor(ownerB, S.contractors.apex)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const viewerIds = (await listContractors(viewer, { page: 1, pageSize: 50, includeArchived: true, q: null, projectId: null })).items.map((row) => row.id);
    expect(viewerIds).toContain(S.contractors.apex);
    expect(viewerIds).not.toContain(S.contractors.northgate);
    expect((await listContractors(pm, { page: 1, pageSize: 50, includeArchived: true, q: null, projectId: null })).items.map((row) => row.id)).toContain(S.contractors.northgate);
  });

  it("keeps contacts as contact records, deactivating one an assignment still names (§20-§24)", async () => {
    const contact = await createContact(pm, S.contractors.apex, { name: "Test Contact", roleTitle: null, contactRole: "ENGINEER", email: "test@apex.test", phone: null, active: true, notes: null });
    expect(await removeContact(pm, contact.id)).toEqual({ removed: true });
    expect(await removeContact(pm, "contact_apex_arben")).toEqual({ removed: false });
    expect((await prisma.contractorContact.findUniqueOrThrow({ where: { id: "contact_apex_arben" } })).active).toBe(false);
    expect(await prisma.user.count({ where: { email: "test@apex.test" } })).toBe(0);
  });
});

describe("project assignments (§25-§31, §285)", () => {
  it("assigns once per project, validates the contract and contact, and terminates without losing history", async () => {
    const northgate = S.contractors.northgate;
    const input = createAssignmentSchema.parse({ contractorId: northgate, status: "PLANNED", contractId: "contract_009", internalManagerMemberId: pm.membershipId, primaryContractorContactId: "contact_northgate_marco" });
    await expect(createAssignment(pm, "project_a", { ...input, contractId: "contract_002" })).rejects.toMatchObject(code("CONTRACT_PROJECT_MISMATCH"));
    await expect(createAssignment(pm, "project_a", { ...input, primaryContractorContactId: "contact_apex_elira" })).rejects.toMatchObject(code("ASSIGNMENT_CONTACT_INVALID"));
    const assignment = await createAssignment(pm, "project_a", input);
    await expect(createAssignment(pm, "project_a", input)).rejects.toMatchObject(code("CONTRACTOR_ALREADY_ASSIGNED"));
    expect((await prisma.notificationEventOutbox.count({ where: { eventType: "CONTRACTOR_ASSIGNED_TO_PROJECT", entityId: northgate } }))).toBe(1);

    const row = (await listProjectAssignments(pm, "project_a")).find((item) => item.id === assignment.id)!;
    expect(row.contract?.id).toBe("contract_009");
    // An engineer cannot open the contract, so the assignment shows none (§53, §54).
    expect((await listProjectAssignments(engineer, "project_a")).find((item) => item.id === assignment.id)?.contract).toBeNull();

    // The edit schema has no contractor: an assignment keeps the contractor it was made for.
    await updateAssignment(pm, assignment.id, updateAssignmentSchema.parse({ ...input, status: "ACTIVE", expectedVersion: row.version }));
    await terminateAssignment(pm, assignment.id, { reason: "Scope withdrawn", endDate: null, expectedVersion: row.version + 1 });
    await expect(createWorkPackage(pm, "project_a", createWorkPackageSchema.parse({ name: "After termination", contractorId: northgate }))).rejects.toMatchObject(code("ENGINEERING_ASSIGNMENT_TERMINATED"));
    await expect(createRfi(engineer, "project_a", createRfiSchema.parse({ subject: "After termination", question: "?", contractorId: northgate }))).rejects.toMatchObject(code("ENGINEERING_ASSIGNMENT_TERMINATED"));
    expect(await prisma.projectContractorAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).toMatchObject({ status: "TERMINATED", terminationReason: "Scope withdrawn" });
  });

  it("refuses a project in another company and a contract the writer cannot open (§245, §304)", async () => {
    await expect(createAssignment(pm, "project_b_one", createAssignmentSchema.parse({ contractorId: S.contractors.northgate }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const contractB = await prisma.contract.findFirst({ where: { companyId: "company_demo_b" }, select: { id: true } });
    if (contractB) await expect(createAssignment(owner, "project_c", createAssignmentSchema.parse({ contractorId: S.contractors.northgate, contractId: contractB.id }))).rejects.toMatchObject(code("CONTRACT_INVALID"));
    await expect(assignmentOptions(engineer, "project_a")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("work packages (§32-§40, §286)", () => {
  it("numbers per project, keeps codes unique, needs an assigned contractor, and completes without touching the contract", async () => {
    const first = await createWorkPackage(pm, "project_a", createWorkPackageSchema.parse({ name: "Test roofing", contractorId: S.contractors.apex, contractId: "contract_009", value: "1000.50", currency: "EUR" }));
    expect(first.code).toBe("WP-004");
    await expect(createWorkPackage(pm, "project_a", createWorkPackageSchema.parse({ name: "Clash", code: "WP-004" }))).rejects.toMatchObject(code("WORK_PACKAGE_CODE_TAKEN"));
    expect((await createWorkPackage(pm, "project_b", createWorkPackageSchema.parse({ name: "Other project", code: "WP-004" }))).code).toBe("WP-004");
    const stranger = await createContractor(pm, contractorInput({ legalName: "Never Assigned Plastering" }));
    await expect(createWorkPackage(pm, "project_a", createWorkPackageSchema.parse({ name: "Unassigned", contractorId: stranger.id }))).rejects.toMatchObject(code("ENGINEERING_CONTRACTOR_NOT_ASSIGNED"));

    const detail = await getWorkPackage(pm, first.id);
    expect(detail.value).toEqual({ amount: "1000.50", currency: "EUR" });
    expect((await getWorkPackage(qaqc, first.id)).value).toBeNull();
    const contractBefore = await prisma.contract.findUniqueOrThrow({ where: { id: "contract_009" }, select: { status: true } });
    await completeWorkPackage(pm, first.id, { actualFinishDate: null, expectedVersion: detail.version });
    expect((await getWorkPackage(pm, first.id)).status).toBe("COMPLETED");
    expect(await prisma.contract.findUniqueOrThrow({ where: { id: "contract_009" }, select: { status: true } })).toEqual(contractBefore);
    await expect(completeWorkPackage(engineer, first.id, { actualFinishDate: null, expectedVersion: detail.version + 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps work packages to the projects a reader can open (§246, §306)", async () => {
    await expect(getWorkPackage(engineer, S.workPackages.towerBasement)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getWorkPackage(ownerB, S.workPackages.frame)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await loadRecord(viewer, "work_package", S.workPackages.frame)).not.toBeNull();
  });
});

describe("compliance (§41-§49, §287)", () => {
  it("derives expiring and expired from the dates, and puts a renewed item back to valid", async () => {
    const soon = await createComplianceItem(legal, S.contractors.northgate, createComplianceSchema.parse({ type: "INSURANCE", title: "Test insurance", expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) }));
    expect(soon.status).toBe("EXPIRING");
    const past = await createComplianceItem(legal, S.contractors.northgate, createComplianceSchema.parse({ type: "LICENSE", title: "Test licence", expiresAt: "2020-01-01" }));
    expect(past.status).toBe("EXPIRED");
    const file = await makeFile("northgate_policy", "contractor", S.contractors.northgate, null);
    const renewed = await updateComplianceItem(legal, past.id, createComplianceSchema.parse({ type: "LICENSE", title: "Test licence", expiresAt: "2099-01-01", documentId: file }));
    expect(renewed.status).toBe("VALID");
    const otherFile = await makeFile("apex_policy", "contractor", S.contractors.apex, null);
    await expect(updateComplianceItem(legal, past.id, createComplianceSchema.parse({ type: "LICENSE", title: "Test licence", documentId: otherFile }))).rejects.toMatchObject(code("COMPLIANCE_DOCUMENT_INVALID"));
  });

  it("moves items with the worker, notifies once per expiry date, raises attention and resolves it on renewal (§44-§46, §312)", async () => {
    await prisma.contractorComplianceItem.update({ where: { id: S.compliance.apexLicence }, data: { status: "VALID", expiresAt: new Date(Date.now() - 2 * 86_400_000) } });
    const first = await runComplianceExpiry(new Date());
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.contractorComplianceItem.findUniqueOrThrow({ where: { id: S.compliance.apexLicence } })).status).toBe("EXPIRED");
    await runComplianceExpiry(new Date());
    expect(await prisma.notificationEventOutbox.count({ where: { eventType: "CONTRACTOR_COMPLIANCE_EXPIRED", entityId: S.compliance.apexLicence } })).toBe(1);
    const outbox = await prisma.notificationEventOutbox.findFirstOrThrow({ where: { eventType: "CONTRACTOR_COMPLIANCE_EXPIRED", entityId: S.compliance.apexLicence } });
    expect((outbox.payloadJson as { memberIds: string[] }).memberIds).toEqual(expect.arrayContaining([legal.membershipId, pm.membershipId]));

    await reconcileAttention({ companyId: COMPANY_A });
    expect(await prisma.attentionItem.count({ where: { entityId: S.compliance.apexLicence, conditionKey: "CONTRACTOR_COMPLIANCE_EXPIRED", status: "ACTIVE", recipientMemberId: legal.membershipId } })).toBe(1);
    expect(await prisma.attentionItem.count({ where: { entityId: S.compliance.apexInsurance, conditionKey: "CONTRACTOR_COMPLIANCE_EXPIRING", status: "ACTIVE" } })).toBeGreaterThan(0);

    await updateComplianceItem(legal, S.compliance.apexLicence, createComplianceSchema.parse({ type: "LICENSE", title: "Construction licence — Class A", expiresAt: "2099-12-31", documentId: "doc_contractor_apex_licence" }));
    expect(await prisma.attentionItem.count({ where: { entityId: S.compliance.apexLicence, status: "ACTIVE" } })).toBe(0);
  });

  it("waives only with the waive grant and a reason, audited (§49)", async () => {
    const started = new Date();
    await expect(waiveComplianceItem(engineer, S.compliance.brightlineHse, { reason: "No" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await waiveComplianceItem(legal, S.compliance.brightlineHse, { reason: "Covered by the main contractor's certificate" });
    expect((await listContractorCompliance(legal, S.contractors.brightline)).find((item) => item.id === S.compliance.brightlineHse)).toMatchObject({ status: "WAIVED", waivedReason: "Covered by the main contractor's certificate" });
    expect(await prisma.auditEvent.count({ where: { actionKey: "CONTRACTOR_COMPLIANCE_WAIVED", entityId: S.compliance.brightlineHse, occurredAt: { gte: started } } })).toBe(1);
  });
});

describe("legal and finance boundaries (§50-§58, §157, §299)", () => {
  it("shows contracts only to readers Legal would show them to, and the value only to commercial readers", async () => {
    const forLegal = await contractorLegalSummary(legal, S.contractors.brightline);
    expect(forLegal.contracts.map((row) => row.id)).toEqual(["contract_009"]);
    expect(forLegal.contracts[0].value).not.toBeNull();
    expect((await contractorLegalSummary(qaqc, S.contractors.brightline)).contracts).toEqual([]);
    expect((await contractorLegalSummary(admin, S.contractors.brightline)).contracts).toEqual([]);
  });
});
