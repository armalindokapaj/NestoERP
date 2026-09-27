import { z } from "zod";

import { optionalDate, optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import {
  amountString,
  clearableBusinessDate,
  clearableId,
  clearableText,
  currencyCode,
  optionalBusinessDate,
  positive,
} from "../finance.fields";
import { EXPENSE_CATEGORIES } from "../expenses/expense.schema";

/**
 * Commitment validation (PRD #15 §242).
 *
 * The `source*` fields are absent from every input schema: only another module
 * may claim a commitment as its own, and letting the browser set them would
 * make a hand-typed commitment indistinguishable from a purchase order's
 * (PRD #15 §127, §219).
 */
const commitmentFields = {
  projectId: optionalId,
  reference: optionalText(60),
  description: requiredText(2, 500, "Description"),
  counterpartyName: optionalText(250),
  category: z.enum(EXPENSE_CATEGORIES, { message: "Choose a category" }),
  currency: currencyCode,
  amount: amountString("Amount").refine(positive, {
    message: "The commitment amount must be greater than zero",
  }),
  expectedDate: optionalBusinessDate,
  notes: optionalText(2000),
};

export const createCommitmentSchema = z.object(commitmentFields);
/** Optional fields on an edit: absent keeps, empty or `null` clears (AUD-09 §4, FV-05). */
export const updateCommitmentSchema = z.object({
  ...commitmentFields,
  projectId: clearableId,
  reference: clearableText(60),
  counterpartyName: clearableText(250),
  expectedDate: clearableBusinessDate,
  notes: clearableText(2000),
  versionUpdatedAt: optionalDate,
});

export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>;
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;

export const COMMITMENT_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const COMMITMENT_SORT_KEYS = [
  "expected-asc",
  "expected-desc",
  "amount-desc",
  "amount-asc",
  "updated-desc",
] as const;

export type CommitmentSortKey = (typeof COMMITMENT_SORT_KEYS)[number];

export const commitmentListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(COMMITMENT_STATUSES)).optional(),
  category: z.array(z.enum(EXPENSE_CATEGORIES)).optional(),
  projectId: z.string().optional(),
  currency: z.string().optional(),
  openOnly: z.boolean().default(false),
  archived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(COMMITMENT_SORT_KEYS).default("expected-asc"),
});

export type CommitmentListQuery = z.infer<typeof commitmentListQuerySchema>;
