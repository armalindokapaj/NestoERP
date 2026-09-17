import type { PrismaClient } from "@prisma/client";

import { DEFAULT_MAX_FILE_BYTES } from "../../lib/core/storage";

/**
 * Storage quotas for the demo companies (PRD #29 §144, §145).
 *
 * Every company gets a row, so the ceiling is a stated policy rather than an
 * implicit default buried in code. `maxStorageBytes` stays null — no hard
 * total is configured, which is exactly what §145 describes when the business
 * has not set one. Usage is still measured and shown.
 */
export async function seedStorageQuotas(prisma: PrismaClient): Promise<void> {
  const companies = await prisma.company.findMany({ select: { id: true } });

  for (const company of companies) {
    await prisma.companyStorageQuota.upsert({
      where: { companyId: company.id },
      update: {},
      create: {
        companyId: company.id,
        maxStorageBytes: null,
        maxSingleFileBytes: BigInt(DEFAULT_MAX_FILE_BYTES),
      },
    });
  }
}

/**
 * Version 1 of every seeded document that carries a file (PRD #38 §56, §57).
 *
 * The collaboration migration made every stored document version 1 of itself,
 * but on a fresh database it runs before there is a document to convert, so
 * the seed does the same for the records it writes. Documents that already
 * have a version (unit files create their own) are left alone.
 */
export async function seedDocumentVersions(prisma: PrismaClient): Promise<number> {
  const created = await prisma.$executeRaw`
    INSERT INTO "document_versions" (
        "id", "companyId", "documentId", "versionNumber",
        "storageProvider", "storageBucket", "storageKey", "originalFileName", "fileName", "extension",
        "mimeTypeDeclared", "mimeTypeDetected", "sizeBytes", "checksumSha256",
        "storageStatus", "scanStatus", "scanProvider", "scanCompletedAt", "previewStatus", "previewMimeType",
        "rejectionReason", "reviewState", "uploadedByMemberId", "createdAt", "updatedAt", "availableAt"
    )
    SELECT
        'dver_' || substr(md5(d."id" || ':1'), 1, 24), d."companyId", d."id", 1,
        d."storageProvider", d."storageBucket", d."storageKey", d."originalFileName", d."fileName", d."extension",
        d."mimeType", d."detectedMimeType", d."sizeBytes", d."checksum",
        d."storageStatus", d."scanStatus", d."scanProvider", d."scanCompletedAt", d."previewStatus", d."previewMimeType",
        d."rejectionReason", 'DRAFT', COALESCE(d."uploadedByMemberId", ''), d."createdAt", d."updatedAt", d."availableAt"
    FROM "documents" d
    WHERE d."storageKey" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "document_versions" v WHERE v."documentId" = d."id")`;

  await prisma.$executeRaw`
    UPDATE "documents" d
    SET "currentVersionId" = v."id", "latestVersionNumber" = 1
    FROM "document_versions" v
    WHERE v."documentId" = d."id" AND v."versionNumber" = 1 AND d."currentVersionId" IS NULL`;

  return created;
}
