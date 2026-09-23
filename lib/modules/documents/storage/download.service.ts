import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  contentDisposition,
  DOWNLOAD_URL_TTL_SECONDS,
  StorageError,
} from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { findRecordAttachment } from "../document.repository";
import { assertObjectReadable, requireDownloadableDocument } from "./storage-access.service";
import type { DownloadGrant } from "./storage.types";

/**
 * Download grants (PRD #29 §99-§103, §326).
 *
 * Issuing a signed URL *is* the access decision — the object store will not
 * ask again — so the whole authorisation sequence runs here, every time, and
 * the grant that comes back is short-lived because it cannot be recalled
 * (PRD #29 §306, §308).
 *
 * A grant is a POST rather than a GET for the same reason: handing out a
 * capability is a security-sensitive action and should not be something a
 * proxy, a prefetch or a browser history entry can repeat (PRD #29 §101).
 */

export async function createDownloadGrant(
  context: UserContext,
  documentId: string,
): Promise<DownloadGrant> {
  const document = await requireDownloadableDocument(context, documentId);
  if (!document.storageKey) throw new StorageError("STORAGE_OBJECT_MISSING");

  const fileName = document.originalFileName ?? document.fileName ?? document.name;

  const grant = await storageProvider().createDownloadUrl({
    storageKey: document.storageKey,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    // Always an attachment. Inline rendering is the preview endpoint's job and
    // only for formats that cannot execute (PRD #29 §43).
    disposition: "attachment",
    fileName,
    contentType: document.detectedMimeType ?? document.mimeType ?? "application/octet-stream",
  });

  // The authorisation is audited; the URL itself never is (PRD #29 §73, §74).
  await recordUserAction(context, {
    actionKey: AuditAction.DOCUMENT_DOWNLOAD_GRANTED,
    entity: { type: "Document", id: documentId, label: document.name },
    projectId: document.projectId,
    metadata: { module: document.module, entityType: document.entityType },
  });

  logger.info("storage.download.granted", {
    documentId,
    provider: storageProvider().key,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });

  return {
    url: grant.url,
    expiresAt: grant.expiresAt.toISOString(),
    fileName,
  };
}

/**
 * Reads a file through the application (PRD #13 §18, PRD #29 §307).
 *
 * Kept alongside the grant for the cases where the bytes should not leave via
 * a bearer URL at all: an export, a server-side render, or a deployment that
 * wants instant revocation rather than a three-minute window. Every check the
 * grant path runs, this path runs too.
 */
export async function readDocumentBytes(
  context: UserContext,
  documentId: string,
  options: { inline?: boolean } = {},
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string; disposition: string }> {
  const document = await requireDownloadableDocument(context, documentId);
  if (!document.storageKey) throw new StorageError("STORAGE_OBJECT_MISSING");

  const bytes = await storageProvider().getObject(document.storageKey);
  if (!bytes) throw new StorageError("STORAGE_OBJECT_MISSING");

  const fileName = document.originalFileName ?? document.fileName ?? document.name;
  // Inline only for a format the registry marks previewable, and only when the
  // caller asked (PRD #29 §44, §106).
  const inline = options.inline === true && document.previewStatus === "READY";

  return {
    bytes,
    fileName,
    mimeType: document.detectedMimeType ?? document.mimeType ?? "application/octet-stream",
    disposition: contentDisposition(inline ? "inline" : "attachment", fileName),
  };
}

/**
 * Reads a file attached to a record whose owner has already decided the reader
 * may read the record and its files — today only an announcement, whose files
 * everybody who can read it may read, across the companies of the group
 * (Activity Center §47, §150). The storage state is checked here exactly as on
 * every other download: nothing unscanned, rejected or archived leaves.
 */
export async function readRecordAttachmentBytes(
  parent: { companyId: string; entityType: string; entityId: string },
  documentId: string,
  options: { inline?: boolean } = {},
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string; disposition: string }> {
  const document = await findRecordAttachment(parent, documentId);
  if (!document) throw new StorageError("DOCUMENT_NOT_FOUND");
  assertObjectReadable(document);
  const bytes = await storageProvider().getObject(document.storageKey!);
  if (!bytes) throw new StorageError("STORAGE_OBJECT_MISSING");
  const fileName = document.originalFileName ?? document.fileName ?? document.name;
  const inline = options.inline === true && document.previewStatus === "READY";
  logger.info("storage.attachment.read", { documentId, entityType: parent.entityType });
  return {
    bytes,
    fileName,
    mimeType: document.detectedMimeType ?? document.mimeType ?? "application/octet-stream",
    disposition: contentDisposition(inline ? "inline" : "attachment", fileName),
  };
}
