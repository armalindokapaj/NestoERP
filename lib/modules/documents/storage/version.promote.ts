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
 * Takes the lock every swap of a document's file queues behind (PRD #49 §246,
 * §247).
 *
 * Whatever decides whether a version may become current — the freeze a
 * submitted revision puts on the file, the version already current — is read
 * after this, inside the transaction that makes the swap. Read before it, the
 * answer can be out of date by the time the swap lands.
 */
export async function lockDocumentForSwap(tx: Prisma.TransactionClient, documentId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "documents" WHERE id = ${documentId} FOR UPDATE`;
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
 *
 * A version never replaces a newer one. Versions finish in any order — a
 * version whose scan errored is retried later, by which time the next upload
 * may have been scanned and made current — and "last to finish wins" would
 * put the older file back in front of everybody (PRD #51 §95, §193). Such a
 * version stays in the history, available, and false says it was not made
 * current.
 */
export async function promoteVersion(tx: Prisma.TransactionClient, versionId: string): Promise<boolean> {
  const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
  await lockDocumentForSwap(tx, version.documentId);
  const document = await tx.document.findUniqueOrThrow({
    where: { id: version.documentId },
    select: { status: true, archivedAt: true, storageStatus: true, currentVersionId: true },
  });
  if (document.currentVersionId && document.currentVersionId !== version.id) {
    const current = await tx.documentVersion.findUnique({ where: { id: document.currentVersionId }, select: { versionNumber: true } });
    if (current && current.versionNumber > version.versionNumber) return false;
  }
  const archived = document.status === "ARCHIVED" || document.archivedAt !== null;
  const storageStatus = archived ? "ARCHIVED" : "AVAILABLE";
  // Swapping the file is not a storage transition, so only a document whose
  // state would change asks the table — and a live one never needs to.
  if (document.storageStatus !== storageStatus) assertTransition(document.storageStatus, storageStatus);

  // The state and the current version read under the lock are the guard:
  // nothing else can have moved them, and the write says so rather than
  // relying on it.
  const promoted = await tx.document.updateMany({
    where: { id: version.documentId, storageStatus: document.storageStatus, currentVersionId: document.currentVersionId },
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
      scanStartedAt: version.scanStartedAt,
      scanAttempts: version.scanAttempts,
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
  return true;
}
