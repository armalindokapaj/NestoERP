import type { UserContext } from "@/lib/context/types";
import { storageStatusMessage } from "@/lib/core/storage";
import { requireDocument } from "./storage-access.service";
import type { DocumentStorageStatusDTO } from "./storage.types";

/**
 * Storage status for polling (PRD #29 §209, §210, §339).
 *
 * Runs the full access check, because "does this document exist and what state
 * is it in" is itself information — a status endpoint that answered before
 * checking would be a way to confirm a document id (PRD #29 §4, §160).
 */
export async function getStorageStatus(
  context: UserContext,
  documentId: string,
): Promise<DocumentStorageStatusDTO> {
  const document = await requireDocument(context, documentId);

  return {
    documentId: document.id,
    status: document.storageStatus,
    scanStatus: document.scanStatus,
    previewStatus: document.previewStatus,
    // A safe code only. Scanner internals stay in the audit trail (§211).
    rejectionReason: document.rejectionReason,
    message: storageStatusMessage(document.storageStatus),
    sizeBytes: document.sizeBytes === null ? null : Number(document.sizeBytes),
    ready: document.storageStatus === "AVAILABLE",
  };
}
