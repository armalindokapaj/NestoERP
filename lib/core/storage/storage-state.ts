import type { DocumentStorageStatus } from "@prisma/client";

import { StorageError } from "./storage.errors";

/**
 * The document storage state machine (PRD #29 §320-§322).
 *
 * One table, consulted by every writer, so no service can invent a transition
 * of its own. The two that matter:
 *
 *   nothing reaches AVAILABLE except through VERIFYING or SCANNING — a
 *   document is never downloadable on the strength of a metadata row (§233)
 *
 *   nothing leaves ARCHIVED except by restore — a scan or preview worker that
 *   finishes after somebody archived the file must not resurrect it (§319)
 */

const TRANSITIONS: Record<DocumentStorageStatus, DocumentStorageStatus[]> = {
  PENDING_UPLOAD: ["UPLOADED", "FAILED"],
  UPLOADED: ["VERIFYING", "FAILED"],
  // Verification can reject outright: an executable wearing a `.pdf` name
  // never gets as far as the scanner (PRD #29 §270).
  VERIFYING: ["SCANNING", "AVAILABLE", "REJECTED", "FAILED"],
  SCANNING: ["AVAILABLE", "REJECTED", "FAILED"],
  AVAILABLE: ["ARCHIVED"],
  ARCHIVED: ["AVAILABLE"],
  // Terminal. A rejected or failed upload is replaced by a new one, never
  // nudged into life (PRD #29 §335).
  REJECTED: [],
  FAILED: [],
};

/** States in which an upload is still in flight (PRD #29 §321). */
export const PENDING_STORAGE_STATUSES: DocumentStorageStatus[] = [
  "PENDING_UPLOAD",
  "UPLOADED",
  "VERIFYING",
  "SCANNING",
];

export function canTransition(
  from: DocumentStorageStatus,
  to: DocumentStorageStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Guards a transition, naming both ends in the log but neither in the message
 * the caller sees (PRD #29 §322).
 */
export function assertTransition(
  from: DocumentStorageStatus,
  to: DocumentStorageStatus,
): void {
  if (!canTransition(from, to)) {
    throw new StorageError("INVALID_DOCUMENT_STORAGE_STATE");
  }
}

/** The only state a normal download is served from (PRD #29 §162). */
export function isDownloadable(status: DocumentStorageStatus): boolean {
  return status === "AVAILABLE";
}

/** What the UI says while a file is not yet available (PRD #29 §163-§165). */
export function storageStatusMessage(status: DocumentStorageStatus): string | null {
  switch (status) {
    case "PENDING_UPLOAD":
      return "Waiting for the file.";
    case "UPLOADED":
    case "VERIFYING":
    case "SCANNING":
      return "Processing…";
    case "REJECTED":
      return "Upload rejected.";
    case "FAILED":
      return "File processing failed.";
    case "ARCHIVED":
      return "Archived.";
    case "AVAILABLE":
      return null;
  }
}
