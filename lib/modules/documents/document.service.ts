import { Prisma } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { can } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { buildStorageKey, documentStorage } from "@/lib/storage";
import {
  checkFile,
  fileTypeLabel,
  isPreviewable,
  sanitizeFileName,
} from "./document.files";
import {
  canAttachToDocumentParent,
  type DocumentParentRef,
} from "./document.parent-access";
import * as repository from "./document.repository";
import type {
  CreateDocumentInput,
  DocumentListQuery,
  DocumentRecordType,
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

  const available = document.storageKey
    ? await documentStorage().objectExists(document.storageKey)
    : false;

  return toDetailDTO(context, document, available);
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
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string; inline: boolean }> {
  assertModule(context, MODULE);
  assertPermission(context, "document.view");
  assertPermission(context, "document.download");

  const document = assertFound(await repository.findDocumentInScope(context, documentId));
  if (!document.storageKey) throw new AccessError("NOT_FOUND", "This document has no file.");

  const bytes = await documentStorage().get(document.storageKey);
  if (!bytes) {
    // The row survived its object. Say so plainly rather than exposing storage
    // internals (PRD #13 §116, §191).
    throw new AccessError("NOT_FOUND", "The file could not be retrieved.");
  }

  return {
    bytes,
    fileName: document.originalFileName ?? `${document.name}.${document.extension ?? "bin"}`,
    mimeType: document.mimeType ?? "application/octet-stream",
    // Only formats that cannot execute in the browser are ever shown inline
    // (PRD #13 §156, §157).
    inline: isPreviewable(document.extension),
  };
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
 * Stores a file and creates the document that describes it (PRD #13 §20, §96).
 *
 * The order matters. Permission and parent access are checked first, then the
 * file is validated, then the object is written, and only then is the row
 * created. If the row fails, the orphan object is removed — a Document must
 * never exist without its file, and a file must not linger without a Document
 * (PRD #13 §21, §96, §97).
 */
export async function createDocument(
  context: UserContext,
  input: CreateDocumentInput,
  upload: UploadPayload,
): Promise<DocumentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "document.create");

  const ref = await resolveParent(context, input);

  if (!(await canAttachToDocumentParent(context, ref))) {
    throw new AccessError("FORBIDDEN", "You cannot add documents to that record.");
  }

  const check = checkFile({
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    sizeBytes: upload.bytes.byteLength,
  });
  if (!check.ok) {
    throw new AccessError(
      check.code === "FILE_TOO_LARGE" ? "VALIDATION_ERROR" : "VALIDATION_ERROR",
      check.message,
    );
  }

  const storage = documentStorage();
  const documentId = generateDocumentId();
  const safeName = sanitizeFileName(upload.fileName);
  const storageKey = buildStorageKey(context.companyId, documentId, safeName);

  const stored = await storage.put(storageKey, upload.bytes);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          companyId: context.companyId,
          name: input.name,
          description: input.description ?? null,
          originalFileName: upload.fileName,
          fileName: safeName,
          extension: check.extension,
          storageProvider: storage.provider,
          storageKey: stored.storageKey,
          mimeType: upload.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          checksum: stored.checksum,
          projectId: ref.projectId,
          clientId: ref.clientId,
          module: ref.module,
          entityType: ref.entityType,
          entityId: ref.entityId,
          status: "ACTIVE",
          uploadedByMemberId: context.membershipId,
          createdBy: context.userId,
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: documentId,
        action: "DOCUMENT_UPLOADED",
        message: `added ${input.name}`,
        // Never a signed URL or a storage credential (PRD #13 §122).
        metadata: {
          documentId,
          fileName: safeName,
          projectId: ref.projectId,
          clientId: ref.clientId,
        } as Prisma.InputJsonValue,
      });
    });
  } catch (error) {
    await storage.deleteObject(storageKey).catch(() => undefined);
    throw error;
  }

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

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: {
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
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
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function isArchived(row: { status: string; archivedAt: Date | null }): boolean {
  return row.status === "ARCHIVED" || row.archivedAt !== null;
}

/** Ids are generated here so the storage key can contain one (PRD #13 §16). */
function generateDocumentId(): string {
  return `doc_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Turns a create request into a parent reference, validating the record it
 * names belongs to this company.
 *
 * The context chosen in the form is not trusted: a project id from another
 * company, or one this caller cannot open, is refused here rather than being
 * written and hidden later (PRD #13 §91, §236).
 */
async function resolveParent(
  context: UserContext,
  input: CreateDocumentInput,
): Promise<DocumentParentRef> {
  if (input.context === "project") {
    // Looked up inside the caller's own scope, so a project they cannot reach
    // reads as "does not exist" rather than being confirmed to them.
    const project = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: input.projectId! }] },
      select: { id: true, clientId: true },
    });
    if (!project) throw new AccessError("VALIDATION_ERROR", "That project does not exist.");
    return {
      projectId: project.id,
      clientId: null,
      module: "projects",
      entityType: "project",
      entityId: project.id,
    };
  }

  if (input.context === "client") {
    const client = await prisma.client.findFirst({
      where: { AND: [buildClientScopeWhere(context), { id: input.clientId! }] },
      select: { id: true },
    });
    if (!client) throw new AccessError("VALIDATION_ERROR", "That client does not exist.");
    return {
      projectId: null,
      clientId: client.id,
      module: "clients",
      entityType: "client",
      entityId: client.id,
    };
  }

  if (input.context === "record") {
    /*
     * A document filed against a module's own record (PRD #15 §187).
     *
     * The parent is not looked up here: `canAttachToDocumentParent` runs the
     * registered resolver for this entity type, which reads the record through
     * *its* module's scope. One place decides reachability, so a record type
     * added later cannot quietly acquire a second interpretation.
     */
    return {
      projectId: null,
      clientId: null,
      module: MODULE_FOR_RECORD[input.entityType!],
      entityType: input.entityType!,
      entityId: input.entityId!,
    };
  }

  return { projectId: null, clientId: null, module: null, entityType: null, entityId: null };
}

/** Which module owns each record type a document can be filed against. */
const MODULE_FOR_RECORD: Record<DocumentRecordType, string> = {
  task: "tasks",
  invoice: "finance",
  expense: "finance",
  budget: "finance",
  commitment: "finance",
};

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
      previewable: available && isPreviewable(row.extension),
    },
    context: { ...base, project: row.project, client: row.client },
    uploadedBy: uploader(row),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: {
      canDownload: available && can(context, "document.download"),
      canEdit: !archived && can(context, "document.update"),
      canArchive: !archived && can(context, "document.archive"),
      canRestore: archived && can(context, "document.restore"),
      canViewActivity: can(context, "document.activity.view"),
    },
  };
}
