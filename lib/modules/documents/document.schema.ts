import { z } from "zod";

import { optionalDate, optionalId, optionalText } from "@/lib/modules/shared/fields";
import { FILE_TYPE_GROUPS } from "./document.files";

/**
 * Document validation (PRD #13 §142, §144).
 *
 * `companyId`, `storageKey`, `checksum`, `sizeBytes` and the archive fields are
 * absent from every input schema: they are decided by the server from the
 * object it actually stored, never by the browser (PRD #13 §31, §144).
 */

/** Where a new document is filed (PRD #13 §88). */
export const DOCUMENT_CONTEXTS = ["company", "project", "client"] as const;
export type DocumentContextKind = (typeof DOCUMENT_CONTEXTS)[number];

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
  })
  .refine((value) => value.context !== "project" || Boolean(value.projectId), {
    message: "Choose a project.",
    path: ["projectId"],
  })
  .refine((value) => value.context !== "client" || Boolean(value.clientId), {
    message: "Choose a client.",
    path: ["clientId"],
  });

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
export const DOCUMENT_CONTEXT_FILTERS = ["project", "client", "task", "company"] as const;

export const documentListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  fileType: z.array(z.enum(FILE_GROUPS)).optional(),
  context: z.array(z.enum(DOCUMENT_CONTEXT_FILTERS)).optional(),
  moduleKey: z.string().trim().max(40).optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  uploadedByMemberId: z.string().optional(),
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
