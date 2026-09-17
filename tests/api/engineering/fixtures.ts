import { expect } from "vitest";

import { ENGINEERING_SEED, seedContractorEngineeringRecords } from "../../../prisma/seed/engineering";
import { seedMembers } from "../../../prisma/seed/members";
import { seedStoredDocument } from "../../../prisma/seed/document-objects";
import { prisma } from "../../helpers";

/**
 * Contractor and engineering test fixtures (PRD #46 §283-§307).
 *
 * Tests write freely; `restoreEngineering` puts every contractor and
 * engineering record in the demo companies back as the seed leaves them, and
 * removes the tasks and files the tests made on those records.
 */

export { ENGINEERING_SEED };
export const COMPANY_A = "company_demo_a";
/** Meridian: the Central Office Tower, its basement work package and RFI (E-06). */
export const MERIDIAN = "company_demo_b";
export const TENANT = "company_fixture_tenant";

/**
 * A second Aurelia project, as the Tower was before it went to Meridian: the
 * Project Manager runs it, the Engineer and the Architect are not on it. Apex
 * is assigned, with a basement work package, an open RFI and a contract.
 */
export const HARBOUR = { project: "test46_harbour", assignment: "test46_harbour_apex", workPackage: "test46_harbour_basement", rfi: "test46_harbour_rfi", contract: "test46_harbour_contract" } as const;

const TYPES = ["contractor", "work_package", "contractor_compliance", "engineering_document", "rfi", "technical_submittal", "transmittal"];

export async function restoreEngineering(): Promise<void> {
  const tasks = await prisma.task.findMany({ where: { entityType: { in: TYPES } }, select: { id: true } });
  if (tasks.length) {
    const ids = tasks.map((task) => task.id);
    await prisma.notification.deleteMany({ where: { entityType: "task", entityId: { in: ids } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityType: "task", entityId: { in: ids } } });
    await prisma.attentionItem.deleteMany({ where: { entityType: "task", entityId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
  }
  // The seed takes back every reminder these records were sent; the jobs' ledger has to forget them too, or none is sent again (PRD #51 §15-§19).
  await prisma.jobIdempotencyKey.deleteMany({ where: { companyId: { in: [COMPANY_A, MERIDIAN, TENANT] }, jobKey: { in: ["contractors.compliance", "engineering.reminders"] } } });
  await seedContractorEngineeringRecords(prisma, seedMembers());
  const files = await prisma.document.findMany({ where: { id: { startsWith: "test46_" } }, select: { id: true } });
  if (files.length) {
    const ids = files.map((file) => file.id);
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.documentVersion.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
  // The seed has already cleared every engineering record on Harbour.
  await prisma.contract.deleteMany({ where: { id: HARBOUR.contract } });
  await prisma.projectMember.deleteMany({ where: { projectId: HARBOUR.project } });
  await prisma.project.deleteMany({ where: { id: HARBOUR.project } });
}

/** Puts Harbour in place; `restoreEngineering` takes it away again. */
export async function makeHarbour(): Promise<void> {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
  const S = ENGINEERING_SEED;
  await prisma.project.create({ data: { id: HARBOUR.project, companyId: COMPANY_A, code: "T46-HBR", name: "Harbour Offices", status: "ACTIVE", projectManagerMemberId: "member_pm", createdBy: "test" } });
  await prisma.projectMember.create({ data: { companyId: COMPANY_A, projectId: HARBOUR.project, companyMemberId: "member_pm", status: "ACTIVE", projectRole: "Project Manager" } });
  await prisma.contract.create({ data: { id: HARBOUR.contract, companyId: COMPANY_A, contractNumber: "T46-HBR-001", title: "Harbour Offices — basement works", contractType: "SUBCONTRACT", projectId: HARBOUR.project, status: "ACTIVE", ownerMemberId: "member_pm", createdByMemberId: "member_pm" } });
  await prisma.projectContractorAssignment.create({ data: { id: HARBOUR.assignment, companyId: COMPANY_A, projectId: HARBOUR.project, contractorId: S.contractors.apex, status: "PLANNED", scopeSummary: "Basement retaining walls and ground-bearing slab.", internalManagerMemberId: "member_pm", startDate: day(45), createdByMemberId: "member_pm" } });
  await prisma.workPackage.create({ data: { id: HARBOUR.workPackage, companyId: COMPANY_A, projectId: HARBOUR.project, contractorId: S.contractors.apex, projectContractorAssignmentId: HARBOUR.assignment, code: "WP-001", name: "Basement retaining walls", discipline: "STRUCTURAL", status: "PLANNED", responsibleMemberId: "member_pm", createdByMemberId: "member_pm" } });
  await prisma.rfi.create({ data: { id: HARBOUR.rfi, companyId: COMPANY_A, projectId: HARBOUR.project, contractorId: S.contractors.apex, rfiNumber: "RFI-001", subject: "Existing basement wall condition", question: "Survey shows spalling on the existing party wall. Should it be repaired before the new retaining wall is cast?", discipline: "STRUCTURAL", status: "OPEN", raisedByMemberId: "member_pm", assignedToMemberId: "member_pm", dueAt: day(5), openedAt: day(-2), createdByMemberId: "member_pm" } });
}

/** A real stored, available file on a record — what a finished upload leaves behind. */
export async function makeFile(id: string, entityType: string, entityId: string, projectId: string | null = "project_a"): Promise<string> {
  const documentId = `test46_${id}`;
  await seedStoredDocument(prisma, { id: documentId, companyId: COMPANY_A, name: `${id}.pdf`, projectId, module: entityType === "contractor" || entityType === "contractor_compliance" ? "contractors" : "engineering", entityType, entityId, uploadedByMemberId: null, createdBy: "test" });
  return documentId;
}

export const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
