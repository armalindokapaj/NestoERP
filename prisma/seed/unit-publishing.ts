import { Prisma, type PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { buildSnapshot } from "../../lib/modules/project-structure/unit-publishing.rules";
import { loadPublishStates } from "../../lib/modules/project-structure/unit-publishing.state";
import { placeholderPdf, seedStoredDocument } from "./document-objects";
import { STRUCTURE_SEED } from "./structure";

/**
 * The unit page and its publishing (E-05D §104, §105).
 *
 * Block A, Floor 1 of Riverside Residences shows every publishing state, and
 * Block B's first apartment a draft half-way there:
 *
 * - A-101 Published v1: Sales Plan, a floor plan image (primary), an exterior
 *   render and a technical drawing. Nothing changed since.
 * - A-102 Published v2 with unpublished changes: its saleable area was corrected
 *   after v2, and the Architect has submitted the change for review.
 * - A-103 Ready for Publishing: complete, waiting for the Architecture Manager.
 * - A-104 Revision Required: returned with a reason; no primary image yet.
 * - B-101 Draft: a Sales Plan and nothing else.
 * - A-201 to A-204 Published v1, each with its Sales Plan and floor plan: the
 *   stock the sales seed prices, holds, reserves and sells (E-05E).
 *
 * Every file is a canonical Document filed against its unit, with version 1 and
 * real bytes, as a genuine upload leaves it. Everything else stays Draft (§105).
 */

const COMPANY_A = "company_demo_a";
// structure.ts imports this file to clear it, so its constants are read at call time, never at load.
const RIVERSIDE = "project_a";

type Member = (userId: string) => string;

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

function floorPlanSvg(label: string, hue: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <rect width="1200" height="900" fill="#f7f5f0"/>
    <rect x="120" y="110" width="960" height="680" fill="none" stroke="#2f3a42" stroke-width="14"/>
    <line x1="560" y1="110" x2="560" y2="520" stroke="#2f3a42" stroke-width="8"/>
    <line x1="120" y1="520" x2="820" y2="520" stroke="#2f3a42" stroke-width="8"/>
    <line x1="820" y1="520" x2="820" y2="790" stroke="#2f3a42" stroke-width="8"/>
    <rect x="140" y="130" width="400" height="370" fill="${hue}" opacity="0.18"/>
    <rect x="580" y="130" width="480" height="370" fill="${hue}" opacity="0.28"/>
    <rect x="140" y="540" width="660" height="230" fill="${hue}" opacity="0.12"/>
    <text x="600" y="860" font-family="Helvetica, Arial" font-size="40" text-anchor="middle" fill="#2f3a42">${label}</text>
  </svg>`;
}

function renderSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fbdd1"/><stop offset="1" stop-color="#eef0ea"/></linearGradient></defs>
    <rect width="1200" height="800" fill="url(#s)"/>
    <rect x="260" y="180" width="680" height="520" fill="#e9e4da"/>
    ${Array.from({ length: 5 }, (_, row) => Array.from({ length: 6 }, (_, col) => `<rect x="${300 + col * 108}" y="${210 + row * 96}" width="72" height="60" fill="#6f8fa3" opacity="0.8"/>`).join("")).join("")}
    <rect y="700" width="1200" height="100" fill="#7c8a74"/>
  </svg>`;
}

async function jpeg(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer());
}

/** A seeded file filed against its unit, with the version 1 a real upload creates first (PRD #38 §56). */
async function unitFile(prisma: PrismaClient, input: { id: string; unitId: string; name: string; bytes: Uint8Array; memberId: string; createdBy: string; uploaded: Date; companyId?: string }) {
  const companyId = input.companyId ?? COMPANY_A;
  await seedStoredDocument(prisma, {
    id: input.id,
    companyId,
    name: input.name,
    module: "projects",
    entityType: "project_unit",
    entityId: input.unitId,
    uploadedByMemberId: input.memberId,
    createdBy: input.createdBy,
    bytes: input.bytes,
  });
  const document = await prisma.document.findUniqueOrThrow({ where: { id: input.id } });
  const version = await prisma.documentVersion.create({
    data: {
      companyId,
      documentId: document.id,
      versionNumber: 1,
      storageProvider: document.storageProvider,
      storageBucket: document.storageBucket,
      storageKey: document.storageKey!,
      originalFileName: document.originalFileName,
      fileName: document.fileName,
      extension: document.extension,
      mimeTypeDeclared: document.mimeType,
      mimeTypeDetected: document.detectedMimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksum,
      storageStatus: "AVAILABLE",
      previewStatus: document.previewStatus,
      previewMimeType: document.previewMimeType,
      uploadedByMemberId: input.memberId,
      createdAt: input.uploaded,
      availableAt: input.uploaded,
    },
    select: { id: true },
  });
  await prisma.document.update({ where: { id: document.id }, data: { currentVersionId: version.id, latestVersionNumber: 1, thumbnailStorageKey: null, createdAt: input.uploaded } });
  return document.id;
}

/** Publishes the unit as it now stands, the way the publish transaction would (E-05D §23). */
async function publish(prisma: PrismaClient, unitId: string, versionNumber: number, publisher: string, at: Date, companyId = COMPANY_A) {
  const state = (await loadPublishStates(prisma as unknown as Prisma.TransactionClient, companyId, [unitId])).get(unitId)!;
  if (!state.readiness.ready) throw new Error(`Seed unit ${state.row.unitCode} is not ready to publish: ${state.readiness.missing.join(", ")}`);
  const snapshot = buildSnapshot(state.facts);
  const publication = await prisma.unitPublication.create({
    data: {
      companyId,
      projectId: state.row.projectId,
      unitId,
      versionNumber,
      publishedAt: at,
      publishedByMemberId: publisher,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      salesPlanDocumentId: snapshot.salesPlan?.documentId ?? null,
      salesPlanDocumentVersionId: snapshot.salesPlan?.documentVersionId ?? null,
      primaryMediaDocumentId: snapshot.primaryImage?.documentId ?? null,
      primaryMediaDocumentVersionId: snapshot.primaryImage?.documentVersionId ?? null,
      createdAt: at,
    },
    select: { id: true },
  });
  await prisma.projectUnit.update({
    where: { id: unitId },
    data: { publicationStatus: "PUBLISHED", currentPublicationId: publication.id, hasUnpublishedChanges: false, publicationStatusChangedAt: at, version: { increment: 1 } },
  });
  return publication.id;
}

async function activity(prisma: PrismaClient, input: { unitId: string; action: string; message: string; memberId: string; userId: string; at: Date }) {
  await prisma.activity.create({
    data: { companyId: COMPANY_A, module: "projects", entityType: "ProjectUnit", entityId: input.unitId, action: input.action, message: input.message, actorMemberId: input.memberId, actorUserId: input.userId, metadata: { projectId: RIVERSIDE }, createdAt: input.at },
  });
}

/** Clears what this seed writes, so the structure seed can replace the units under it. */
export async function clearUnitPublishing(prisma: PrismaClient, projectIds: string[]) {
  const units = await prisma.projectUnit.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
  const unitIds = units.map((unit) => unit.id);
  if (unitIds.length === 0) return;
  await prisma.unitPublicationApproval.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.unitMedia.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.unitDocumentLink.deleteMany({ where: { unitId: { in: unitIds } } });
  await prisma.projectUnit.updateMany({ where: { id: { in: unitIds } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
  await prisma.unitPublication.deleteMany({ where: { unitId: { in: unitIds } } });
  const documents = await prisma.document.findMany({ where: { entityType: "project_unit", entityId: { in: unitIds } }, select: { id: true } });
  const documentIds = documents.map((document) => document.id);
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documentIds } } });
  await prisma.document.updateMany({ where: { id: { in: documentIds } }, data: { currentVersionId: null } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } });
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  await prisma.attentionItem.deleteMany({ where: { entityType: "project_unit", entityId: { in: unitIds } } });
  await prisma.activity.deleteMany({ where: { entityType: "ProjectUnit", entityId: { in: unitIds } } });
}

export async function seedUnitPublishingRecords(prisma: PrismaClient, memberId: Member) {
  const UNIT_IDS = { a101: STRUCTURE_SEED.units.a101, a104: STRUCTURE_SEED.units.a104, b101: STRUCTURE_SEED.units.b101 };
  const architect = memberId("user_architect");
  const manager = memberId("user_architecture_manager");
  const floorA1 = await prisma.projectUnit.findMany({ where: { floorId: STRUCTURE_SEED.floors.a1 }, orderBy: { sortOrder: "asc" }, select: { id: true, unitCode: true } });
  const byCode = new Map(floorA1.map((unit) => [unit.unitCode, unit.id]));
  const a102 = byCode.get("A-102")!;
  const a103 = byCode.get("A-103")!;

  const floorPlan = async (unitId: string, code: string, hue: string) => {
    const id = await unitFile(prisma, { id: `doc_unit_${code.toLowerCase().replace("-", "")}_plan_image`, unitId, name: `${code} floor plan.jpg`, bytes: await jpeg(floorPlanSvg(`${code} — floor plan`, hue)), memberId: architect, createdBy: "user_architect", uploaded: daysAgo(20) });
    await prisma.unitMedia.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, unitId, documentId: id, category: "FLOOR_PLAN_IMAGE", isPrimary: true, sortOrder: 1, createdByMemberId: architect, createdAt: daysAgo(20) } });
  };
  const salesPlan = async (unitId: string, code: string, days: number) => {
    const id = await unitFile(prisma, { id: `doc_unit_${code.toLowerCase().replace("-", "")}_sales_plan`, unitId, name: `${code} Sales Plan.pdf`, bytes: placeholderPdf(`${code} Sales Plan`), memberId: architect, createdBy: "user_architect", uploaded: daysAgo(days) });
    await prisma.projectUnit.update({ where: { id: unitId }, data: { salesPlanDocumentId: id } });
    return id;
  };

  /* A-101: published, current ----------------------------------------------- */
  await salesPlan(UNIT_IDS.a101, "A-101", 24);
  await floorPlan(UNIT_IDS.a101, "A-101", "#3b82a0");
  const render = await unitFile(prisma, { id: "doc_unit_a101_render", unitId: UNIT_IDS.a101, name: "Block A river view.jpg", bytes: await jpeg(renderSvg()), memberId: architect, createdBy: "user_architect", uploaded: daysAgo(19) });
  await prisma.unitMedia.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, unitId: UNIT_IDS.a101, documentId: render, category: "EXTERIOR_RENDER", caption: "Block A from the river", sortOrder: 2, createdByMemberId: architect } });
  const drawing = await unitFile(prisma, { id: "doc_unit_a101_electrical", unitId: UNIT_IDS.a101, name: "A-101 electrical layout.pdf", bytes: placeholderPdf("A-101 electrical layout"), memberId: architect, createdBy: "user_architect", uploaded: daysAgo(18) });
  await prisma.unitDocumentLink.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, unitId: UNIT_IDS.a101, documentId: drawing, category: "TECHNICAL_DRAWING", createdByMemberId: architect } });
  await publish(prisma, UNIT_IDS.a101, 1, manager, daysAgo(16));

  /* A-102: v2 current, with a submitted correction --------------------------- */
  await salesPlan(a102, "A-102", 30);
  await floorPlan(a102, "A-102", "#8a6f3b");
  await publish(prisma, a102, 1, manager, daysAgo(28));
  await prisma.projectUnit.update({ where: { id: a102 }, data: { balconyArea: new Prisma.Decimal("9.00"), outdoorArea: new Prisma.Decimal("9.00") } });
  await publish(prisma, a102, 2, manager, daysAgo(12));
  await prisma.projectUnit.update({ where: { id: a102 }, data: { saleableArea: new Prisma.Decimal("79.10"), hasUnpublishedChanges: true, version: { increment: 1 } } });
  await prisma.unitPublicationApproval.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, recordId: a102, submittedByMemberId: architect, submittedAt: daysAgo(2) } });

  /* A-103: waiting for review ------------------------------------------------- */
  await salesPlan(a103, "A-103", 6);
  await floorPlan(a103, "A-103", "#4f7a4a");
  await prisma.projectUnit.update({ where: { id: a103 }, data: { publicationStatus: "READY_FOR_PUBLISHING", publicationStatusChangedAt: daysAgo(1), version: { increment: 1 } } });
  await prisma.unitPublicationApproval.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, recordId: a103, submittedByMemberId: architect, submittedAt: daysAgo(1) } });

  /* A-104: sent back ------------------------------------------------------------- */
  await salesPlan(UNIT_IDS.a104, "A-104", 9);
  const reason = "The Sales Plan shows 138 m²; the saleable area is 142.30 m². Correct one of them and resubmit.";
  await prisma.unitPublicationApproval.create({ data: { companyId: COMPANY_A, projectId: RIVERSIDE, recordId: UNIT_IDS.a104, status: "RETURNED", submittedByMemberId: architect, submittedAt: daysAgo(8), decidedByMemberId: manager, decidedAt: daysAgo(7), decisionNote: reason } });
  await prisma.projectUnit.update({ where: { id: UNIT_IDS.a104 }, data: { publicationStatus: "REVISION_REQUIRED", revisionReason: reason, publicationStatusChangedAt: daysAgo(7), version: { increment: 1 } } });

  /* B-101: a draft on its way ------------------------------------------------------ */
  await salesPlan(UNIT_IDS.b101, "B-101", 3);

  /* Floor 2 of Block A: published, for Sales (E-05E) ---------------------------------- */
  const floorA2 = await prisma.projectUnit.findMany({ where: { floorId: "flr_riverside_a_2" }, orderBy: { sortOrder: "asc" }, select: { id: true, unitCode: true } });
  const hues = ["#3b6ea0", "#a0583b", "#5b8a3b", "#7a4f8a"];
  for (const [index, unit] of floorA2.entries()) {
    await salesPlan(unit.id, unit.unitCode, 40 - index);
    await floorPlan(unit.id, unit.unitCode, hues[index % hues.length]!);
    await publish(prisma, unit.id, 1, manager, daysAgo(35 - index));
  }

  const users = await prisma.companyMember.findMany({ where: { id: { in: [architect, manager] } }, select: { id: true, userId: true } });
  const userOf = new Map(users.map((row) => [row.id, row.userId]));
  const trail: Array<{ unitId: string; action: string; message: string; memberId: string; at: Date }> = [
    { unitId: UNIT_IDS.a101, action: "UNIT_SALES_PLAN_UPLOADED", message: "added the Sales Plan to A-101", memberId: architect, at: daysAgo(24) },
    { unitId: UNIT_IDS.a101, action: "UNIT_MEDIA_ADDED", message: "added the image “A-101 floor plan.jpg” to A-101", memberId: architect, at: daysAgo(20) },
    { unitId: UNIT_IDS.a101, action: "UNIT_SUBMITTED_FOR_PUBLISHING", message: "submitted A-101 for publishing", memberId: architect, at: daysAgo(17) },
    { unitId: UNIT_IDS.a101, action: "UNIT_PUBLISHED", message: "published A-101", memberId: manager, at: daysAgo(16) },
    { unitId: a102, action: "UNIT_PUBLISHED", message: "published A-102", memberId: manager, at: daysAgo(28) },
    { unitId: a102, action: "UNIT_PUBLISHED", message: "published A-102 as version 2", memberId: manager, at: daysAgo(12) },
    { unitId: a102, action: "UNIT_UPDATED", message: "updated A-102", memberId: architect, at: daysAgo(3) },
    { unitId: a102, action: "UNIT_SUBMITTED_FOR_PUBLISHING", message: "submitted the changes to A-102 for publishing", memberId: architect, at: daysAgo(2) },
    { unitId: a103, action: "UNIT_SUBMITTED_FOR_PUBLISHING", message: "submitted A-103 for publishing", memberId: architect, at: daysAgo(1) },
    { unitId: UNIT_IDS.a104, action: "UNIT_SUBMITTED_FOR_PUBLISHING", message: "submitted A-104 for publishing", memberId: architect, at: daysAgo(8) },
    { unitId: UNIT_IDS.a104, action: "UNIT_REVISION_REQUIRED", message: "asked for a revision of A-104", memberId: manager, at: daysAgo(7) },
    ...floorA2.map((unit, index) => ({ unitId: unit.id, action: "UNIT_PUBLISHED", message: `published ${unit.unitCode}`, memberId: manager, at: daysAgo(35 - index) })),
  ];
  for (const entry of trail) await activity(prisma, { ...entry, userId: userOf.get(entry.memberId)! });

  /* Company B: one published office, so isolation has something to hold on both sides. */
  const ownerB = memberId("user_owner_b");
  const munich = STRUCTURE_SEED.units.munichOffice1;
  const munichProject = STRUCTURE_SEED.companyBProject;
  const planB = await unitFile(prisma, { id: "doc_unit_of001_sales_plan", companyId: "company_fixture_tenant", unitId: munich, name: "OF-001 Sales Plan.pdf", bytes: placeholderPdf("OF-001 Sales Plan"), memberId: ownerB, createdBy: "user_owner_b", uploaded: daysAgo(10) });
  await prisma.projectUnit.update({ where: { id: munich }, data: { salesPlanDocumentId: planB } });
  const imageB = await unitFile(prisma, { id: "doc_unit_of001_plan_image", companyId: "company_fixture_tenant", unitId: munich, name: "OF-001 layout.jpg", bytes: await jpeg(floorPlanSvg("OF-001 — layout", "#6b5b95")), memberId: ownerB, createdBy: "user_owner_b", uploaded: daysAgo(10) });
  await prisma.unitMedia.create({ data: { companyId: "company_fixture_tenant", projectId: munichProject, unitId: munich, documentId: imageB, category: "FLOOR_PLAN_IMAGE", isPrimary: true, sortOrder: 1, createdByMemberId: ownerB } });
  const specB = await unitFile(prisma, { id: "doc_unit_of001_spec", companyId: "company_fixture_tenant", unitId: munich, name: "OF-001 fit-out specification.pdf", bytes: placeholderPdf("OF-001 fit-out specification"), memberId: ownerB, createdBy: "user_owner_b", uploaded: daysAgo(9) });
  await prisma.unitDocumentLink.create({ data: { companyId: "company_fixture_tenant", projectId: munichProject, unitId: munich, documentId: specB, category: "SPECIFICATION", createdByMemberId: ownerB } });
  await publish(prisma, munich, 1, ownerB, daysAgo(8), "company_fixture_tenant");

  return { published: 2 + floorA2.length, waiting: 2, revision: 1, files: await prisma.document.count({ where: { entityType: "project_unit" } }) };
}
