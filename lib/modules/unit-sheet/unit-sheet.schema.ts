import { z } from "zod";

import { idSchema } from "@/lib/modules/project-structure/structure.schema";
import { SHEET_LINK_MAX } from "./unit-sheet.link";
import { SHEET_LIMITS } from "./unit-sheet.parse";

/**
 * Requests about a project's Google Sheet (2026-11-10). Whether the link is a
 * Google Sheet's is the service's question (`parseSheetLink`), so it can say
 * which way it is not.
 */

/** Link a sheet, or replace the link. `dryRun` reads the sheet and reports what it found without saving anything. */
export const sheetLinkSchema = z.object({
  url: z.string().trim().min(1, "Paste the sheet's link.").max(SHEET_LINK_MAX, "That link is too long."),
  dryRun: z.boolean().optional().default(false),
});
export type SheetLinkInput = z.infer<typeof sheetLinkSchema>;

const CHOICE_ID_MAX = 200;
/** Every field of every row: more than a sheet of 5,000 rows can propose. */
const MAX_CHOICES = SHEET_LIMITS.maxRows * 20;

/**
 * Confirming a preview: what it read (`sheetHash`, `linkVersion`), the
 * versions it saw of each unit it changes (`units`), the changes and new
 * units kept ticked (`accept`, by id), each clash's pick, and whether newly
 * priced units go on sale too (ticked by default, as the Price dialog's "Also
 * put it on sale").
 */
export const sheetApplySchema = z.object({
  sheetHash: z.string().regex(/^[a-f0-9]{64}$/, "Sync again: this preview cannot be confirmed."),
  linkVersion: z.number().int().min(1),
  units: z
    .array(z.object({ id: idSchema, version: z.number().int().min(0), salesVersion: z.number().int().min(0) }))
    .max(SHEET_LIMITS.maxRows)
    .refine((list) => new Set(list.map((unit) => unit.id)).size === list.length, "A unit is sent twice."),
  accept: z.array(z.string().min(1).max(CHOICE_ID_MAX)).max(MAX_CHOICES).default([]),
  clashes: z
    .record(z.string().min(1).max(CHOICE_ID_MAX), z.enum(["SHEET", "NESTO"]))
    .default({})
    .refine((record) => Object.keys(record).length <= MAX_CHOICES, "Too many choices."),
  putOnSale: z.boolean().optional().default(true),
});
export type SheetApplyInput = z.infer<typeof sheetApplySchema>;
