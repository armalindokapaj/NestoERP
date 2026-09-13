import { Prisma } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { fileTypeLabel, storageStatusMessage } from "@/lib/core/storage";
import { attachDocumentFromBytes } from "./storage/upload.service";
import { readDocumentBytes } from "./storage/download.service";
import * as repository from "./document.repository";
import type {
  CreateDocumentInput,
  DocumentListQuery,
  UpdateDocumentInput,
} from "./document.schema";
import type {
  DocumentActivityDTO,
  DocumentContextDTO,
  DocumentDetailDTO,
  DocumentOverviewStats,
  DocumentSummaryDTO,
} from "./document.types";

/**
 * Documents service (PRD #13 §131, §146).
 *
 * The security invariant this module exists to hold is permanent:
 *
 *   document permission + parent permission + parent record access
 *   + company isolation = document access
 *
 * A generic `document.view` never reaches a Finance or HR file, and archiving
 * never deletes a stored object (PRD #13 §4, §48, §112, §291).
 */

const MODULE = "documents" as const;
const ENTITY = "Document";

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listDocuments(context: UserContext, query: DocumentListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");

  const { rows, total } = await repository.listDocuments(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getDocument(
  context: UserContext,
  documentId: string,
): Promise<DocumentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");

  // A document whose parent this caller cannot reach answers "not found", so
  // the response cannot be used to discover that the file exists
  // (PRD #13 §149).
  const document = assertFound(await repository.findDocumentInScope(context, documentId));

  /*
   * Availability is a state, not a probe (PRD #29 §162, §233).
   *
   * This used to stat the object on every detail read, which answered a
   * slightly different question — "is there a file?" rather than "has this
   * file been verified?" — and cost a storage round trip to do it. The
   * lifecycle column carries the answer now.
   */
  return toDetailDTO(context, document, document.storageStatus === "AVAILABLE");
}

export async function getDocumentOverview(
  context: UserContext,
): Promise<DocumentOverviewStats> {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");
  return repository.documentOverviewStats(context);
}

export async function listRecent(context: UserContext, take = 6) {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");
  const rows = await repository.recentDocuments(context, take);
  return rows.map(toSummaryDTO);
}

export async function listMyUploads(context: UserContext, take = 6) {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");
  const rows = await repository.myRecentUploads(context, take);
  return rows.map(toSummaryDTO);
}

export async function listActivity(
  context: UserContext,
  documentId: string,
  options: { page: number; limit: number },
) {
  assertModule(context, MODULE);
  assertPermission(context, "document.activity.view");
  // Access is re-established before any history is shown (PRD #13 §118).
  assertFound(await repository.findDocumentInScope(context, documentId));

  const { rows, total } = await repository.listDocumentActivity(context, documentId, options);

  const data: DocumentActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, options.page, options.limit) };
}

/**
 * Reads a file for an authorised download (PRD #13 §18, §104).
 *
 * Everything is re-checked here — session, company, permission, parent access
 * and document state — because this is the point at which bytes leave the
 * system. There is no URL that skips it.
 */
export async function readDocumentFile(
  context: UserContext,
  documentId: string,
  options: { inline?: boolean } = {},
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string; disposition: string }> {
  return readDocumentBytes(context, documentId, options);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export type UploadPayload = {
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
};

/**
 * Stores a file the server already holds and creates the document that
 * describes it (PRD #13 §20, PRD #29 §233).
 *
 * A thin wrapper now. The whole upload pipeline — parent access, declared type
 * and size, quota, object write, HEAD verification, magic-byte detection,
 * checksum, scan gate — lives in `storage/upload.service.ts` and this path
 * runs every step of it. There is one definition of how a document becomes
 * available, and both entry points use it (PRD #29 §320).
 *
 * A browser upload does not come through here: it goes straight to storage
 * with a signed URL (PRD #29 §9, §389).
 */
export async function createDocument(
  context: UserContext,
  input: CreateDocumentInput,
  upload: UploadPayload,
): Promise<DocumentDetailDTO> {
  const { documentId } = await attachDocumentFromBytes(
    context,
    {
      name: input.name,
      description: input.description,
      context: input.context,
      projectId: input.projectId,
      clientId: input.clientId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: upload.fileName,
      mimeType: upload.mimeType ?? undefined,
    },
    upload.bytes,
  );

  return getDocument(context, documentId);
}

export async function updateDocument(
  context: UserContext,
  documentId: string,
  input: UpdateDocumentInput,
): Promise<DocumentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "document.update");

  const existing = assertFound(await repository.findDocumentInScope(context, documentId));

  // An archived document is read-only: it must be restored first (PRD #13 §113).
  if (isArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this document before editing it.");
  }

  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This document was updated by another user. Refresh and review the latest changes.",
    );
  }

  await prisma.$transaction(async (tx) => {
    // Metadata only. The stored object is immutable and the storage key never
    // moves when a display name changes (PRD #13 §108, §275, §276).
    await tx.document.update({
      where: { id: documentId },
      data: {
        name: input.name,
        description: input.description ?? null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: documentId,
      action: "DOCUMENT_UPDATED",
      message: "updated the document details",
      metadata: { documentId } as Prisma.InputJsonValue,
    });
  });

  return getDocument(context, documentId);
}

export async function archiveDocument(context: UserContext, documentId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "document.archive");

  const existing = assertFound(await repository.findDocumentInScope(context, documentId));
  if (isArchived(existing)) {
    throw new AccessError("CONFLICT", "This document is already archived.");
  }
  // Only a verified document can be archived. An upload still in flight has to
  // settle first, or its own pipeline would fight the archive for the same
  // column (PRD #29 §319, §321).
  if (existing.storageStatus !== "AVAILABLE") {
    throw new AccessError("CONFLICT", "This file is still being processed.");
  }

  await prisma.$transaction(async (tx) => {
    /*
     * Two states move together, and they mean different things (PRD #29 §135).
     *
     *   status        the business visibility state
     *   storageStatus the storage lifecycle
     *
     * Both have to change, because the storage lifecycle is what the download
     * and preview grants consult — an archived document whose storage state
     * still read AVAILABLE would leave its file downloadable after it left the
     * lists (PRD #29 §162, §319).
     *
     * `storageKey` is deliberately untouched. The object stays exactly where
     * it is: archive is never a deletion (PRD #29 §139).
     */
    await tx.document.update({
      where: { id: documentId },
      data: {
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
        storageStatus: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    // The binary stays: archiving is a lifecycle state, not a deletion
    // (PRD #13 §112, §115, §218).
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: documentId,
      action: "DOCUMENT_ARCHIVED",
      message: `archived ${existing.name}`,
      metadata: { documentId } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.DOCUMENT_ARCHIVED,
        entity: { type: ENTITY, id: documentId, label: existing.name },
        before: { status: existing.status, archivedAt: null },
        after: { status: "ARCHIVED" },
      },
      { tx },
    );
  });
}

export async function restoreDocument(context: UserContext, documentId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "document.restore");

  const existing = assertFound(await repository.findDocumentInScope(context, documentId));
  if (!isArchived(existing)) {
    throw new AccessError("CONFLICT", "This document is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        status: existing.preArchiveStatus ?? "ACTIVE",
        // Back to available, because the object was never removed and was
        // verified before it was archived (PRD #29 §137).
        storageStatus: "AVAILABLE",
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: documentId,
      action: "DOCUMENT_RESTORED",
      message: `restored ${existing.name}`,
      metadata: { documentId } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.DOCUMENT_RESTORED,
        entity: { type: ENTITY, id: documentId, label: existing.name },
        before: { status: "ARCHIVED" },
        after: { status: "ACTIVE", archivedAt: null },
      },
      { tx },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function isArchived(row: { status: string; archivedAt: Date | null }): boolean {
  return row.status === "ARCHIVED" || row.archivedAt !== null;
}

/* -------------------------------------------------------------------------- */
/* DTO mapping                                                                 */
/* -------------------------------------------------------------------------- */

function contextDTO(row: repository.DocumentSummaryRow): DocumentContextDTO {
  if (row.project) {
    return {
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      label: "Project",
      relatedRecordName: row.project.name,
      relatedRecordHref: `/projects/${row.project.id}`,
    };
  }

  if (row.client) {
    return {
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      label: "Client",
      relatedRecordName: row.client.name,
      relatedRecordHref: `/clients/${row.client.id}`,
    };
  }

  if (row.entityType === "task" && row.entityId) {
    return {
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      label: "Task",
      relatedRecordName: null,
      relatedRecordHref: `/tasks/${row.entityId}`,
    };
  }

  return {
    module: row.module,
    entityType: row.entityType,
    entityId: row.entityId,
    label: row.module ? moduleLabel(row.module) : "Company",
    relatedRecordName: null,
    relatedRecordHref: null,
  };
}

/** A readable context label, never a raw module key (PRD #13 §72). */
function moduleLabel(moduleKey: string): string {
  const words = moduleKey.replace(/[-_]/g, " ");
  if (moduleKey === "qaqc") return "QA/QC";
  if (moduleKey === "hse") return "HSE";
  if (moduleKey === "hr") return "HR";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function uploader(row: repository.DocumentSummaryRow) {
  if (!row.uploadedBy) return null;
  return {
    memberId: row.uploadedBy.id,
    fullName: `${row.uploadedBy.user.firstName} ${row.uploadedBy.user.lastName}`,
  };
}

export function toSummaryDTO(row: repository.DocumentSummaryRow): DocumentSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    originalFileName: row.originalFileName,
    extension: row.extension,
    typeLabel: fileTypeLabel(row.extension),
    mimeType: row.mimeType,
    // BigInt does not survive JSON, so it leaves as a string (PRD #13 §127).
    sizeBytes: row.sizeBytes === null ? null : row.sizeBytes.toString(),
    status: row.status,
    storageStatus: row.storageStatus,
    storageMessage: storageStatusMessage(row.storageStatus),
    context: contextDTO(row),
    uploadedBy: uploader(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetailDTO(
  context: UserContext,
  row: repository.DocumentDetailRow,
  available: boolean,
): DocumentDetailDTO {
  const archived = isArchived(row);
  const base = contextDTO(row);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    file: {
      originalFileName: row.originalFileName,
      extension: row.extension,
      typeLabel: fileTypeLabel(row.extension),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes === null ? null : row.sizeBytes.toString(),
      available,
      previewable: row.previewStatus === "READY",
      storageStatus: row.storageStatus,
      scanStatus: row.scanStatus,
      previewStatus: row.previewStatus,
      rejectionReason: row.rejectionReason,
      storageMessage: storageStatusMessage(row.storageStatus),
      checksum: row.checksum,
    },
    context: { ...base, project: row.project, client: row.client },
    uploadedBy: uploader(row),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canDownload: available && can(context, "document.download"),
      // Preview is the same authorisation as download; what narrows it is the
      // format, and only PDF and images qualify (PRD #29 §44, §105).
      canPreview: available && row.previewStatus === "READY" && can(context, "document.download"),
      canEdit: !archived && can(context, "document.update"),
      canArchive: !archived && can(context, "document.archive"),
      canRestore: archived && can(context, "document.restore"),
      canViewActivity: can(context, "document.activity.view"),
    },
  };
}
