import { expect } from "vitest";

import { ENGINEERING_SEED, seedContractorEngineeringRecords } from "../../../prisma/seed/engineering";
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
export const COMPANY_B = "company_demo_b";

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
  await prisma.jobIdempotencyKey.deleteMany({ where: { companyId: { in: [COMPANY_A, COMPANY_B] }, jobKey: { in: ["contractors.compliance", "engineering.reminders"] } } });
  const rows = await prisma.companyMember.findMany({ select: { id: true, userId: true } });
  await seedContractorEngineeringRecords(prisma, new Map(rows.map((row) => [row.userId, row.id])));
  const files = await prisma.document.findMany({ where: { id: { startsWith: "test46_" } }, select: { id: true } });
  if (files.length) {
    const ids = files.map((file) => file.id);
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.documentVersion.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
}

/** A real stored, available file on a record — what a finished upload leaves behind. */
export async function makeFile(id: string, entityType: string, entityId: string, projectId: string | null = "project_a"): Promise<string> {
  const documentId = `test46_${id}`;
  await seedStoredDocument(prisma, { id: documentId, companyId: COMPANY_A, name: `${id}.pdf`, projectId, module: entityType === "contractor" || entityType === "contractor_compliance" ? "contractors" : "engineering", entityType, entityId, uploadedByMemberId: null, createdBy: "test" });
  return documentId;
}

export const code = (value: string) => ({ details: expect.objectContaining({ code: value }) });
