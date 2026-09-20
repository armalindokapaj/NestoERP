import { ProjectMediaType } from "@prisma/client";
import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const title = z.string().trim().min(1, "Give the media a title.").max(180);
const description = z.string().trim().max(2_000).nullable().transform((value) => value || null);
const durationSeconds = z.number().int().min(1).max(24 * 60 * 60).optional().nullable();

export const createProjectMediaSchema = z.object({
  documentId: id,
  type: z.nativeEnum(ProjectMediaType),
  title: title.optional(),
  description: description.optional().default(null),
  thumbnailDocumentId: id.optional().nullable(),
  durationSeconds,
  isCover: z.boolean().optional().default(false),
  isFeatured: z.boolean().optional().default(false),
});

export const updateProjectMediaSchema = z.object({
  type: z.nativeEnum(ProjectMediaType).optional(),
  title: title.optional(),
  description: description.optional(),
  thumbnailDocumentId: id.optional().nullable(),
  durationSeconds,
  isCover: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), {
  message: "Choose something to update.",
});

export const reorderProjectMediaSchema = z.object({
  ids: z.array(id).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, {
    message: "Each media item must appear once.",
  }),
});

export type CreateProjectMediaInput = z.infer<typeof createProjectMediaSchema>;
export type UpdateProjectMediaInput = z.infer<typeof updateProjectMediaSchema>;
