import { AccessError, type ApiErrorCode } from "@/lib/access/guards";

/**
 * The storage error taxonomy (PRD #29 §347, §348).
 *
 * NESTO already has one API error shape (PRD #7 §150), and this does not
 * invent a second. A `StorageError` *is* an `AccessError` — it carries the
 * transport code that decides the HTTP status, plus the specific storage code
 * in `details`, so a client can tell `FILE_TOO_LARGE` from
 * `STORAGE_QUOTA_EXCEEDED` while both arrive as the same envelope.
 *
 * Every message here is safe to show a user: no scanner signatures, no bucket
 * names, no provider internals (PRD #29 §211, §395, §398).
 */

export const StorageErrorCode = {
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  DOCUMENT_PARENT_NOT_FOUND: "DOCUMENT_PARENT_NOT_FOUND",
  DOCUMENT_NOT_AVAILABLE: "DOCUMENT_NOT_AVAILABLE",
  DOCUMENT_ARCHIVED: "DOCUMENT_ARCHIVED",

  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_TYPE_NOT_ALLOWED: "FILE_TYPE_NOT_ALLOWED",
  FILE_TYPE_MISMATCH: "FILE_TYPE_MISMATCH",
  INVALID_FILE_NAME: "INVALID_FILE_NAME",
  INVALID_FILE_SIZE: "INVALID_FILE_SIZE",

  UPLOAD_SESSION_NOT_FOUND: "UPLOAD_SESSION_NOT_FOUND",
  UPLOAD_SESSION_EXPIRED: "UPLOAD_SESSION_EXPIRED",
  UPLOAD_ALREADY_COMPLETED: "UPLOAD_ALREADY_COMPLETED",
  UPLOAD_ABORTED: "UPLOAD_ABORTED",

  STORAGE_QUOTA_EXCEEDED: "STORAGE_QUOTA_EXCEEDED",
  STORAGE_OBJECT_MISSING: "STORAGE_OBJECT_MISSING",
  STORAGE_PROVIDER_ERROR: "STORAGE_PROVIDER_ERROR",
  CHECKSUM_MISMATCH: "CHECKSUM_MISMATCH",

  FILE_SCAN_PENDING: "FILE_SCAN_PENDING",
  FILE_REJECTED_MALWARE: "FILE_REJECTED_MALWARE",
  FILE_SCAN_FAILED: "FILE_SCAN_FAILED",

  PREVIEW_NOT_SUPPORTED: "PREVIEW_NOT_SUPPORTED",
  PREVIEW_NOT_READY: "PREVIEW_NOT_READY",
  PREVIEW_FAILED: "PREVIEW_FAILED",

  INVALID_DOCUMENT_STORAGE_STATE: "INVALID_DOCUMENT_STORAGE_STATE",
} as const;

export type StorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];

/**
 * Which transport code each storage failure travels as (PRD #29 §348).
 *
 * The interesting entries are the ones that answer 404. A document whose
 * parent is out of scope, and a session belonging to another company, are both
 * "not found" — because any other answer confirms the record exists
 * (PRD #29 §159, §160, §361).
 */
const TRANSPORT: Record<StorageErrorCode, ApiErrorCode> = {
  DOCUMENT_NOT_FOUND: "NOT_FOUND",
  DOCUMENT_PARENT_NOT_FOUND: "NOT_FOUND",
  DOCUMENT_NOT_AVAILABLE: "CONFLICT",
  DOCUMENT_ARCHIVED: "CONFLICT",

  FILE_TOO_LARGE: "VALIDATION_ERROR",
  FILE_TYPE_NOT_ALLOWED: "VALIDATION_ERROR",
  FILE_TYPE_MISMATCH: "VALIDATION_ERROR",
  INVALID_FILE_NAME: "VALIDATION_ERROR",
  INVALID_FILE_SIZE: "VALIDATION_ERROR",

  UPLOAD_SESSION_NOT_FOUND: "NOT_FOUND",
  UPLOAD_SESSION_EXPIRED: "CONFLICT",
  UPLOAD_ALREADY_COMPLETED: "CONFLICT",
  UPLOAD_ABORTED: "CONFLICT",

  STORAGE_QUOTA_EXCEEDED: "VALIDATION_ERROR",
  STORAGE_OBJECT_MISSING: "CONFLICT",
  STORAGE_PROVIDER_ERROR: "INTERNAL_ERROR",
  CHECKSUM_MISMATCH: "VALIDATION_ERROR",

  FILE_SCAN_PENDING: "CONFLICT",
  FILE_REJECTED_MALWARE: "CONFLICT",
  FILE_SCAN_FAILED: "CONFLICT",

  PREVIEW_NOT_SUPPORTED: "VALIDATION_ERROR",
  PREVIEW_NOT_READY: "CONFLICT",
  PREVIEW_FAILED: "CONFLICT",

  INVALID_DOCUMENT_STORAGE_STATE: "CONFLICT",
};

/** What a user is told. Never why the scanner thought so (PRD #29 §211). */
const MESSAGES: Record<StorageErrorCode, string> = {
  DOCUMENT_NOT_FOUND: "The requested document could not be found.",
  DOCUMENT_PARENT_NOT_FOUND: "The requested document could not be found.",
  DOCUMENT_NOT_AVAILABLE: "This file is not ready yet.",
  DOCUMENT_ARCHIVED: "This document is archived.",

  FILE_TOO_LARGE: "That file is larger than the upload limit.",
  FILE_TYPE_NOT_ALLOWED: "That file type cannot be uploaded.",
  FILE_TYPE_MISMATCH: "The file's contents do not match its name.",
  INVALID_FILE_NAME: "That file name cannot be used.",
  INVALID_FILE_SIZE: "That file size is not valid.",

  UPLOAD_SESSION_NOT_FOUND: "That upload could not be found.",
  UPLOAD_SESSION_EXPIRED: "This upload took too long. Start it again.",
  UPLOAD_ALREADY_COMPLETED: "This upload has already finished.",
  UPLOAD_ABORTED: "This upload was cancelled.",

  STORAGE_QUOTA_EXCEEDED: "Your company has used all of its file storage.",
  STORAGE_OBJECT_MISSING: "The uploaded file did not arrive. Try again.",
  STORAGE_PROVIDER_ERROR: "File storage is unavailable. Please try again.",
  CHECKSUM_MISMATCH: "The uploaded file did not arrive intact. Try again.",

  FILE_SCAN_PENDING: "This file is still being checked.",
  FILE_REJECTED_MALWARE: "This file was rejected by a security check.",
  FILE_SCAN_FAILED: "This file could not be checked for malware. Upload it again.",

  PREVIEW_NOT_SUPPORTED: "This file type cannot be previewed. Download it instead.",
  PREVIEW_NOT_READY: "The preview is still being prepared.",
  PREVIEW_FAILED: "Preview unavailable. Download the file instead.",

  INVALID_DOCUMENT_STORAGE_STATE: "This file cannot change state that way.",
};

export class StorageError extends AccessError {
  readonly storageCode: StorageErrorCode;

  constructor(storageCode: StorageErrorCode, message?: string) {
    super(TRANSPORT[storageCode], message ?? MESSAGES[storageCode], { code: storageCode });
    this.name = "StorageError";
    this.storageCode = storageCode;
  }
}

export function storageErrorStatus(code: StorageErrorCode): ApiErrorCode {
  return TRANSPORT[code];
}
