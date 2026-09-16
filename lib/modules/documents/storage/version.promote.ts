import type { Prisma } from "@prisma/client";

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
 */
export async function promoteVersion(tx: Prisma.TransactionClient, versionId: string): Promise<void> {
  const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
  const document = await tx.document.findUniqueOrThrow({
    where: { id: version.documentId },
    select: { status: true, archivedAt: true },
  });
  const archived = document.status === "ARCHIVED" || document.archivedAt !== null;

  await tx.document.update({
    where: { id: version.documentId },
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
      storageStatus: archived ? "ARCHIVED" : "AVAILABLE",
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
}
