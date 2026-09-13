import { z } from "zod";

import { optionalId, optionalText } from "@/lib/modules/shared/fields";
import { DOCUMENT_CONTEXTS, recordTypeField } from "../document.schema";

/**
 * Upload validation (PRD #29 §212-§224).
 *
 * What is absent matters more than what is present. The browser never supplies
 * `companyId`, `memberId`, `storageKey`, `storageProvider`, `storageBucket`,
 * `storageStatus`, `checksum` or the owner: every one of those is decided by
 * the server from the object it actually stored (PRD #29 §77).
 *
 * `sizeBytes` and `mimeType` *are* accepted, and are advisory only — they let
 * the server refuse an upload before it starts rather than after 100 MB has
 * crossed the wire. The authoritative values come from the HEAD afterwards
 * (PRD #29 §28, §30).
 */

const fileName = z
  .string()
  .trim()
  .min(1, "A file name is required")
  .max(255, "File names must be 255 characters or fewer");

export const createDocumentUploadSchema = z
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

    fileName,
    /** Advisory. Checked against the extension, then re-checked after upload. */
    mimeType: z.string().trim().max(160).optional(),
    /** Advisory. The stored object's own size is authoritative (§28). */
    sizeBytes: z.number().int().positive("That file is empty"),
    /**
     * Optional client-computed SHA-256. When present the server verifies it
     * and rejects a mismatch, which turns a corrupted transfer into an error
     * rather than a corrupted document (PRD #29 §85, §266).
     */
    checksumSha256: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/i, "That checksum is not a SHA-256 digest")
      .optional(),
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

export type CreateDocumentUploadInput = z.infer<typeof createDocumentUploadSchema>;

/**
 * Completion carries nothing the server needs to trust (PRD #29 §80).
 *
 * The session id comes from the route, and everything else is re-read from
 * storage. The optional checksum is the one value a client may contribute, and
 * it can only ever cause a rejection.
 */
export const completeDocumentUploadSchema = z.object({
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "That checksum is not a SHA-256 digest")
    .optional(),
});

export type CompleteDocumentUploadInput = z.infer<typeof completeDocumentUploadSchema>;

export const abortDocumentUploadSchema = z.object({
  reason: optionalText(200),
});

export type AbortDocumentUploadInput = z.infer<typeof abortDocumentUploadSchema>;

/** A download or preview grant takes no body at all (PRD #29 §213). */
export const documentGrantSchema = z.object({});
