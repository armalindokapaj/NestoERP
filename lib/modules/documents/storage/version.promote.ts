import type { Prisma } from "@prisma/client";

/**
 * Makes a verified version the one the document serves (PRD #38 §57, §65).
 *
 * The document's file columns are a mirror of its current version, rewritten
 * here in one statement with the pointer; the previous version keeps its own
 * row, key and object.
 */
export async function promoteVersion(tx: Prisma.TransactionClient, versionId: string): Promise<void> {
  const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId } });
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
      storageStatus: "AVAILABLE",
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

