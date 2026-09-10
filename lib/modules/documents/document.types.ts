import type { DocumentStatus } from "@prisma/client";

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
    /** False when the row exists but the object does not (PRD #13 §116, §191). */
    available: boolean;
    previewable: boolean;
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
