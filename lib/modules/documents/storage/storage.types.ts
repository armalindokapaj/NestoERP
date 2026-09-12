import type {
  DocumentPreviewStatus,
  DocumentScanStatus,
  DocumentStorageStatus,
} from "@prisma/client";

/**
 * Storage DTOs (PRD #29 §78, §102, §210, §350).
 *
 * Sizes leave as numbers, not BigInt: 100 MB is nowhere near the safe integer
 * limit and a BigInt does not survive `JSON.stringify` (PRD #29 §350).
 */

export type CreateUploadResponse = {
  documentId: string;
  uploadSessionId: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
};

export type DownloadGrant = {
  url: string;
  expiresAt: string;
  fileName: string;
};

export type PreviewGrant = {
  url: string;
  expiresAt: string;
  mimeType: string;
  /** What the viewer should render. `pdf` and `image` are the V0.1 set (§53). */
  kind: "pdf" | "image";
};

/** Polled while a file is processing (PRD #29 §209, §210, §339). */
export type DocumentStorageStatusDTO = {
  documentId: string;
  status: DocumentStorageStatus;
  scanStatus: DocumentScanStatus;
  previewStatus: DocumentPreviewStatus;
  rejectionReason: string | null;
  /** What to show the user right now — null once the file is available. */
  message: string | null;
  sizeBytes: number | null;
  /** True once a download or preview grant would succeed. */
  ready: boolean;
};

export type CompanyStorageSummary = {
  usedBytes: number;
  fileCount: number;
  reservedBytes: number;
  maxStorageBytes: number | null;
  maxSingleFileBytes: number;
  /** Null when no ceiling is configured (PRD #29 §145). */
  percentUsed: number | null;
};
