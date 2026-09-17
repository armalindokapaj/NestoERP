import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { assignmentOptions, createAssignment, listProjectAssignments, updateAssignment } from "@/lib/modules/contractors/contractor.assignments";
import { contractorLegalSummary } from "@/lib/modules/contractors/contractor.commercial";
import { complianceDocumentOptions } from "@/lib/modules/contractors/contractor.compliance";
import { createAssignmentSchema, updateAssignmentSchema } from "@/lib/modules/contractors/contractor.schema";
import { createEngineeringDocument, retireEngineeringDocument, updateEngineeringDocument } from "@/lib/modules/engineering/engineering.documents";
import { linkRecord } from "@/lib/modules/engineering/engineering.links";
import { createRevision, setSharingClassification } from "@/lib/modules/engineering/engineering.revisions";
import { addRfiReference } from "@/lib/modules/engineering/engineering.rfis";
import { createEngineeringDocumentSchema, createTransmittalSchema, updateEngineeringDocumentSchema, updateSubmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { updateSubmittal } from "@/lib/modules/engineering/engineering.submittals";
import { createTransmittal, getTransmittal, issueTransmittal } from "@/lib/modules/engineering/engineering.transmittals";
import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { code, COMPANY_A, ENGINEERING_SEED as S, HARBOUR, makeFile, makeHarbour, restoreEngineering } from "./fixtures";

/**
 * Contractor and engineering authorization regressions (PRD #47 §50, §51,
 * §62, §85-§87), against the real database.
 *
 * A link is judged by where the linked record really sits, a transmittal
 * carries the version a revision was submitted with, what is under review
 * stays as it was reviewed, and nothing names a file, a contact or a contract
 * value to somebody who could not open it. `restoreEngineering` puts every
 * contractor and engineering record back afterwards, with the files and tasks
 * made here.
 */

let owner: UserContext;
let pm: UserContext;
let legal: UserContext;
let procurement: UserContext;

const without = (context: UserContext, ...drop: string[]) => ({ ...context, permissions: context.permissions.filter((permission) => !drop.includes(permission)) }) as UserContext;
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/** A stored file filed wherever a test says — on a record, a project, or nothing at all. */
async function file(id: string, parent: { projectId?: string | null; module?: string | null; entityType?: string | null; entityId?: string | null }): Promise<string> {
  const documentId = `test46_${id}`;
  await seedStoredDocument(prisma, { id: documentId, companyId: COMPANY_A, name: `${id}.pdf`, uploadedByMemberId: null, createdBy: "test", ...parent });
  return documentId;
}

beforeAll(async () => {
  await restoreEngineering();
  await makeHarbour();
  [owner, pm, legal, procurement] = await Promise.all((["OWNER", "PROJECT_MANAGER", "LEGAL", "PROCUREMENT"] as const).map((role) => loginAs(role)));
});

afterAll(async () => {
  await restoreEngineering();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("references and links are placed where the record really sits (PRD #47 §51)", () => {
  it("refuses a file on another project's contract, though the file itself names no project", async () => {
    // Uploaded onto a record, as every record upload is: no project on the file, only on its parent.
    const onHarbourContract = await file("harbour_contract", { module: "contracts", entityType: "contract", entityId: HARBOUR.contract });
    const onRiversideContract = await file("riverside_contract", { module: "contracts", entityType: "contract", entityId: "contract_009" });
    const onContractor = await file("apex_profile", { module: "contractors", entityType: "contractor", entityId: S.contractors.apex });
    const companyFile = await file("company_policy", {});
    const reference = (referenceId: string) => addRfiReference(owner, S.rfis.slabEdge, { referenceType: "DOCUMENT", referenceId, note: null });

    await expect(reference(onHarbourContract)).rejects.toMatchObject({ ...code("RFI_REFERENCE_PROJECT_MISMATCH"), reason: "CROSS_PROJECT_REFERENCE" });
    // A record that sits on no project does not make its file this project's either.
    await expect(reference(onContractor)).rejects.toMatchObject(code("RFI_REFERENCE_PROJECT_MISMATCH"));
    await expect(reference(onRiversideContract)).resolves.toMatchObject({ id: expect.any(String) });
    // Only a file with no parent at all is company-level, and referenced from any project.
    await expect(reference(companyFile)).resolves.toMatchObject({ id: expect.any(String) });
    expect(await prisma.rfiReference.count({ where: { rfiId: S.rfis.slabEdge, referenceId: { in: [onHarbourContract, onContractor] } } })).toBe(0);
  });

  it("refuses a task raised from another project's record that carries no project of its own", async () => {
    const task = await prisma.task.create({
      data: { companyId: COMPANY_A, title: "Test harbour wall follow-up", createdByMemberId: owner.membershipId, createdBy: owner.userId, module: "engineering", entityType: "rfi", entityId: HARBOUR.rfi, projectId: null },
      select: { id: true },
    });
    await expect(linkRecord(owner, "technical_submittal", S.submittals.curtainWall, { type: "task", recordId: task.id })).rejects.toMatchObject(code("ENGINEERING_LINK_PROJECT_MISMATCH"));
    await expect(addRfiReference(owner, S.rfis.slabEdge, { referenceType: "TASK", referenceId: task.id, note: null })).rejects.toMatchObject(code("RFI_REFERENCE_PROJECT_MISMATCH"));
  });
});

describe("transmittals (PRD #46 §122, §123, PRD #47 §62, §87)", () => {
  it("records the version a revision was submitted with, not a version that landed afterwards", async () => {
    const doc = await createEngineeringDocument(pm, "project_a", createEngineeringDocumentSchema.parse({ documentNumber: "PIN-001", title: "Test pinned drawing", documentType: "DRAWING", discipline: "ARCHITECTURE" }));
    const fileId = await makeFile("pin_a", "engineering_document", doc.id);
    const version = async (number: number) => {
      await prisma.documentVersion.create({ data: { id: `test46_pin_v${number}`, companyId: COMPANY_A, documentId: fileId, versionNumber: number, storageKey: `test46/pin/v${number}.pdf`, storageStatus: "AVAILABLE", uploadedByMemberId: pm.membershipId } });
      await prisma.document.update({ where: { id: fileId }, data: { currentVersionId: `test46_pin_v${number}`, latestVersionNumber: number } });
    };
    await version(1);
    const revision = await createRevision(pm, "document", doc.id, { revisionCode: "A", documentId: fileId, notes: null, submit: true });
    // A second version reaches the file after submission — the race the upload re-check closes elsewhere.
    await version(2);

    const transmittal = await createTransmittal(pm, "project_a", createTransmittalSchema.parse({ direction: "OUTGOING", purpose: "FOR_REVIEW", items: [{ documentId: fileId, engineeringDocumentId: doc.id, engineeringRevisionId: revision.id }] }));
    await issueTransmittal(pm, transmittal.id, { issuedAt: null });
    expect((await prisma.documentTransmittalItem.findFirstOrThrow({ where: { transmittalId: transmittal.id } })).documentVersionId).toBe("test46_pin_v1");
    expect((await getTransmittal(pm, transmittal.id)).items[0].versionNumber).toBe(1);
  });

  it("names an item's file only to a reader who could open that file", async () => {
    const incidentPhoto = await file("incident_photo", { projectId: "project_a", module: "hse", entityType: "incident", entityId: "hse_inc_001" });
    const transmittal = await createTransmittal(owner, "project_a", createTransmittalSchema.parse({
      direction: "INTERNAL",
      purpose: "FOR_INFORMATION",
      items: [{ documentId: incidentPhoto }, { documentId: "doc_eng_arc_sd_023_c", engineeringDocumentId: S.documents.floorPlan, engineeringRevisionId: "engrev_arc_sd_023_c" }],
    }));
    expect((await getTransmittal(owner, transmittal.id)).items.map((item) => item.document?.name ?? null)).toEqual(["incident_photo.pdf", "ARC-SD-023 Rev C.pdf"]);
    // Procurement reads transmittals and documents, but not HSE incidents.
    const forProcurement = await getTransmittal(procurement, transmittal.id);
    expect(forProcurement.items.map((item) => item.document?.name ?? null)).toEqual([null, "ARC-SD-023 Rev C.pdf"]);
    expect(JSON.stringify(forProcurement)).not.toContain("incident_photo");
  });
});

describe("what is under review stays as it was reviewed (PRD #47 §85-§87)", () => {
  async function submittalInput(id: string) {
    const row = await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id } });
    return updateSubmittalSchema.parse({
      title: row.title, description: row.description, submittalType: row.submittalType, discipline: row.discipline, contractorId: row.contractorId, workPackageId: row.workPackageId,
      assignedReviewerMemberId: row.assignedReviewerMemberId, dueAt: day(row.dueAt), specificationReference: row.specificationReference, manufacturer: row.manufacturer,
      productName: row.productName, modelNumber: row.modelNumber, supplierId: row.supplierId, activity: row.activity, workArea: row.workArea, expectedVersion: row.version,
    });
  }

  it("freezes a submittal's product details under review and after the decision, and nothing else", async () => {
    const approved = await submittalInput(S.submittals.rebar);
    await expect(updateSubmittal(pm, S.submittals.rebar, { ...approved, manufacturer: "Another mill" })).rejects.toMatchObject({ ...code("SUBMITTAL_DETAILS_FROZEN"), code: "CONFLICT", reason: "STATE_DENIED" });
    await expect(updateSubmittal(pm, S.submittals.rebar, { ...approved, supplierId: "supplier_buildpro" })).rejects.toMatchObject(code("SUBMITTAL_DETAILS_FROZEN"));
    const submitted = await submittalInput(S.submittals.crane);
    await expect(updateSubmittal(pm, S.submittals.crane, { ...submitted, submittalType: "TECHNICAL_SUBMITTAL" })).rejects.toMatchObject(code("SUBMITTAL_DETAILS_FROZEN"));
    // The description is not what was approved; and a submittal sent back for revision is open again.
    await expect(updateSubmittal(pm, S.submittals.rebar, { ...approved, description: "Mill certificates for levels 1-4." })).resolves.toMatchObject({ id: S.submittals.rebar });
    await expect(updateSubmittal(pm, S.submittals.curtainWall, { ...(await submittalInput(S.submittals.curtainWall)), modelNumber: "FWS 50.SI" })).resolves.toMatchObject({ id: S.submittals.curtainWall });
    expect((await prisma.technicalSubmittal.findUniqueOrThrow({ where: { id: S.submittals.rebar } })).manufacturer).toBe("Kurum Steel");
  });

  it("freezes an engineering document's title and type while a revision is reviewed and once approved", async () => {
    const input = async (id: string) => {
      const row = await prisma.engineeringDocument.findUniqueOrThrow({ where: { id } });
      return updateEngineeringDocumentSchema.parse({ documentNumber: row.documentNumber, title: row.title, documentType: row.documentType, discipline: row.discipline, contractorId: row.contractorId, workPackageId: row.workPackageId, authorText: row.authorText, responsibleMemberId: row.responsibleMemberId, reviewerMemberId: row.reviewerMemberId, reviewDueAt: day(row.reviewDueAt), expectedVersion: row.version });
    };
    await expect(updateEngineeringDocument(pm, S.documents.curtainWall, { ...(await input(S.documents.curtainWall)), title: "Renamed under review" })).rejects.toMatchObject({ ...code("ENGINEERING_DOCUMENT_DETAILS_FROZEN"), reason: "STATE_DENIED" });
    await expect(updateEngineeringDocument(pm, S.documents.floorPlan, { ...(await input(S.documents.floorPlan)), documentType: "SHOP_DRAWING" })).rejects.toMatchObject(code("ENGINEERING_DOCUMENT_DETAILS_FROZEN"));
    await expect(updateEngineeringDocument(pm, S.documents.ventilation, { ...(await input(S.documents.ventilation)), title: "Ventilation specification — Block A" })).resolves.toMatchObject({ id: S.documents.ventilation });
  });

  it("changes no file's sharing classification on a void record", async () => {
    const doc = await createEngineeringDocument(pm, "project_a", createEngineeringDocumentSchema.parse({ documentNumber: "VOID-SHARE-1", title: "Test entered twice", documentType: "SPECIFICATION", discipline: "GENERAL" }));
    const fileId = await makeFile("void_share", "engineering_document", doc.id);
    await retireEngineeringDocument(owner, doc.id, { reason: "Entered twice", status: "VOID" });
    await expect(setSharingClassification(pm, "document", doc.id, fileId, "EXTERNAL_SHAREABLE")).rejects.toMatchObject(code("REVISION_PARENT_CLOSED"));
    expect((await prisma.document.findUniqueOrThrow({ where: { id: fileId } })).sharingClassification).toBe("INTERNAL_ONLY");
  });
});

describe("contractors (PRD #47 §50, §62)", () => {
  it("lists compliance evidence only for an item of the contractor named", async () => {
    await expect(complianceDocumentOptions(owner, S.contractors.brightline, S.compliance.apexInsurance)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await complianceDocumentOptions(owner, S.contractors.apex, S.compliance.apexInsurance)).map((row) => row.id)).toContain("doc_compliance_apex_insurance");
  });

  it("shows contact names only with contractor_contact.view, and an edit without it keeps the contact", async () => {
    const blind = without(pm, "contractor_contact.view");
    expect((await listProjectAssignments(pm, "project_a")).find((row) => row.id === S.assignments.apexRiverside)?.primaryContact?.name).toBe("Arben Hoxha");
    const rows = await listProjectAssignments(blind, "project_a");
    expect(rows.find((row) => row.id === S.assignments.apexRiverside)?.primaryContact).toBeNull();
    expect((await assignmentOptions(blind, "project_a")).contractors.flatMap((row) => row.contacts)).toEqual([]);
    expect(JSON.stringify(await assignmentOptions(blind, "project_a"))).not.toContain("Arben");

    const row = await prisma.projectContractorAssignment.findUniqueOrThrow({ where: { id: S.assignments.apexRiverside } });
    await updateAssignment(blind, row.id, updateAssignmentSchema.parse({ status: row.status, scopeSummary: "Test frame and cores", contractId: row.contractId, internalManagerMemberId: row.internalManagerMemberId, primaryContractorContactId: null, startDate: day(row.startDate), endDate: day(row.endDate), expectedVersion: row.version }));
    expect(await prisma.projectContractorAssignment.findUniqueOrThrow({ where: { id: row.id }, select: { scopeSummary: true, primaryContractorContactId: true } })).toEqual({ scopeSummary: "Test frame and cores", primaryContractorContactId: "contact_apex_arben" });
    await expect(createAssignment(blind, "project_a", createAssignmentSchema.parse({ contractorId: S.contractors.northgate, primaryContractorContactId: "contact_apex_arben" }))).rejects.toMatchObject(code("ASSIGNMENT_CONTACT_INVALID"));
  });

  it("shows a contract's value to Legal's commercial readers, not to a Project Manager holding finance.view", async () => {
    const forPm = await contractorLegalSummary(pm, S.contractors.brightline);
    expect(forPm.contracts.map((contract) => contract.id)).toEqual(["contract_009"]);
    expect(forPm.contracts[0]).toMatchObject({ value: null, currency: null });
    expect((await contractorLegalSummary(legal, S.contractors.brightline)).contracts[0].value).not.toBeNull();
  });
});
