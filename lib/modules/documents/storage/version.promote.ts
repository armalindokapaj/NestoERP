import type { Prisma } from "@prisma/client";

import { assertTransition, StorageError } from "@/lib/core/storage";

/**
 * Why this document's current file may not be replaced right now, or null
 * (PRD #46 §69, §123, PRD #47 §85, §86).
 *
 * A file carried by a submitted engineering revision or an issued transmittal
 * is part of that record. Asked when a version upload opens — and asked again
 * inside the transaction that would make a new version current, because a
 * revision can be submitted while the upload is still in flight: the check at
 * the door is not the check at the moment of the swap.
 */
export async function frozenFileReason(documentId: string): Promise<string | null> {
  const { frozenDocumentReason } = await import("@/lib/modules/engineering/engineering.revisions");
  return frozenDocumentReason(documentId);
}

/**
 * Makes a verified version the one the document serves (PRD #38 §57, §65).
 *
 * The document's file columns are a mirror of its current version, rewritten
 * here in one statement with the pointer; the previous version keeps its own
 * row, key and object.
 *
 * An archived document stays archived. Its storage state is what the download
 * and preview grants consult, so a version finishing its scan after the
 * document was archived must not quietly make it downloadable again
 * (PRD #29 §162, §319).
 *
 * That is only true if the archive cannot land between reading the document
 * and writing it, so the document row is locked first. An archive or restore
 * arriving meanwhile waits for the promotion and then applies to the file it
 * made current, rather than being undone by a write computed from what the
 * document held a moment before (PRD #49 §246, §247).
 */
export async function promoteVersion(tx: Prisma.TransactionClient, versionId: string): Promise<void> {
  const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
  await tx.$queryRaw`SELECT id FROM "documents" WHERE id = ${version.documentId} FOR UPDATE`;
  const document = await tx.document.findUniqueOrThrow({
    where: { id: version.documentId },
    select: { status: true, archivedAt: true, storageStatus: true },
  });
  const archived = document.status === "ARCHIVED" || document.archivedAt !== null;
  const storageStatus = archived ? "ARCHIVED" : "AVAILABLE";
  // Swapping the file is not a storage transition, so only a document whose
  // state would change asks the table — and a live one never needs to.
  if (document.storageStatus !== storageStatus) assertTransition(document.storageStatus, storageStatus);

  // The storage state read under the lock is the guard: nothing else can have
  // moved it, and the write says so rather than relying on it.
  const promoted = await tx.document.updateMany({
    where: { id: version.documentId, storageStatus: document.storageStatus },
    data: {
      currentVersionId: version.id,
      storageProvider: version.storageProvider,
      storageBucket: version.storageBucket,
      storageKey: version.storageKey,
      originalFileName: version.originalFileName,
      fileName: version.fileName,
      extension: version.extension,
      mimeType: version.mimeTypeDeclared,
      detectedMimeType: version.mimeTypeDetected,
      sizeBytes: version.sizeBytes,
      checksum: version.checksumSha256,
      storageStatus,
      scanStatus: version.scanStatus,
      scanProvider: version.scanProvider,
      scanCompletedAt: version.scanCompletedAt,
      previewStatus: version.previewStatus,
      previewMimeType: version.previewMimeType,
      previewStorageKey: null,
      thumbnailStorageKey: null,
      availableAt: version.availableAt ?? new Date(),
      verifiedAt: new Date(),
      uploadedAt: version.createdAt,
      rejectedAt: null,
      rejectionReason: null,
    },
  });
  if (promoted.count === 0) throw new StorageError("INVALID_DOCUMENT_STORAGE_STATE");
}
