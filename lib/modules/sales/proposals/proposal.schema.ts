import { z } from "zod";

import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";
import {
  businessDate,
  currencyCode,
  optionalBusinessDate,
  rateString,
} from "@/lib/modules/finance/finance.fields";
import { MAX_TAX_RATE } from "@/lib/modules/finance/invoices/invoice.schema";

/**
 * Proposal validation (PRD #17 §210, §214, §215, §224).
 *
 * `subtotal`, `taxAmount` and `totalAmount` are absent on purpose: the server
 * calculates them from the lines, so there is nothing for the browser to send
 * and nothing for it to lie about (PRD #17 §224).
 *
 * `opportunityId` appears only on create. A proposal that could be moved to a
 * different opportunity would take its approval history with it (PRD #17 §426).
 */

export const PROPOSAL_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "ACCEPTED",
  "DECLINED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const proposalLineSchema = z.object({
  description: requiredText(1, 500, "Line description"),
  quantity: rateString("Quantity").refine((value) => Number.parseFloat(value) > 0, {
    message: "Quantity must be greater than zero",
  }),
  unitPrice: rateString("Unit price"),
  taxRate: rateString("Tax rate").refine(
    (value) => {
      const rate = Number.parseFloat(value);
      return rate >= 0 && rate <= MAX_TAX_RATE;
    },
    { message: `Tax rate must be between 0 and ${MAX_TAX_RATE}` },
  ),
});

export type ProposalLineInput = z.infer<typeof proposalLineSchema>;

const proposalFields = {
  proposalNumber: requiredText(1, 60, "Proposal number"),
  title: requiredText(2, 200, "Title"),
  currency: currencyCode,
  issueDate: businessDate,
  validUntil: optionalBusinessDate,
  notes: optionalText(5000),
  lineItems: z.array(proposalLineSchema).min(1, "Add at least one line item"),
};

/** A quote cannot expire before it was written (PRD #17 §215). */
const validityInOrder = <T extends { issueDate: Date; validUntil?: Date }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (value) => !value.validUntil || value.validUntil.getTime() >= value.issueDate.getTime(),
    { message: "The validity date cannot be before the issue date.", path: ["validUntil"] },
  );

export const createProposalSchema = validityInOrder(
  z.object({
    ...proposalFields,
    opportunityId: z.string().trim().min(1, "Choose an opportunity"),
  }),
);

export const updateProposalSchema = validityInOrder(
  z.object({ ...proposalFields, versionUpdatedAt: optionalDate }),
);

export type CreateProposalInput = z.infer<typeof createProposalSchema>;
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;

/** A rejection must say why; an approval may (PRD #17 §419). */
export const proposalDecisionSchema = z.object({ note: optionalText(2000) });
export const proposalRejectionSchema = z.object({ note: requiredText(3, 2000, "Reason") });
export const proposalDeclineSchema = z.object({ note: optionalText(2000) });

export type ProposalDecisionInput = z.infer<typeof proposalDecisionSchema>;

export const PROPOSAL_SORT_KEYS = [
  "updated-desc",
  "number-asc",
  "number-desc",
  "amount-desc",
  "amount-asc",
  "valid-asc",
  "status-asc",
] as const;

export type ProposalSortKey = (typeof PROPOSAL_SORT_KEYS)[number];

export const proposalListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(PROPOSAL_STATUSES)).optional(),
  opportunityId: z.string().optional(),
  clientId: z.string().optional(),
  currency: z.string().optional(),
  archived: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(PROPOSAL_SORT_KEYS).default("updated-desc"),
});

export type ProposalListQuery = z.infer<typeof proposalListQuerySchema>;
