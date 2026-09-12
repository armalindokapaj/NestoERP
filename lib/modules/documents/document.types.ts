import type {
  DocumentPreviewStatus,
  DocumentScanStatus,
  DocumentStatus,
  DocumentStorageStatus,
} from "@prisma/client";

/**
 * Document DTOs (PRD #13 §138, §139).
 *
 * `sizeBytes` is a string: Prisma's BigInt does not survive JSON, and quietly
 * coercing it to a number would be a silent precision bug (PRD #13 §127).
 */
export type DocumentContextDTO = {
  module: string | null;
  entityType: string | null;
  entityId: string | null;
  /** "Project", "Client", "Company" — what a reader recognises (PRD #13 §72). */
  label: string;
  relatedRecordName: string | null;
  relatedRecordHref: string | null;
};

export type DocumentSummaryDTO = {
  id: string;
  name: string;
  originalFileName: string | null;
  extension: string | null;
  typeLabel: string;
  mimeType: string | null;
  sizeBytes: string | null;
  status: DocumentStatus;
  /**
   * The storage lifecycle, which is not the business status (PRD #29 §2).
   * A row can be ACTIVE and still not downloadable because its object has not
   * been verified — the list needs to show that rather than imply a file that
   * is not there yet (PRD #29 §162, §342).
   */
  storageStatus: DocumentStorageStatus;
  storageMessage: string | null;
  context: DocumentContextDTO;
  uploadedBy: { memberId: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentDetailDTO = {
  id: string;
  name: string;
  description: string | null;

  file: {
    originalFileName: string | null;
    extension: string | null;
    typeLabel: string;
    mimeType: string | null;
    sizeBytes: string | null;
    /** True only in the AVAILABLE storage state (PRD #29 §162). */
    available: boolean;
    previewable: boolean;
    storageStatus: DocumentStorageStatus;
    scanStatus: DocumentScanStatus;
    previewStatus: DocumentPreviewStatus;
    /** A safe code, never scanner internals (PRD #29 §211). */
    rejectionReason: string | null;
    /** What to tell the reader while the file is not available (§163-§165). */
    storageMessage: string | null;
    checksum: string | null;
  };

  context: DocumentContextDTO & {
    project: { id: string; code: string; name: string } | null;
    client: { id: string; name: string } | null;
  };

  uploadedBy: { memberId: string; fullName: string } | null;

  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;

  /**
   * Server-derived UX hints. The frontend must not treat these as security —
   * every mutation and every download re-checks authorisation (PRD #13 §140).
   */
  capabilities: {
    canDownload: boolean;
    canPreview: boolean;
    canEdit: boolean;
    canArchive: boolean;
    canRestore: boolean;
    canViewActivity: boolean;
  };
};

export type DocumentActivityDTO = {
  id: string;
  action: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
};

/** The Documents overview counters (PRD #13 §9, §10). */
export type DocumentOverviewStats = {
  visible: number;
  addedThisMonth: number;
  projectDocuments: number;
  archived: number;
};
