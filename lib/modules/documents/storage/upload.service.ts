import { createHash, randomUUID } from "node:crypto";
import { Prisma, type DocumentStorageStatus } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import {
  assertDeclaredFileAllowed,
  assertTransition,
  buildStorageKey,
  checkFileName,
  fileTypeForExtension,
  MAGIC_BYTE_WINDOW,
  normaliseMime,
  scannerEnabled,
  StorageError,
  UPLOAD_SESSION_TTL_MS,
  UPLOAD_URL_TTL_SECONDS,
  verifyContent,
} from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { canAttachToDocumentParent, resolveDocumentParent } from "../document.parent-access";
import * as quota from "./quota.service";
import { promoteVersion } from "./version.promote";
import { runScanForDocument } from "./scan.service";
import type { CompleteDocumentUploadInput, CreateDocumentUploadInput } from "./storage.schema";
import type { CreateUploadResponse } from "./storage.types";

/**
 * The upload pipeline (PRD #29 §9, §11, §233, §325).
 *
 * Three steps, in this order, and the order is the security property:
 *
 *   1. the server agrees to an upload, writes the intent, and hands back a
 *      short-lived capability for one object key
 *   2. the browser puts the bytes straight at storage
 *   3. the server verifies what actually arrived and only then makes the
 *      document available
 *
 * No business record points at an AVAILABLE file until step 3 has run
 * (PRD #29 §233). A metadata row is never evidence that a file exists, and a
 * stored object is never evidence that it was authorised.
 */

const MODULE = "documents" as const;
const ENTITY = "Document";

/**
 * Above this size the checksum is left to the maintenance sweep.
 *
 * Computing SHA-256 means reading the whole object, and doing that inside the
 * completion request would blow the sub-second target §393 sets for it. Small
 * files — which is most of them — get their checksum immediately; large ones
 * get it from the same worker that drains the scan queue (PRD #29 §86).
 */
const CHECKSUM_INLINE_LIMIT_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* 1. Authorise                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Authorises an upload and returns a signed URL for exactly one object
 * (PRD #29 §11, §75, §78).
 *
 * Everything is checked before a single byte is accepted: the caller, the
 * module, the parent record, the file's declared type and size, and the
 * company's remaining quota. An upload that would be refused afterwards is
 * refused now, before the user waits for it (PRD #29 §27).
 */
export async function createUploadSession(
  context: UserContext,
  input: CreateDocumentUploadInput,
  options: { idempotencyKey?: string } = {},
): Promise<CreateUploadResponse> {
  assertModule(context, MODULE);
  assertPermission(context, "document.create");

  const ref = await resolveDocumentParent(context, input);

  if (!(await canAttachToDocumentParent(context, ref))) {
    throw new AccessError("FORBIDDEN", "You cannot add documents to that record.");
  }

  const name = checkFileName(input.fileName);
  if (!name.ok) throw new StorageError("INVALID_FILE_NAME", name.reason);

  const maxBytes = await quota.maxSingleFileBytes(context.companyId);
  const fileType = assertDeclaredFileAllowed({
    fileName: input.fileName,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes,
    maxBytes,
  });

  const provider = storageProvider();
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);

  const { documentId, sessionId, storageKey } = await prisma.$transaction(async (tx) => {
    // Repeating a create with the same key returns the session already open
    // rather than opening a second one and stranding the first
    // (PRD #29 §261, §262).
    if (options.idempotencyKey) {
      const existing = await tx.documentUploadSession.findFirst({
        where: {
          companyId: context.companyId,
          memberId: context.membershipId,
          idempotencyKey: options.idempotencyKey,
        },
      });
      if (existing && (existing.status === "CREATED" || existing.status === "UPLOADING")) {
        return {
          documentId: existing.documentId,
          sessionId: existing.id,
          storageKey: existing.storageKey,
        };
      }
    }

    await quota.assertQuotaAllows(tx, context.companyId, input.sizeBytes);

    const newDocumentId = generateDocumentId();
    const key = buildStorageKey({
      companyId: context.companyId,
      documentId: newDocumentId,
      extension: name.extension,
    });

    await tx.document.create({
      data: {
        id: newDocumentId,
        companyId: context.companyId,
        name: input.name,
        description: input.description ?? null,
        originalFileName: input.fileName,
        fileName: name.displayName,
        extension: name.extension,
        storageProvider: provider.key,
        storageBucket: provider.bucket,
        storageKey: key,
        mimeType: normaliseMime(input.mimeType) || fileType.declaredMimeTypes[0],
        sizeBytes: BigInt(input.sizeBytes),
        // Intent only. Nothing is downloadable from here (PRD #29 §233).
        storageStatus: "PENDING_UPLOAD",
        scanStatus: "NOT_REQUIRED",
        previewStatus: "NOT_REQUIRED",
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

    // Version 1 exists from the first byte, so the history is never missing
    // its beginning (PRD #38 §56, §57).
    const version = await tx.documentVersion.create({
      data: {
        companyId: context.companyId,
        documentId: newDocumentId,
        versionNumber: 1,
        storageProvider: provider.key,
        storageBucket: provider.bucket,
        storageKey: key,
        originalFileName: input.fileName,
        fileName: name.displayName,
        extension: name.extension,
        mimeTypeDeclared: normaliseMime(input.mimeType) || fileType.declaredMimeTypes[0],
        sizeBytes: BigInt(input.sizeBytes),
        uploadedByMemberId: context.membershipId,
      },
      select: { id: true },
    });
    await tx.document.update({
      where: { id: newDocumentId },
      data: { currentVersionId: version.id, latestVersionNumber: 1 },
    });

    const session = await tx.documentUploadSession.create({
      data: {
        companyId: context.companyId,
        documentId: newDocumentId,
        documentVersionId: version.id,
        memberId: context.membershipId,
        storageKey: key,
        expectedFileName: input.fileName,
        expectedMimeType: normaliseMime(input.mimeType) || null,
        expectedSizeBytes: BigInt(input.sizeBytes),
        reservedBytes: BigInt(input.sizeBytes),
        status: "CREATED",
        expiresAt,
        idempotencyKey: options.idempotencyKey ?? null,
      },
    });

    return { documentId: newDocumentId, sessionId: session.id, storageKey: key };
  });

  const upload = await provider.createUploadUrl({
    storageKey,
    contentType: normaliseMime(input.mimeType) || fileType.declaredMimeTypes[0],
    maxBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  // The grant is logged as an event, never as a value (PRD #29 §73, §74, §257).
  logger.info("storage.upload.authorized", {
    documentId,
    sessionId,
    sizeBytes: input.sizeBytes,
    provider: provider.key,
  });

  return {
    documentId,
    uploadSessionId: sessionId,
    upload: {
      method: upload.method,
      url: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Verify                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Verifies what actually arrived and makes the document available
 * (PRD #29 §79, §80, §82).
 *
 * The browser's account of the upload is not consulted. The object is HEADed
 * for its real size, its leading bytes are read to see what it really is, and
 * its checksum is computed. Anything that does not agree with what was
 * authorised is rejected and the object is deleted (PRD #29 §266-§270).
 */
export async function completeUpload(
  context: UserContext,
  sessionId: string,
  input: CompleteDocumentUploadInput = {},
): Promise<{ documentId: string; status: string }> {
  assertModule(context, MODULE);

  const session = await prisma.documentUploadSession.findFirst({
    // Scoped to the company *and* the member: another company's session id is
    // not found, not forbidden (PRD #29 §361).
    where: { id: sessionId, companyId: context.companyId, memberId: context.membershipId },
    include: { document: true },
  });
  if (!session) throw new StorageError("UPLOAD_SESSION_NOT_FOUND");

  // A later version of an existing document goes through its own path: the
  // document stays available on its current version until the new one is
  // verified (PRD #38 §57, §58).
  const version = session.documentVersionId
    ? await prisma.documentVersion.findUnique({ where: { id: session.documentVersionId } })
    : null;
  if (version && session.document.currentVersionId !== version.id) {
    assertPermission(context, "document.update");
    return completeVersionUpload(context, session, version, input);
  }
  assertPermission(context, "document.create");

  // Already done: return the current state rather than reprocessing
  // (PRD #29 §81, §263).
  if (session.status === "COMPLETED") {
    return { documentId: session.documentId, status: session.document.storageStatus };
  }
  if (session.status === "ABORTED") throw new StorageError("UPLOAD_ABORTED");
  if (session.status === "EXPIRED" || session.expiresAt.getTime() < Date.now()) {
    await expireSession(sessionId);
    throw new StorageError("UPLOAD_SESSION_EXPIRED");
  }

  const provider = storageProvider();
  const document = session.document;

  /*
   * The object is missing. The document stays PENDING_UPLOAD rather than
   * moving to the terminal FAILED, because the session is still open and the
   * browser may legitimately retry within it — that is what §267 asks for, and
   * FAILED is a one-way door under §321. Cleanup turns it into FAILED when the
   * session finally expires (PRD #29 §131, §267, §316).
   */
  const metadata = await provider.headObject(session.storageKey);
  if (!metadata) throw new StorageError("STORAGE_OBJECT_MISSING");

  await transition(document.id, "PENDING_UPLOAD", "UPLOADED");
  await transition(document.id, "UPLOADED", "VERIFYING");

  try {
    const verified = await verifyStoredObject({
      companyId: context.companyId,
      documentId: document.id,
      storageKey: session.storageKey,
      extension: document.extension,
      expectedSizeBytes: Number(session.expectedSizeBytes),
      actualSizeBytes: metadata.sizeBytes,
      providerChecksum: metadata.checksumSha256,
      declaredChecksum: input.checksumSha256 ?? null,
      maxBytes: await quota.maxSingleFileBytes(context.companyId),
    });

    const scanNeeded = verified.scanRequired && scannerEnabled();

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: document.id },
        data: {
          storageStatus: scanNeeded ? "SCANNING" : "AVAILABLE",
          detectedMimeType: verified.detectedMimeType,
          checksum: verified.checksum,
          sizeBytes: BigInt(metadata.sizeBytes),
          uploadedAt: new Date(),
          verifiedAt: new Date(),
          availableAt: scanNeeded ? null : new Date(),
          scanStatus: scanNeeded ? "PENDING" : "NOT_REQUIRED",
          // A PDF or an image is inline-safe as it stands, so the original is
          // its own preview and no derived object is owed. Everything else is
          // download-only (PRD #29 §44, §45, §53).
          previewStatus: verified.previewable ? "READY" : "NOT_REQUIRED",
          previewMimeType: verified.previewable ? verified.contentType : null,
          updatedBy: context.userId,
        },
      });

      if (version) {
        await tx.documentVersion.update({
          where: { id: version.id },
          data: {
            storageStatus: scanNeeded ? "SCANNING" : "AVAILABLE",
            mimeTypeDetected: verified.detectedMimeType,
            checksumSha256: verified.checksum,
            sizeBytes: BigInt(metadata.sizeBytes),
            scanStatus: scanNeeded ? "PENDING" : "NOT_REQUIRED",
            previewStatus: verified.previewable ? "READY" : "NOT_REQUIRED",
            previewMimeType: verified.previewable ? verified.contentType : null,
            availableAt: scanNeeded ? null : new Date(),
          },
        });
      }

      await tx.documentUploadSession.update({
        where: { id: sessionId },
        data: { status: "COMPLETED", completedAt: new Date(), reservedBytes: BigInt(0) },
      });

      await quota.addUsage(tx, context.companyId, metadata.sizeBytes);

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: document.id,
        action: "DOCUMENT_UPLOADED",
        message: `added ${document.name}`,
        // Never a signed URL, a storage key or a credential (PRD #29 §257).
        metadata: {
          documentId: document.id,
          fileName: document.fileName,
          sizeBytes: metadata.sizeBytes,
        } as Prisma.InputJsonValue,
      });
    });

    if (scanNeeded) {
      /*
       * The scan is enqueued by the state itself: the row sits at
       * SCANNING/PENDING and the maintenance worker drains anything left
       * behind. Running it inline first is a latency optimisation, not the
       * guarantee — if this throws, the document stays unavailable, which is
       * the correct failure direction (PRD #29 §59, §271, §314).
       */
      await runScanForDocument(document.id).catch((error) => {
        logger.warn("storage.scan.inline_failed", {
          documentId: document.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
    }

    const finalState = await prisma.document.findUnique({
      where: { id: document.id },
      select: { storageStatus: true },
    });

    return { documentId: document.id, status: finalState?.storageStatus ?? "VERIFYING" };
  } catch (error) {
    await rejectUpload(context, {
      sessionId,
      documentId: document.id,
      storageKey: session.storageKey,
      reason: error instanceof StorageError ? error.storageCode : "STORAGE_PROVIDER_ERROR",
    });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

export type VerifiedObject = {
  detectedMimeType: string | null;
  checksum: string | null;
  contentType: string;
  previewable: boolean;
  scanRequired: boolean;
};

/**
 * The single verification step every stored object passes through
 * (PRD #29 §82-§88, §266-§270).
 *
 * Shared by the browser flow and by any server-side attach, so there is one
 * definition of "this object is what it claims to be" rather than two that
 * drift.
 */
export async function verifyStoredObject(input: {
  companyId: string;
  documentId: string;
  storageKey: string;
  extension: string | null;
  expectedSizeBytes: number;
  actualSizeBytes: number;
  providerChecksum: string | null;
  declaredChecksum: string | null;
  maxBytes: number;
}): Promise<VerifiedObject> {
  // Checked before the equality test, so an upload that lied about being small
  // is refused as too large rather than as the wrong size (PRD #29 §369).
  if (input.actualSizeBytes > input.maxBytes) {
    throw new StorageError(
      "FILE_TOO_LARGE",
      `Files must be ${Math.round(input.maxBytes / (1024 * 1024))} MB or smaller.`,
    );
  }
  if (input.actualSizeBytes <= 0) throw new StorageError("INVALID_FILE_SIZE");
  if (input.actualSizeBytes !== input.expectedSizeBytes) {
    // What was authorised and what arrived are different objects (§268).
    throw new StorageError("INVALID_FILE_SIZE");
  }

  const fileType = fileTypeForExtension(input.extension);
  if (!fileType) throw new StorageError("FILE_TYPE_NOT_ALLOWED");

  const provider = storageProvider();
  const head = await provider.getObjectHead(input.storageKey, MAGIC_BYTE_WINDOW);
  if (!head) throw new StorageError("STORAGE_OBJECT_MISSING");

  const verdict = verifyContent(fileType, head);
  if (!verdict.ok) throw new StorageError(verdict.code, verdict.reason);

  const checksum = await resolveChecksum({
    storageKey: input.storageKey,
    sizeBytes: input.actualSizeBytes,
    providerChecksum: input.providerChecksum,
  });

  // A declared checksum that does not match means the bytes changed in
  // transit. Never accepted, never quietly overwritten (PRD #29 §266).
  if (input.declaredChecksum && checksum && input.declaredChecksum.toLowerCase() !== checksum) {
    throw new StorageError("CHECKSUM_MISMATCH");
  }

  return {
    detectedMimeType: verdict.detectedMimeType,
    checksum,
    contentType: verdict.detectedMimeType ?? fileType.declaredMimeTypes[0],
    previewable: fileType.previewable,
    scanRequired: fileType.scanRequired,
  };
}

async function resolveChecksum(input: {
  storageKey: string;
  sizeBytes: number;
  providerChecksum: string | null;
}): Promise<string | null> {
  // Free when the provider computed one itself (PRD #29 §85, §86).
  if (input.providerChecksum) return input.providerChecksum.toLowerCase();
  if (input.sizeBytes > CHECKSUM_INLINE_LIMIT_BYTES) return null;

  const bytes = await storageProvider().getObject(input.storageKey);
  if (!bytes) return null;
  return createHash("sha256").update(bytes).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* Abort and rejection                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cancels an upload in flight (PRD #29 §207, §208).
 *
 * The partial object is removed, the reservation released and the placeholder
 * document deleted — it carries no history worth keeping, which is exactly the
 * case §133 allows a hard delete for.
 */
export async function abortUpload(context: UserContext, sessionId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "document.create");

  const session = await prisma.documentUploadSession.findFirst({
    where: { id: sessionId, companyId: context.companyId, memberId: context.membershipId },
  });
  if (!session) throw new StorageError("UPLOAD_SESSION_NOT_FOUND");
  if (session.status === "COMPLETED") throw new StorageError("UPLOAD_ALREADY_COMPLETED");

  await storageProvider().deleteObject(session.storageKey).catch(() => undefined);

  await prisma.$transaction(async (tx) => {
    await tx.documentUploadSession.update({
      where: { id: sessionId },
      data: { status: "ABORTED", reservedBytes: BigInt(0) },
    });
    // A new version that never arrived leaves no version behind; the document
    // itself is untouched. A first upload removes its placeholder entirely.
    if (session.documentVersionId) {
      await tx.documentVersion.deleteMany({
        where: { id: session.documentVersionId, storageStatus: "PENDING_UPLOAD", document: { currentVersionId: { not: session.documentVersionId } } },
      });
    }
    await tx.document.deleteMany({
      where: { id: session.documentId, storageStatus: "PENDING_UPLOAD" },
    });
  });

  logger.info("storage.upload.aborted", { sessionId, documentId: session.documentId });
}

/**
 * Marks a verification failure, deletes the object and releases the quota
 * reservation (PRD #29 §266, §270).
 *
 * The document is kept in REJECTED rather than deleted, so the uploader is
 * told why instead of watching their upload vanish (PRD #29 §164).
 */
async function rejectUpload(
  context: UserContext,
  input: { sessionId: string; documentId: string; storageKey: string; reason: string },
): Promise<void> {
  await storageProvider().deleteObject(input.storageKey).catch(() => undefined);

  await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { id: input.documentId, storageStatus: { in: ["VERIFYING", "UPLOADED", "PENDING_UPLOAD"] } },
      data: {
        storageStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectionReason: input.reason,
        updatedBy: context.userId,
      },
    });
    await tx.documentVersion.updateMany({
      where: { storageKey: input.storageKey, storageStatus: { in: ["VERIFYING", "UPLOADED", "PENDING_UPLOAD"] } },
      data: { storageStatus: "REJECTED", rejectionReason: input.reason },
    });
    await tx.documentUploadSession.update({
      where: { id: input.sessionId },
      data: { status: "FAILED", failureReason: input.reason, reservedBytes: BigInt(0) },
    });
  });

  logger.warn("storage.upload.rejected", {
    documentId: input.documentId,
    reason: input.reason,
  });
}

async function expireSession(sessionId: string): Promise<void> {
  await prisma.documentUploadSession.updateMany({
    where: { id: sessionId, status: { in: ["CREATED", "UPLOADING"] } },
    data: { status: "EXPIRED", reservedBytes: BigInt(0) },
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Moves a document between storage states, refusing anything the machine does
 * not allow and anything another writer got to first (PRD #29 §318, §320).
 *
 * The `where` carries the expected current state, so two concurrent completion
 * requests cannot both advance the same row.
 */
async function transition(
  documentId: string,
  from: DocumentStorageStatus,
  to: DocumentStorageStatus,
): Promise<void> {
  assertTransition(from, to);
  const result = await prisma.document.updateMany({
    where: { id: documentId, storageStatus: from },
    data: { storageStatus: to },
  });
  if (result.count === 0) {
    const current = await prisma.document.findUnique({
      where: { id: documentId },
      select: { storageStatus: true },
    });
    // Another request already advanced it, or it is somewhere it should not be.
    if (current?.storageStatus !== to) throw new StorageError("INVALID_DOCUMENT_STORAGE_STATE");
  }
}

/** Ids are generated here so the storage key can contain one (PRD #29 §19, §93). */
function generateDocumentId(): string {
  return `doc_${randomUUID().replace(/-/g, "")}`;
}

/* -------------------------------------------------------------------------- */
/* New versions (PRD #38 §56-§58, §67)                                         */
/* -------------------------------------------------------------------------- */

export type CreateVersionUploadInput = {
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  changeNote?: string;
};

/**
 * Authorises a new binary for an existing document.
 *
 * The same authority as filing a document against that parent, plus
 * `document.update`. The new version gets its own storage key: nothing about
 * the current version's object, key or checksum is ever touched, and the
 * document keeps serving it until the new one is verified (PRD #38 §58).
 */
export async function createVersionUploadSession(
  context: UserContext,
  documentId: string,
  input: CreateVersionUploadInput,
  options: { idempotencyKey?: string } = {},
): Promise<CreateUploadResponse & { documentVersionId: string; versionNumber: number }> {
  assertModule(context, MODULE);
  assertPermission(context, "document.update");

  const { findDocumentInScope } = await import("../document.repository");
  const document = await findDocumentInScope(context, documentId);
  if (!document) throw new AccessError("NOT_FOUND");
  if (document.status === "ARCHIVED" || document.archivedAt) {
    throw new AccessError("CONFLICT", "Restore this document before adding a version.");
  }
  if (document.storageStatus !== "AVAILABLE") {
    throw new AccessError("CONFLICT", "The current version is still being processed.");
  }
  if (!(await canAttachToDocumentParent(context, document))) {
    throw new AccessError("FORBIDDEN", "You cannot add files to that record.");
  }
  // A file carried by a submitted engineering revision or an issued transmittal
  // is part of that record: a correction is a new revision (PRD #46 §69, §123).
  const { frozenDocumentReason } = await import("@/lib/modules/engineering/engineering.revisions");
  const frozen = await frozenDocumentReason(document.id);
  if (frozen) throw new AccessError("CONFLICT", frozen, { code: "ENGINEERING_FILE_FROZEN" });

  const name = checkFileName(input.fileName);
  if (!name.ok) throw new StorageError("INVALID_FILE_NAME", name.reason);

  const maxBytes = await quota.maxSingleFileBytes(context.companyId);
  const fileType = assertDeclaredFileAllowed({
    fileName: input.fileName,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes,
    maxBytes,
  });

  const provider = storageProvider();
  const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);

  const opened = await prisma.$transaction(async (tx) => {
    if (options.idempotencyKey) {
      const existing = await tx.documentUploadSession.findFirst({
        where: { companyId: context.companyId, memberId: context.membershipId, idempotencyKey: options.idempotencyKey },
        include: { document: { select: { id: true } } },
      });
      if (existing && existing.documentVersionId && (existing.status === "CREATED" || existing.status === "UPLOADING")) {
        const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: existing.documentVersionId }, select: { versionNumber: true } });
        return { sessionId: existing.id, storageKey: existing.storageKey, versionId: existing.documentVersionId, versionNumber: version.versionNumber };
      }
    }

    await quota.assertQuotaAllows(tx, context.companyId, input.sizeBytes);

    // The increment locks the document row: two concurrent uploads get
    // consecutive numbers, never the same one (PRD #38 §154).
    const allocated = await tx.document.update({
      where: { id: documentId },
      data: { latestVersionNumber: { increment: 1 } },
      select: { latestVersionNumber: true },
    });

    const key = buildStorageKey({ companyId: context.companyId, documentId, extension: name.extension });
    const version = await tx.documentVersion.create({
      data: {
        companyId: context.companyId,
        documentId,
        versionNumber: allocated.latestVersionNumber,
        storageProvider: provider.key,
        storageBucket: provider.bucket,
        storageKey: key,
        originalFileName: input.fileName,
        fileName: name.displayName,
        extension: name.extension,
        mimeTypeDeclared: normaliseMime(input.mimeType) || fileType.declaredMimeTypes[0],
        sizeBytes: BigInt(input.sizeBytes),
        changeNote: input.changeNote?.trim() || null,
        uploadedByMemberId: context.membershipId,
      },
      select: { id: true, versionNumber: true },
    });

    const session = await tx.documentUploadSession.create({
      data: {
        companyId: context.companyId,
        documentId,
        documentVersionId: version.id,
        memberId: context.membershipId,
        storageKey: key,
        expectedFileName: input.fileName,
        expectedMimeType: normaliseMime(input.mimeType) || null,
        expectedSizeBytes: BigInt(input.sizeBytes),
        reservedBytes: BigInt(input.sizeBytes),
        status: "CREATED",
        expiresAt,
        idempotencyKey: options.idempotencyKey ?? null,
      },
    });

    return { sessionId: session.id, storageKey: key, versionId: version.id, versionNumber: version.versionNumber };
  });

  const upload = await provider.createUploadUrl({
    storageKey: opened.storageKey,
    contentType: normaliseMime(input.mimeType) || fileType.declaredMimeTypes[0],
    maxBytes,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  logger.info("storage.version_upload.authorized", { documentId, versionNumber: opened.versionNumber, sizeBytes: input.sizeBytes });

  return {
    documentId,
    documentVersionId: opened.versionId,
    versionNumber: opened.versionNumber,
    uploadSessionId: opened.sessionId,
    upload: { method: upload.method, url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
  };
}

type SessionWithDocument = Prisma.DocumentUploadSessionGetPayload<{ include: { document: true } }>;
type VersionRow = Prisma.DocumentVersionGetPayload<object>;

async function transitionVersion(versionId: string, from: DocumentStorageStatus, to: DocumentStorageStatus): Promise<void> {
  assertTransition(from, to);
  const result = await prisma.documentVersion.updateMany({ where: { id: versionId, storageStatus: from }, data: { storageStatus: to } });
  if (result.count === 0) {
    const current = await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { storageStatus: true } });
    if (current?.storageStatus !== to) throw new StorageError("INVALID_DOCUMENT_STORAGE_STATE");
  }
}

async function completeVersionUpload(
  context: UserContext,
  session: SessionWithDocument,
  version: VersionRow,
  input: CompleteDocumentUploadInput,
): Promise<{ documentId: string; status: string }> {
  if (session.status === "COMPLETED") return { documentId: session.documentId, status: version.storageStatus };
  if (session.status === "ABORTED") throw new StorageError("UPLOAD_ABORTED");
  if (session.status === "EXPIRED" || session.expiresAt.getTime() < Date.now()) {
    await expireSession(session.id);
    throw new StorageError("UPLOAD_SESSION_EXPIRED");
  }

  const provider = storageProvider();
  const metadata = await provider.headObject(session.storageKey);
  if (!metadata) throw new StorageError("STORAGE_OBJECT_MISSING");

  await transitionVersion(version.id, "PENDING_UPLOAD", "UPLOADED");
  await transitionVersion(version.id, "UPLOADED", "VERIFYING");

  try {
    const verified = await verifyStoredObject({
      companyId: context.companyId,
      documentId: session.documentId,
      storageKey: session.storageKey,
      extension: version.extension,
      expectedSizeBytes: Number(session.expectedSizeBytes),
      actualSizeBytes: metadata.sizeBytes,
      providerChecksum: metadata.checksumSha256,
      declaredChecksum: input.checksumSha256 ?? null,
      maxBytes: await quota.maxSingleFileBytes(context.companyId),
    });
    const scanNeeded = verified.scanRequired && scannerEnabled();

    await prisma.$transaction(async (tx) => {
      await tx.documentVersion.update({
        where: { id: version.id },
        data: {
          storageStatus: scanNeeded ? "SCANNING" : "AVAILABLE",
          mimeTypeDetected: verified.detectedMimeType,
          checksumSha256: verified.checksum,
          sizeBytes: BigInt(metadata.sizeBytes),
          scanStatus: scanNeeded ? "PENDING" : "NOT_REQUIRED",
          previewStatus: verified.previewable ? "READY" : "NOT_REQUIRED",
          previewMimeType: verified.previewable ? verified.contentType : null,
          availableAt: scanNeeded ? null : new Date(),
        },
      });
      await tx.documentUploadSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", completedAt: new Date(), reservedBytes: BigInt(0) },
      });
      await quota.addUsage(tx, context.companyId, metadata.sizeBytes);
      if (!scanNeeded) await promoteVersion(tx, version.id);

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: session.documentId,
        action: "DOCUMENT_VERSION_UPLOADED",
        message: `uploaded version ${version.versionNumber}`,
        metadata: { documentId: session.documentId, versionNumber: version.versionNumber } as Prisma.InputJsonValue,
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.DOCUMENT_VERSION_CREATED,
          entity: { type: ENTITY, id: session.documentId, label: session.document.name },
          after: { versionNumber: version.versionNumber, sizeBytes: metadata.sizeBytes, checksumSha256: verified.checksum },
        },
        { tx },
      );
    });

    if (scanNeeded) {
      const { runScanForVersion } = await import("./scan.service");
      await runScanForVersion(version.id).catch((error) => {
        logger.warn("storage.scan.inline_failed", { documentId: session.documentId, error: error instanceof Error ? error.message : "unknown" });
      });
    }

    const final = await prisma.documentVersion.findUnique({ where: { id: version.id }, select: { storageStatus: true } });
    return { documentId: session.documentId, status: final?.storageStatus ?? "VERIFYING" };
  } catch (error) {
    const reason = error instanceof StorageError ? error.storageCode : "STORAGE_PROVIDER_ERROR";
    await provider.deleteObject(session.storageKey).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.documentVersion.updateMany({
        where: { id: version.id, storageStatus: { in: ["VERIFYING", "UPLOADED", "PENDING_UPLOAD"] } },
        data: { storageStatus: "REJECTED", rejectionReason: reason },
      });
      await tx.documentUploadSession.update({
        where: { id: session.id },
        data: { status: "FAILED", failureReason: reason, reservedBytes: BigInt(0) },
      });
    });
    logger.warn("storage.version_upload.rejected", { documentId: session.documentId, versionNumber: version.versionNumber, reason });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Server-side attach                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Stores bytes the server already holds, through the same pipeline
 * (PRD #29 §233).
 *
 * Used by seeds, fixtures and any server-side attach. Deliberately not a
 * shortcut: it opens a real session, writes a real object and runs the real
 * verification, so there is exactly one definition of how a document becomes
 * available. A second path would be a second set of rules, and the one that
 * skipped a check would be the one that mattered.
 *
 * This is not the route a browser upload takes — that goes straight to storage
 * (PRD #29 §10, §389).
 */
export async function attachDocumentFromBytes(
  context: UserContext,
  input: Omit<CreateDocumentUploadInput, "sizeBytes" | "checksumSha256">,
  bytes: Uint8Array,
): Promise<{ documentId: string; status: string }> {
  const session = await createUploadSession(context, {
    ...input,
    sizeBytes: bytes.byteLength,
  } as CreateDocumentUploadInput);

  const row = await prisma.documentUploadSession.findUniqueOrThrow({
    where: { id: session.uploadSessionId },
    select: { storageKey: true, expectedMimeType: true },
  });

  await storageProvider().putObject(
    row.storageKey,
    bytes,
    row.expectedMimeType ?? "application/octet-stream",
  );

  return completeUpload(context, session.uploadSessionId, {
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
