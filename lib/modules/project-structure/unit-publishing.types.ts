import type { UnitTypeCategory } from "@/config/unit-types";
import type { AreaField, CountField, FloorLevelType, UnitAttributes, UnitOrientation, UnitPosition } from "./structure.types";

/**
 * The unit page and its publishing (E-05D). Client-safe: constants, labels and
 * the shapes the API answers with.
 */

export const UNIT_PUBLICATION_STATUSES = ["DRAFT", "READY_FOR_PUBLISHING", "PUBLISHED", "REVISION_REQUIRED", "ARCHIVED"] as const;
export type UnitPublicationStatus = (typeof UNIT_PUBLICATION_STATUSES)[number];

export const UNIT_PUBLICATION_STATUS_LABELS: Record<UnitPublicationStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_PUBLISHING: "Ready for Publishing",
  PUBLISHED: "Published",
  REVISION_REQUIRED: "Revision Required",
  ARCHIVED: "Archived",
};

export const UNIT_MEDIA_CATEGORIES = ["COVER", "FLOOR_PLAN_IMAGE", "INTERIOR_RENDER", "EXTERIOR_RENDER", "VIEW", "OTHER"] as const;
export type UnitMediaCategory = (typeof UNIT_MEDIA_CATEGORIES)[number];

export const UNIT_MEDIA_CATEGORY_LABELS: Record<UnitMediaCategory, string> = {
  COVER: "Cover",
  FLOOR_PLAN_IMAGE: "Floor plan image",
  INTERIOR_RENDER: "Interior render",
  EXTERIOR_RENDER: "Exterior render",
  VIEW: "View",
  OTHER: "Other",
};

/**
 * What a document can be to a unit (E-05D §38). The Sales Plan is the unit's own
 * pointer, not a link; Contract, Finance and Legal documents arrive with E-05F.
 * Only the categories below are attachable today.
 */
export const UNIT_DOCUMENT_CATEGORIES = ["TECHNICAL_DRAWING", "SPECIFICATION", "OTHER"] as const;
export type UnitDocumentCategory = (typeof UNIT_DOCUMENT_CATEGORIES)[number] | "SALES_PLAN" | "CONTRACT" | "FINANCE" | "LEGAL";

export const UNIT_DOCUMENT_CATEGORY_LABELS: Record<UnitDocumentCategory, string> = {
  SALES_PLAN: "Sales Plan",
  TECHNICAL_DRAWING: "Technical drawing",
  SPECIFICATION: "Specification",
  CONTRACT: "Contract",
  FINANCE: "Finance",
  LEGAL: "Legal",
  OTHER: "Other",
};

/** Images a unit's media may be (E-05D §40): what the thumbnail pipeline can read. */
export const UNIT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const REVISION_REASON_MAX = 2_000;
export const CAPTION_MAX = 200;
export const MAX_UNIT_MEDIA = 60;

/* Readiness (§16, §45) ------------------------------------------------------ */

export type ReadinessKey = "unitCode" | "unitType" | "location" | "primaryArea" | "bedrooms" | "bathrooms" | "orientation" | "salesPlan" | "primaryImage" | "active" | "references";

export type ReadinessItem = { key: ReadinessKey; label: string; ok: boolean; hint: string | null };

export type Readiness = {
  ready: boolean;
  items: ReadinessItem[];
  complete: number;
  required: number;
  /** The labels of what is missing, in order — what an error names (§81). */
  missing: string[];
};

/* Display (§10, §11) --------------------------------------------------------- */

/**
 * Which technical fields a kind of unit shows (§11). A field outside its list is
 * still shown when it holds a value: hiding data somebody entered is worse than
 * an unusual row.
 */
export type UnitDisplay = { counts: readonly CountField[]; areas: readonly AreaField[]; orientation: boolean; position: boolean };

/* Snapshot (§24, §73) --------------------------------------------------------- */

export type UnitSnapshot = {
  unitCode: string;
  name: string | null;
  unitType: { id: string; name: string; category: UnitTypeCategory };
  building: { id: string; name: string; code: string | null };
  floor: { id: string; name: string; number: number | null; levelType: FloorLevelType };
  position: UnitPosition | null;
  orientation: UnitOrientation | null;
  areas: Record<AreaField, string | null>;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  attributes: UnitAttributes;
  description: string | null;
  salesPlan: { documentId: string; documentVersionId: string; versionNumber: number | null; fileName: string | null } | null;
  primaryImage: { documentId: string; documentVersionId: string; category: UnitMediaCategory; caption: string | null } | null;
};

/* DTOs ---------------------------------------------------------------------- */

export type PublicationRequestDTO = { id: string; submittedAt: string; submittedBy: string | null; submittedByMemberId: string };

export type UnitPublishingCapabilities = {
  canSubmit: boolean;
  canPublish: boolean;
  canRequestRevision: boolean;
  canUnpublish: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canViewHistory: boolean;
  canManageDocuments: boolean;
  canManageMedia: boolean;
};

export type UnitPublishingDTO = {
  status: UnitPublicationStatus;
  statusChangedAt: string | null;
  currentPublication: { id: string; versionNumber: number; publishedAt: string; publishedBy: string | null; publishedByMemberId: string } | null;
  hasUnpublishedChanges: boolean;
  revisionReason: string | null;
  pendingRequest: PublicationRequestDTO | null;
  readiness: Readiness;
  capabilities: UnitPublishingCapabilities;
};

export type PublicationSummaryDTO = {
  id: string;
  versionNumber: number;
  publishedAt: string;
  publishedBy: string | null;
  publishedByMemberId: string;
  isCurrent: boolean;
  salesPlanVersionNumber: number | null;
};

export type PublicationDetailDTO = PublicationSummaryDTO & { snapshot: UnitSnapshot };

export type UnitFileDTO = {
  documentId: string;
  name: string;
  fileName: string | null;
  mimeType: string | null;
  extension: string | null;
  sizeBytes: number | null;
  storageStatus: string;
  archived: boolean;
  versionNumber: number | null;
  uploadedAt: string;
  uploadedByMemberId: string | null;
  uploadedBy: string | null;
  href: string;
};

export type UnitDocumentLinkDTO = { id: string; category: UnitDocumentCategory; document: UnitFileDTO; attachedAt: string };

export type UnitMediaDTO = {
  id: string;
  category: UnitMediaCategory;
  caption: string | null;
  isPrimary: boolean;
  sortOrder: number;
  document: UnitFileDTO;
  thumbnailHref: string | null;
};

export type UnitFilesDTO = {
  /** False when the reader cannot open the Documents module: no file is listed, and none is offered. */
  visible: boolean;
  salesPlan: UnitFileDTO | null;
  /** The unit has a Sales Plan this reader cannot open. */
  salesPlanHidden: boolean;
  documents: UnitDocumentLinkDTO[];
  media: UnitMediaDTO[];
  /** Files uploaded against the unit that nothing points at yet — an upload whose second step failed. */
  unfiled: UnitFileDTO[];
  capabilities: { canManageDocuments: boolean; canManageMedia: boolean; canUpload: boolean; canUploadVersion: boolean };
};

export type AttachableDocumentDTO = { id: string; name: string; fileName: string | null; mimeType: string | null; onUnit: boolean };
