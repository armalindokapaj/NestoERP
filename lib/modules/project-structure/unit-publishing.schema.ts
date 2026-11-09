import { z } from "zod";

import { idSchema } from "./structure.schema";
import { CAPTION_MAX, UNIT_DOCUMENT_CATEGORIES, UNIT_MEDIA_CATEGORIES } from "./unit-publishing.types";

/**
 * Publishing and file validation (E-05D §65-§70, §110). Ids are shapes only:
 * whether a document is this unit's or its project's is the service's question.
 * Archive and restore carry the version the person saw; nothing else about a
 * unit's publication is asked for (units publish on create, 2026-11).
 */

const expectedVersion = z.number().int().min(1);

export const versionedActionSchema = z.object({ expectedVersion });

export const attachDocumentSchema = z.object({ documentId: idSchema, category: z.enum(UNIT_DOCUMENT_CATEGORIES) });
export const salesPlanSchema = z.object({ documentId: idSchema });

const caption = z
  .string()
  .trim()
  .max(CAPTION_MAX, `Keep the caption under ${CAPTION_MAX} characters.`)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const addMediaSchema = z.object({ documentId: idSchema, category: z.enum(UNIT_MEDIA_CATEGORIES).default("OTHER"), caption });
// An empty body is refused by the service after the unit's door, so a foreign id is a 404 before it is a 422.
export const updateMediaSchema = z.object({ category: z.enum(UNIT_MEDIA_CATEGORIES).optional(), caption: caption.optional(), isPrimary: z.literal(true).optional() });

export const candidatesQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  kind: z.enum(["document", "image"]).catch("document"),
});
