import type { PrismaClient } from "@prisma/client";

import {
  buildStorageKey,
} from "../../lib/core/storage";
import { storageProvider } from "../../lib/core/storage/storage-provider.factory";

/**
 * Seeded documents with real stored objects (PRD #9 §63, PRD #29 §233).
 *
 * Every module that seeds a document comes through here, for one reason: a
 * Document row whose object does not exist is precisely the orphan state
 * PRD #29 §128 defines, and a demo dataset that ships a hundred of them makes
 * the storage guarantees untestable. So the fixtures get real bytes, real
 * checksums and a real `AVAILABLE` lifecycle — the same shape a genuine upload
 * leaves behind.
 *
 * Object keys are deterministic here so re-seeding overwrites rather than
 * accumulating orphans. Production keys stay random (PRD #29 §19).
 */

export type SeedDocumentInput = {
  id: string;
  companyId: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  module?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  uploadedByMemberId: string | null;
  createdBy: string;
  archived?: boolean;
  archivedAt?: Date | null;
  archivedBy?: string | null;
};

/** A small but genuinely valid PDF, so a seeded file really can be previewed. */
export function placeholderPdf(title: string): Uint8Array {
  const text = title.replace(/[()\\]/g, "");
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 120]/Contents 4 0 R" +
      "/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    "4 0 obj<</Length 90>>stream",
    "BT /F1 12 Tf 24 70 Td (" + text + ") Tj ET",
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R/Size 6>>",
    "%%EOF",
    "",
  ].join("\n");

  return new TextEncoder().encode(body);
}

/**
 * A 1×1 JPEG, byte for byte.
 *
 * A real signature matters: the verification path reads magic bytes, and a
 * fixture that is a PDF wearing a `.jpg` name would be rejected by the very
 * check it is meant to demonstrate (PRD #29 §270).
 */
function placeholderJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
    0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xff, 0xc4, 0x00, 0x14,
    0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
  ]);
}

/** An empty zip container — what an OOXML file looks like from the outside. */
function placeholderOoxml(): Uint8Array {
  return new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x4b,
    0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const PREVIEWABLE = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

function bytesFor(extension: string, title: string): Uint8Array {
  if (extension === "jpg" || extension === "jpeg") return placeholderJpeg();
  if (extension === "xlsx" || extension === "docx") return placeholderOoxml();
  return placeholderPdf(title);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "pdf";
}

/**
 * Writes the object and upserts the row that describes it.
 *
 * Idempotent: re-seeding repairs a document whose object went missing without
 * touching anything a developer edited by hand.
 */
export async function seedStoredDocument(
  prisma: PrismaClient,
  input: SeedDocumentInput,
): Promise<void> {
  const extension = extensionOf(input.name);
  const mimeType = MIME_BY_EXTENSION[extension] ?? "application/pdf";
  const bytes = bytesFor(extension, input.name);

  const provider = storageProvider();
  const storageKey = buildStorageKey({
    companyId: input.companyId,
    documentId: input.id,
    extension,
    objectId: "seed",
  });

  const stored = await provider.putObject(storageKey, bytes, mimeType);

  const fileColumns = {
    originalFileName: input.name,
    fileName: input.name,
    extension,
    storageProvider: provider.key,
    storageBucket: provider.bucket,
    storageKey,
    mimeType,
    detectedMimeType: mimeType,
    sizeBytes: BigInt(stored.sizeBytes),
    checksum: stored.checksumSha256,
    // The lifecycle a verified upload leaves behind (PRD #29 §233).
    storageStatus: input.archived ? ("ARCHIVED" as const) : ("AVAILABLE" as const),
    scanStatus: "NOT_REQUIRED" as const,
    previewStatus: PREVIEWABLE.has(extension) ? ("READY" as const) : ("NOT_REQUIRED" as const),
    previewMimeType: PREVIEWABLE.has(extension) ? mimeType : null,
    uploadedAt: new Date(),
    verifiedAt: new Date(),
    availableAt: new Date(),
  };

  await prisma.document.upsert({
    where: { id: input.id },
    // Only the file columns are refreshed, so hand edits to the metadata live.
    update: fileColumns,
    create: {
      id: input.id,
      companyId: input.companyId,
      name: input.name,
      description: input.description ?? null,
      projectId: input.projectId ?? null,
      clientId: input.clientId ?? null,
      module: input.module ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      status: input.archived ? "ARCHIVED" : "ACTIVE",
      preArchiveStatus: input.archived ? "ACTIVE" : null,
      archivedAt: input.archived ? (input.archivedAt ?? new Date()) : null,
      archivedBy: input.archived ? (input.archivedBy ?? input.createdBy) : null,
      uploadedByMemberId: input.uploadedByMemberId,
      createdBy: input.createdBy,
      ...fileColumns,
    },
  });
}
