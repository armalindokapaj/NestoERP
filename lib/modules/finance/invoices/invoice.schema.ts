import { z } from "zod";

import { optionalDate, optionalId, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { compareDecimal, integerDigits, multiplyDecimal } from "../finance.decimal";
import { MAX_LINE_ITEMS } from "../finance.form-data";
import { businessDate, clearableId, clearableText, currencyCode, positive, rateString, taxRateString } from "../finance.fields";

/**
 * Invoice validation (PRD #15 §236–§238).
 *
 * `subtotal`, `taxAmount` and `totalAmount` are absent on purpose: the server
 * calculates them from the lines, so there is nothing for the browser to send
 * and nothing for it to lie about (PRD #15 §220). `companyId`,
 * `createdByMemberId` and `status` are absent for the same reason
 * (PRD #15 §219).
 */

/** 100% is the ceiling until a jurisdiction needs otherwise (PRD #15 §238). */
export const MAX_TAX_RATE = 100;

/**
 * One priced line (AUD-09 §4, FV-06): quantity and unit price at four
 * decimals, the tax rate in percent within `Decimal(7, 4)`. Every comparison is
 * on the canonical decimal string — no float ever decides a bound — and a line
 * whose total would not fit a `Decimal(18, 2)` column is refused on the line,
 * not by the database. Unit price may be zero (a free line) but not negative:
 * V0.1 invoices have no credit notes or negative discount lines.
 */
export const invoiceLineSchema = z
  .object({
    description: requiredText(1, 500, "Line description"),
    quantity: rateString("Quantity").refine(positive, {
      message: "Quantity must be greater than zero",
    }),
    unitPrice: rateString("Unit price"),
    taxRate: taxRateString("Tax rate").refine((value) => compareDecimal(value, String(MAX_TAX_RATE)) <= 0, {
      message: `Tax rate must be between 0 and ${MAX_TAX_RATE}`,
    }),
  })
  .superRefine((line, ctx) => {
    if (integerDigits(multiplyDecimal(line.quantity, line.unitPrice, 2)) > 13) {
      ctx.addIssue({ code: "custom", path: ["unitPrice"], message: "This line's total is too large. Split it or check the quantity and unit price." });
    }
  });

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

const invoiceFields = {
  // Optional because an AUTO scheme allocates it; the service refuses a
  // MANUAL create with none (PRD #24 §114).
  invoiceNumber: optionalText(60),
  clientId: z.string().trim().min(1, "Choose a client"),
  projectId: optionalId,
  issueDate: businessDate,
  dueDate: businessDate,
  currency: currencyCode,
  notes: optionalText(2000),
  lineItems: z
    .array(invoiceLineSchema)
    .min(1, "Add at least one line item")
    .max(MAX_LINE_ITEMS, `An invoice can have at most ${MAX_LINE_ITEMS} lines`),
};

/** `dueDate >= issueDate`: an invoice cannot fall due before it exists (PRD #15 §51). */
const datesInOrder = <T extends { issueDate: Date; dueDate: Date }>(schema: z.ZodType<T>) =>
  schema.refine((value) => value.dueDate.getTime() >= value.issueDate.getTime(), {
    message: "The due date cannot be before the issue date.",
    path: ["dueDate"],
  });

export const createInvoiceSchema = datesInOrder(z.object(invoiceFields));

/**
 * An edit replaces the document — its lines are one document, and a partial
 * set of lines is how a total stops matching its parts — so the core fields
 * are required as on create. The optional ones follow the partial-update rule
 * (AUD-09 §4, FV-05): absent keeps what is saved, empty or `null` clears.
 */
export const updateInvoiceSchema = datesInOrder(
  z.object({
    ...invoiceFields,
    projectId: clearableId,
    notes: clearableText(2000),
    versionUpdatedAt: optionalDate,
  }),
);

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

export const INVOICE_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SENT",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const SETTLEMENT_FILTERS = ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;

export const INVOICE_SORT_KEYS = [
  "issue-desc",
  "issue-asc",
  "due-asc",
  "due-desc",
  "amount-desc",
  "amount-asc",
  "number-asc",
  "number-desc",
  "updated-desc",
] as const;

export type InvoiceSortKey = (typeof INVOICE_SORT_KEYS)[number];

export const invoiceListQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    status: z.array(z.enum(INVOICE_STATUSES)).optional(),
    settlement: z.array(z.enum(SETTLEMENT_FILTERS)).optional(),
    clientId: z.string().optional(),
    projectId: z.string().optional(),
    currency: z.string().optional(),
    issuedFrom: optionalDate,
    issuedTo: optionalDate,
    archived: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(25),
    sort: z.enum(INVOICE_SORT_KEYS).default("issue-desc"),
  })
  // A range that ends before it starts matches nothing by accident; it is refused
  // rather than answered with an empty list that looks like a result (AUD-01 §5.1).
  .refine((query) => !query.issuedFrom || !query.issuedTo || query.issuedFrom.getTime() <= query.issuedTo.getTime(), {
    message: "The issue date range ends before it starts.",
    path: ["issuedTo"],
  });

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** A rejection must say why (PRD #15 §63, §146). */
export const decisionSchema = z.object({
  note: optionalText(2000),
});

export const rejectionSchema = z.object({
  note: requiredText(3, 2000, "Reason"),
});

export type DecisionInput = z.infer<typeof decisionSchema>;
export type RejectionInput = z.infer<typeof rejectionSchema>;

