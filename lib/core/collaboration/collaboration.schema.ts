import { z } from "zod";

/** Comment input (PRD #38 §36, §39). Plain text; the size cap is a security control, not a style choice. */
export const COMMENT_MAX_LENGTH = 5000;

export const commentBodySchema = z
  .string()
  .max(COMMENT_MAX_LENGTH, "COMMENT_TOO_LONG")
  .transform((value) => value.replace(/\r\n/g, "\n").trim())
  .refine((value) => value.length > 0, "COMMENT_EMPTY");

export const createCommentSchema = z.object({
  body: commentBodySchema,
  replyToId: z.string().trim().min(1).max(64).optional(),
});

export const editCommentSchema = z.object({ body: commentBodySchema });

export const threadQuerySchema = z.object({
  before: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ThreadQuery = z.infer<typeof threadQuerySchema>;
