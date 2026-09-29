import { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere, canAttachToDocumentParent, findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { recordActivity } from "@/lib/modules/shared/activity";
import { assertSameSet, uniqueTarget } from "./structure.buildings";
import { MODULE, UNIT_ENTITY } from "./structure.permissions";
import { fail, findReadableUnit } from "./structure.service";
import { isPdf, isUnitImage } from "./unit-publishing.rules";
import { lockUnit, refreshUnpublishedChanges } from "./unit-publishing.state";
import {
  MAX_UNIT_MEDIA,
  type AttachableDocumentDTO,
  type UnitDocumentCategory,
  type UnitDocumentLinkDTO,
  type UnitFileDTO,
  type UnitFilesDTO,
  type UnitMediaCategory,
  type UnitMediaDTO,
} from "./unit-publishing.types";

/**
 * A unit's files (E-05D §33-§44, §63, §64, §75-§78, §88, §100).
 *
 * Nothing here stores a file. The Sales Plan, drawings and images are canonical
 * Documents — uploaded through the Documents pipeline with the unit as their
 * parent, or already filed on the unit's project — and the unit keeps only how
 * each one sits on it: the Sales Plan pointer, a document's category, an image's
 * category, caption, order and whether it is the primary one. A file is listed
 * only when the reader may open it through the Documents module (§88, §102).
 */

type Tx = Prisma.TransactionClient;
export const UNIT_RECORD_TYPE = "project_unit";

const FILE_SELECT = {
  id: true,
  name: true,
  originalFileName: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  storageStatus: true,
  status: true,
  currentVersionId: true,
  createdAt: true,
  entityType: true,
  entityId: true,
  projectId: true,
  // Who uploaded it, shown on every file (user, 2026-09-29).
  uploadedByMemberId: true,
  uploadedBy: { select: { user: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.DocumentSelect;

type FileRow = Prisma.DocumentGetPayload<{ select: typeof FILE_SELECT }>;

function toFile(row: FileRow, versionNumbers: Map<string, number>): UnitFileDTO {
  return {
    documentId: row.id,
    name: row.name,
    fileName: row.originalFileName,
    mimeType: row.mimeType,
    extension: row.extension,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    storageStatus: row.storageStatus,
    archived: row.status === "ARCHIVED",
    versionNumber: row.currentVersionId ? (versionNumbers.get(row.currentVersionId) ?? null) : null,
    uploadedAt: row.createdAt.toISOString(),
    uploadedByMemberId: row.uploadedByMemberId,
    uploadedBy: row.uploadedBy ? `${row.uploadedBy.user.firstName} ${row.uploadedBy.user.lastName}` : null,
    href: `/documents/${row.id}`,
  };
}

function filesOpen(context: UserContext): boolean {
  return canAccessModule(context, "documents") && can(context, "document.view");
}

async function versionNumbersOf(rows: FileRow[]): Promise<Map<string, number>> {
  const ids = rows.map((row) => row.currentVersionId).filter((id): id is string => Boolean(id));
  if (!ids.length) return new Map();
  const versions = await prisma.documentVersion.findMany({ where: { id: { in: ids } }, select: { id: true, versionNumber: true } });
  return new Map(versions.map((version) => [version.id, version.versionNumber]));
}

/* Reading ------------------------------------------------------------------- */

export async function listUnitFiles(context: UserContext, unitId: string): Promise<UnitFilesDTO> {
  const unit = await findReadableUnit(context, unitId);
  const canManageDocuments = can(context, "project.unit.documents.manage");
  const canManageMedia = can(context, "project.unit.media.manage");
  const empty: UnitFilesDTO = { visible: false, salesPlan: null, salesPlanHidden: false, documents: [], media: [], unfiled: [], capabilities: { canManageDocuments: false, canManageMedia: false, canUpload: false, canUploadVersion: false } };
  if (!filesOpen(context)) return empty;

  const access = await buildDocumentAccessWhere(context);
  const readable: Prisma.DocumentWhereInput = { AND: [access, { companyId: context.companyId }] };
  const pointer = await prisma.projectUnit.findFirst({ where: { companyId: context.companyId, id: unit.id }, select: { salesPlanDocumentId: true } });
  const [salesPlan, links, media, owned, canUpload] = await Promise.all([
    pointer?.salesPlanDocumentId ? prisma.document.findFirst({ where: { AND: [readable, { id: pointer.salesPlanDocumentId }] }, select: FILE_SELECT }) : null,
    prisma.unitDocumentLink.findMany({
      where: { companyId: context.companyId, unitId: unit.id, document: { is: readable } },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      select: { id: true, category: true, createdAt: true, document: { select: FILE_SELECT } },
    }),
    prisma.unitMedia.findMany({
      where: { companyId: context.companyId, unitId: unit.id, document: { is: readable } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, category: true, caption: true, isPrimary: true, sortOrder: true, document: { select: FILE_SELECT } },
    }),
    prisma.document.findMany({ where: { AND: [readable, { entityType: UNIT_RECORD_TYPE, entityId: unit.id }] }, orderBy: { createdAt: "desc" }, take: 100, select: FILE_SELECT }),
    canAttachToDocumentParent(context, { projectId: null, clientId: null, module: MODULE, entityType: UNIT_RECORD_TYPE, entityId: unit.id }),
  ]);

  const referenced = new Set([pointer?.salesPlanDocumentId, ...links.map((link) => link.document.id), ...media.map((item) => item.document.id)]);
  const unfiled = owned.filter((row) => !referenced.has(row.id) && row.status === "ACTIVE");
  const versions = await versionNumbersOf([...(salesPlan ? [salesPlan] : []), ...links.map((link) => link.document), ...media.map((item) => item.document), ...unfiled]);

  return {
    visible: true,
    salesPlan: salesPlan ? toFile(salesPlan, versions) : null,
    salesPlanHidden: Boolean(pointer?.salesPlanDocumentId) && !salesPlan,
    documents: links.map((link): UnitDocumentLinkDTO => ({ id: link.id, category: link.category, attachedAt: link.createdAt.toISOString(), document: toFile(link.document, versions) })),
    media: media.map(
      (item): UnitMediaDTO => ({
        id: item.id,
        category: item.category,
        caption: item.caption,
        isPrimary: item.isPrimary,
        sortOrder: item.sortOrder,
        document: toFile(item.document, versions),
        thumbnailHref: item.document.storageStatus === "AVAILABLE" && item.document.status === "ACTIVE" ? `/api/project-units/${unit.id}/media/${item.id}/thumbnail` : null,
      }),
    ),
    unfiled: unfiled.map((row) => toFile(row, versions)),
    capabilities: {
      canManageDocuments,
      canManageMedia,
      canUpload: canUpload && (canManageDocuments || canManageMedia),
      canUploadVersion: canUpload && canManageDocuments && can(context, "document.update"),
    },
  };
}

/**
 * Files the reader may attach to this unit (§63): uploaded against it, or filed
 * on its project — the floor plan every unit of a type shares is one document,
 * attached to each of them, never copied.
 */
export async function listAttachableDocuments(context: UserContext, unitId: string, query: { q?: string; kind: "document" | "image" }): Promise<AttachableDocumentDTO[]> {
  const unit = await findReadableUnit(context, unitId);
  if (!filesOpen(context)) return [];
  const access = await buildDocumentAccessWhere(context);
  const q = query.q?.trim();
  const rows = await prisma.document.findMany({
    where: {
      AND: [
        access,
        { companyId: context.companyId, status: "ACTIVE", storageStatus: "AVAILABLE" },
        { OR: [{ entityType: UNIT_RECORD_TYPE, entityId: unit.id }, { projectId: unit.projectId }] },
        query.kind === "image" ? { mimeType: { in: ["image/jpeg", "image/png", "image/webp"] } } : {},
        q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { originalFileName: { contains: q, mode: "insensitive" } }] } : {},
        query.kind === "image" ? { unitMedia: { none: { unitId: unit.id } } } : { unitLinks: { none: { unitId: unit.id } } },
        { salesPlanForUnit: { is: null } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, name: true, originalFileName: true, mimeType: true, entityType: true, entityId: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, fileName: row.originalFileName, mimeType: row.mimeType, onUnit: row.entityType === UNIT_RECORD_TYPE && row.entityId === unit.id }));
}

/* Eligibility ---------------------------------------------------------------- */

type Unit = Awaited<ReturnType<typeof findReadableUnit>>;

/**
 * A document this reader may open, filed on this unit or its project, active and
 * available (§63, §117). Another company's, an unreadable one and a missing one
 * are the same refusal; a real document on another project is named as such.
 */
async function eligibleDocument(context: UserContext, unit: Unit, documentId: string, field = "documentId") {
  const document = await findReadableDocument(context, documentId);
  if (!document) throw invalidRecordLink(field, "CROSS_COMPANY_REFERENCE", "Choose a document you can open.");
  const onUnit = document.entityType === UNIT_RECORD_TYPE && document.entityId === unit.id;
  if (!onUnit && document.projectId !== unit.projectId) throw invalidRecordLink(field, "CROSS_PROJECT_REFERENCE", "Choose a document of this unit or its project.");
  if (document.status !== "ACTIVE") throw new AccessError("VALIDATION_ERROR", "That document is archived.", { [field]: ["That document is archived."] });
  if (document.storageStatus !== "AVAILABLE") throw new AccessError("VALIDATION_ERROR", "That file is still being checked. Try again in a moment.", { [field]: ["That file is still being checked."] });
  const file = await prisma.document.findFirst({ where: { companyId: context.companyId, id: document.id }, select: { mimeType: true, extension: true, currentVersionId: true, name: true } });
  return { ...document, ...file!, onUnit };
}

/* Documents (§37-§39, §63) ---------------------------------------------------- */

export async function attachUnitDocument(context: UserContext, unitId: string, input: { documentId: string; category: UnitDocumentCategory }): Promise<{ id: string }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.documents.manage");
  const document = await eligibleDocument(context, unit, input.documentId);

  return runInTransaction("structure.unit.document.attach", async (tx) => {
    const pointer = await tx.projectUnit.findFirst({ where: { companyId: context.companyId, id: unit.id }, select: { salesPlanDocumentId: true } });
    if (pointer?.salesPlanDocumentId === document.id) throw fail("UNIT_DOCUMENT_IS_SALES_PLAN", "That document is already this unit's Sales Plan.", "CONFLICT");
    const link = await tx.unitDocumentLink.create({
      data: { companyId: context.companyId, projectId: unit.projectId, unitId: unit.id, documentId: document.id, category: input.category, createdByMemberId: context.membershipId },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_DOCUMENT_ATTACHED", message: `attached “${document.name}” to ${unit.unitCode}`, metadata: { projectId: unit.projectId, documentId: document.id, category: input.category } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_UNIT_DOCUMENT_LINKED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, after: { documentId: document.id, documentName: document.name, category: input.category } }, { tx });
    return link;
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("UNIT_DOCUMENT_ALREADY_ATTACHED", "That document is already attached to this unit.", "CONFLICT");
    throw error;
  });
}

export async function detachUnitDocument(context: UserContext, unitId: string, linkId: string): Promise<void> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.documents.manage");
  const link = await prisma.unitDocumentLink.findFirst({ where: { companyId: context.companyId, unitId: unit.id, id: linkId }, select: { id: true, category: true, document: { select: { id: true, name: true } } } });
  if (!link) throw fail("UNIT_DOCUMENT_NOT_FOUND", "That document is not attached to this unit.", "NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    // The file stays where it is; only this unit stops pointing at it (§39, §100).
    await tx.unitDocumentLink.deleteMany({ where: { companyId: context.companyId, unitId: unit.id, id: link.id } });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_DOCUMENT_REMOVED", message: `removed “${link.document.name}” from ${unit.unitCode}`, metadata: { projectId: unit.projectId, documentId: link.document.id } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_UNIT_DOCUMENT_UNLINKED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: { documentId: link.document.id, documentName: link.document.name, category: link.category } }, { tx });
  });
}

/* The Sales Plan (§33-§36, §78) -------------------------------------------- */

/**
 * Makes a PDF uploaded against this unit its Sales Plan — or, called again after
 * a new version of that same document was uploaded, records the new version
 * (§36). A unit has one logical Sales Plan: a second, different document is
 * refused with the way forward, which is a new version of the first (§78).
 */
export async function setUnitSalesPlan(context: UserContext, unitId: string, input: { documentId: string }): Promise<{ documentId: string; versionNumber: number | null; changed: boolean }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.documents.manage");
  const document = await eligibleDocument(context, unit, input.documentId);
  if (!document.onUnit) throw invalidRecordLink("documentId", "CROSS_PROJECT_REFERENCE", "Upload the Sales Plan to this unit.");
  if (!isPdf(document.mimeType, document.extension)) throw new AccessError("VALIDATION_ERROR", "The Sales Plan must be a PDF.", { documentId: ["The Sales Plan must be a PDF."] });

  return runInTransaction("structure.unit.sales_plan", async (tx) => {
    await lockUnit(tx, unit.id);
    const row = await tx.projectUnit.findFirst({ where: { companyId: context.companyId, id: unit.id }, select: { salesPlanDocumentId: true } });
    const first = !row?.salesPlanDocumentId;
    if (!first && row?.salesPlanDocumentId !== document.id) {
      throw fail("UNIT_SALES_PLAN_EXISTS", "This unit already has a Sales Plan. Upload the new file as a new version of it.", "CONFLICT");
    }
    const version = document.currentVersionId ? await tx.documentVersion.findFirst({ where: { companyId: context.companyId, id: document.currentVersionId }, select: { id: true, versionNumber: true } }) : null;

    if (first) {
      await tx.projectUnit.updateMany({ where: { companyId: context.companyId, id: unit.id, salesPlanDocumentId: null }, data: { salesPlanDocumentId: document.id, updatedBy: context.userId } });
      // A PDF attached as a plain document becomes the Sales Plan, never both.
      await tx.unitDocumentLink.deleteMany({ where: { companyId: context.companyId, unitId: unit.id, documentId: document.id } });
    } else {
      // Called again for the same version — a retried request — records nothing twice.
      const last = await tx.activity.findFirst({
        where: { companyId: context.companyId, entityType: UNIT_ENTITY, entityId: unit.id, action: { in: ["UNIT_SALES_PLAN_UPLOADED", "UNIT_SALES_PLAN_VERSION_ADDED"] } },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      const recorded = (last?.metadata as { documentVersionId?: string } | null)?.documentVersionId;
      if (recorded && recorded === version?.id) return { documentId: document.id, versionNumber: version?.versionNumber ?? null, changed: false };
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: UNIT_ENTITY,
      entityId: unit.id,
      action: first ? "UNIT_SALES_PLAN_UPLOADED" : "UNIT_SALES_PLAN_VERSION_ADDED",
      message: first ? `added the Sales Plan to ${unit.unitCode}` : `uploaded Sales Plan version ${version?.versionNumber ?? "?"} for ${unit.unitCode}`,
      metadata: { projectId: unit.projectId, documentId: document.id, documentVersionId: version?.id ?? null, versionNumber: version?.versionNumber ?? null },
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_SALES_PLAN_CHANGED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode },
        projectId: unit.projectId,
        before: first ? { documentId: null } : { documentId: document.id },
        after: { documentId: document.id, documentVersionId: version?.id ?? null, versionNumber: version?.versionNumber ?? null },
      },
      { tx },
    );
    await refreshUnpublishedChanges(tx, context.companyId, [unit.id]);
    return { documentId: document.id, versionNumber: version?.versionNumber ?? null, changed: true };
  });
}

/* Media (§40-§44, §64, §75, §76) --------------------------------------------- */

async function mediaEvidence(tx: Tx, context: UserContext, unit: Unit, input: { change: string; message: string; action: string; after: Record<string, unknown>; before?: Record<string, unknown> }) {
  await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: input.action, message: input.message, metadata: { projectId: unit.projectId, ...(input.after.documentId ? { documentId: input.after.documentId as string } : {}) } });
  await recordUserAction(
    context,
    { actionKey: AuditAction.PROJECT_UNIT_MEDIA_CHANGED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: input.before, after: { change: input.change, ...input.after } },
    { tx },
  );
}

/** Adds an image. The unit's first image becomes its primary one (§42). */
export async function addUnitMedia(context: UserContext, unitId: string, input: { documentId: string; category: UnitMediaCategory; caption: string | null }): Promise<{ id: string; isPrimary: boolean }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.media.manage");
  const document = await eligibleDocument(context, unit, input.documentId);
  if (!isUnitImage(document.mimeType)) throw new AccessError("VALIDATION_ERROR", "Unit media must be a JPEG, PNG or WebP image.", { documentId: ["Unit media must be a JPEG, PNG or WebP image."] });

  return runInTransaction("structure.unit.media.add", async (tx) => {
    await lockUnit(tx, unit.id);
    const [count, last, primary] = await Promise.all([
      tx.unitMedia.count({ where: { companyId: context.companyId, unitId: unit.id } }),
      tx.unitMedia.aggregate({ where: { companyId: context.companyId, unitId: unit.id }, _max: { sortOrder: true } }),
      tx.unitMedia.count({ where: { companyId: context.companyId, unitId: unit.id, isPrimary: true } }),
    ]);
    if (count >= MAX_UNIT_MEDIA) throw fail("UNIT_MEDIA_LIMIT", `A unit holds at most ${MAX_UNIT_MEDIA} images.`, "VALIDATION_ERROR");
    const media = await tx.unitMedia.create({
      data: {
        companyId: context.companyId,
        projectId: unit.projectId,
        unitId: unit.id,
        documentId: document.id,
        category: input.category,
        caption: input.caption,
        isPrimary: primary === 0,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, isPrimary: true },
    });
    await mediaEvidence(tx, context, unit, { change: "ADDED", action: "UNIT_MEDIA_ADDED", message: `added the image “${document.name}” to ${unit.unitCode}`, after: { mediaId: media.id, documentId: document.id, category: input.category, caption: input.caption, isPrimary: media.isPrimary } });
    if (media.isPrimary) await refreshUnpublishedChanges(tx, context.companyId, [unit.id]);
    return media;
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("UNIT_MEDIA_ALREADY_ADDED", "That image is already on this unit.", "CONFLICT");
    throw error;
  });
}

async function findMedia(context: UserContext, unitId: string, mediaId: string) {
  const media = await prisma.unitMedia.findFirst({
    where: { companyId: context.companyId, unitId, id: mediaId },
    select: { id: true, category: true, caption: true, isPrimary: true, documentId: true, document: { select: { name: true, status: true, storageStatus: true } } },
  });
  if (!media) throw fail("UNIT_MEDIA_NOT_FOUND", "That image is not on this unit.", "NOT_FOUND");
  return media;
}

/**
 * Changes an image's category or caption, or makes it the primary image. The old
 * primary is cleared and the new one set in one transaction; the partial unique
 * index is the last word when two people choose at once (§76).
 */
export async function updateUnitMedia(context: UserContext, unitId: string, mediaId: string, input: { category?: UnitMediaCategory; caption?: string | null; isPrimary?: true }): Promise<void> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.media.manage");
  const media = await findMedia(context, unit.id, mediaId);
  if (input.category === undefined && input.caption === undefined && !input.isPrimary) throw new AccessError("VALIDATION_ERROR", "Nothing to change.");
  if (input.isPrimary && (media.document.status !== "ACTIVE" || media.document.storageStatus !== "AVAILABLE")) {
    throw fail("UNIT_MEDIA_UNAVAILABLE", "That image is archived or still being checked, so it cannot be the primary image.", "VALIDATION_ERROR");
  }

  await runInTransaction("structure.unit.media.update", async (tx) => {
    await lockUnit(tx, unit.id);
    const details: Prisma.UnitMediaUpdateManyMutationInput = {};
    if (input.category !== undefined) details.category = input.category;
    if (input.caption !== undefined) details.caption = input.caption;
    if (Object.keys(details).length) {
      await tx.unitMedia.updateMany({ where: { companyId: context.companyId, unitId: unit.id, id: media.id }, data: details });
      await mediaEvidence(tx, context, unit, {
        change: "UPDATED",
        action: "UNIT_MEDIA_UPDATED",
        message: `updated the image “${media.document.name}” on ${unit.unitCode}`,
        before: { mediaId: media.id, category: media.category, caption: media.caption },
        after: { mediaId: media.id, documentId: media.documentId, category: input.category ?? media.category, caption: input.caption === undefined ? media.caption : input.caption },
      });
    }
    if (input.isPrimary && !media.isPrimary) {
      await tx.unitMedia.updateMany({ where: { companyId: context.companyId, unitId: unit.id, isPrimary: true }, data: { isPrimary: false } });
      await tx.unitMedia.updateMany({ where: { companyId: context.companyId, unitId: unit.id, id: media.id }, data: { isPrimary: true } });
      await mediaEvidence(tx, context, unit, { change: "PRIMARY", action: "UNIT_PRIMARY_MEDIA_CHANGED", message: `made “${media.document.name}” the primary image of ${unit.unitCode}`, after: { mediaId: media.id, documentId: media.documentId, isPrimary: true } });
      await refreshUnpublishedChanges(tx, context.companyId, [unit.id]);
    }
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("UNIT_MEDIA_PRIMARY_CONFLICT", "Somebody else just chose the primary image. Refresh and try again.", "CONFLICT");
    throw error;
  });
}

/** Removes an image from the unit; the file stays in Documents (§44). A removed primary leaves the unit without one until another is chosen. */
export async function removeUnitMedia(context: UserContext, unitId: string, mediaId: string): Promise<void> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.media.manage");
  const media = await findMedia(context, unit.id, mediaId);

  await runInTransaction("structure.unit.media.remove", async (tx) => {
    await lockUnit(tx, unit.id);
    await tx.unitMedia.deleteMany({ where: { companyId: context.companyId, unitId: unit.id, id: media.id } });
    await mediaEvidence(tx, context, unit, { change: "REMOVED", action: "UNIT_MEDIA_REMOVED", message: `removed the image “${media.document.name}” from ${unit.unitCode}`, before: { mediaId: media.id, documentId: media.documentId, category: media.category, isPrimary: media.isPrimary }, after: { mediaId: media.id, documentId: media.documentId } });
    if (media.isPrimary) await refreshUnpublishedChanges(tx, context.companyId, [unit.id]);
  });
}

/** The order images are shown in (§43): every image of the unit, named once. */
export async function reorderUnitMedia(context: UserContext, unitId: string, ids: string[]): Promise<void> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.media.manage");

  await runInTransaction("structure.unit.media.reorder", async (tx) => {
    await lockUnit(tx, unit.id);
    const rows = await tx.unitMedia.findMany({ where: { companyId: context.companyId, unitId: unit.id }, orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
    assertSameSet(rows.map((row) => row.id), ids);
    const current = new Map(rows.map((row) => [row.id, row.sortOrder]));
    for (const [index, id] of ids.entries()) {
      if (current.get(id) === index + 1) continue;
      await tx.unitMedia.updateMany({ where: { companyId: context.companyId, unitId: unit.id, id }, data: { sortOrder: index + 1 } });
    }
    await mediaEvidence(tx, context, unit, { change: "REORDERED", action: "UNIT_MEDIA_REORDERED", message: `reordered the images of ${unit.unitCode}`, before: { order: rows.map((row) => row.id) }, after: { order: ids } });
  });
}

/** The document behind one of the unit's images, for its thumbnail — after the unit's own door (§88). */
export async function unitMediaDocumentId(context: UserContext, unitId: string, mediaId: string): Promise<string> {
  const unit = await findReadableUnit(context, unitId);
  const media = await findMedia(context, unit.id, mediaId);
  return media.documentId;
}
