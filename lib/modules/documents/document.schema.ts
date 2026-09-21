import { z } from "zod";

import { optionalDate, optionalId, optionalText } from "@/lib/modules/shared/fields";
import { isRecordType, type RecordType } from "@/lib/core/records/record.types";
import { FILE_TYPE_GROUPS } from "./document.files";

/**
 * Document validation (PRD #13 §142, §144).
 *
 * `companyId`, `storageKey`, `checksum`, `sizeBytes` and the archive fields are
 * absent from every input schema: they are decided by the server from the
 * object it actually stored, never by the browser (PRD #13 §31, §144).
 */

/** Where a new document is filed (PRD #13 §88). */
export const DOCUMENT_CONTEXTS = ["company", "project", "client", "record"] as const;
export type DocumentContextKind = (typeof DOCUMENT_CONTEXTS)[number];

/**
 * A record a document can be filed against (PRD #13 §44, PRD #38 §52).
 *
 * Not a list kept here: whether a record type takes files, and who may add
 * them, is its entry in the record registry. The schema only checks the shape;
 * `resolveDocumentParent` refuses a type the registry does not accept, and the
 * upload authoriser reads the same entry.
 */
export type DocumentRecordType = RecordType;

export const recordTypeField = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value))
  .refine((value) => value === undefined || isRecordType(value), { message: "That record does not take documents." })
  .transform((value) => value as DocumentRecordType | undefined);

export const createDocumentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Document name must be at least 2 characters")
      .max(200, "Document name must be 200 characters or fewer"),
    description: optionalText(2000),
    context: z.enum(DOCUMENT_CONTEXTS),
    projectId: optionalId,
    clientId: optionalId,
    entityType: recordTypeField,
    entityId: optionalId,
  })
  .refine((value) => value.context !== "project" || Boolean(value.projectId), {
    message: "Choose a project.",
    path: ["projectId"],
  })
  .refine((value) => value.context !== "client" || Boolean(value.clientId), {
    message: "Choose a client.",
    path: ["clientId"],
  })
  .refine(
    (value) => value.context !== "record" || (Boolean(value.entityType) && Boolean(value.entityId)),
    { message: "Choose a record.", path: ["entityId"] },
  );

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * Editable metadata only (PRD #13 §107, §108).
 *
 * The parent context is deliberately not editable: moving a document between
 * records is a separate, audited action if it is ever needed, not an overload
 * of the ordinary update (PRD #13 §109).
 */
export const updateDocumentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Document name must be at least 2 characters")
    .max(200, "Document name must be 200 characters or fewer"),
  description: optionalText(2000),
  versionUpdatedAt: optionalDate,
});

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const DOCUMENT_SORT_KEYS = [
  "updated-desc",
  "created-desc",
  "name-asc",
  "name-desc",
  "size-desc",
  "size-asc",
  "type-asc",
] as const;

export type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];

const FILE_GROUPS = Object.keys(FILE_TYPE_GROUPS) as [string, ...string[]];

/** Context values offered by the list filter (PRD #13 §72, §79). */
export const DOCUMENT_CONTEXT_FILTERS = ["project", "client", "task", "record", "company"] as const;

export const documentListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  fileType: z.array(z.enum(FILE_GROUPS)).optional(),
  context: z.array(z.enum(DOCUMENT_CONTEXT_FILTERS)).optional(),
  moduleKey: z.string().trim().max(40).optional(),
  /**
   * The record a document hangs off, for a module's own record tab
   * (PRD #13 §44, PRD #15 §187). Filtering narrows; the access clause still
   * decides what is reachable, so naming an entity cannot widen anything.
   */
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(64).optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  uploadedByMemberId: z.string().optional(),
  /**
   * The Group workspace's company filter (Workspace Context §86, §87). A filter,
   * not the workspace: only a company the reader may already read narrows
   * anything, and the company workspace never looks at it. A value that cannot
   * be a company id is dropped rather than refused, like one that is not theirs.
   */
  companyId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length <= 64 ? value : undefined)),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(DOCUMENT_SORT_KEYS).default("updated-desc"),
  /** Archived documents live in their own section (PRD #13 §70). */
  archived: z.boolean().default(false),
  /** Uploaded by the current member (PRD #13 §169). */
  mine: z.boolean().default(false),
});

export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
