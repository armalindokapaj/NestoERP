import { z } from "zod";

import { optionalDate, optionalText, requiredText } from "@/lib/modules/shared/fields";
import { amountString, businessDate } from "../finance.fields";

/**
 * Payment validation (PRD #15 §240).
 *
 * `currency` is absent: a payment always carries the currency of the record it
 * settles, which the server reads from that record. Accepting it from the form
 * would make a mismatch possible, and V0.1 has no FX engine to resolve one
 * (PRD #15 §76).
 */
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHECK", "OTHER"] as const;
export const PAYMENT_DIRECTIONS = ["RECEIPT", "DISBURSEMENT"] as const;
export const PAYMENT_STATUSES = ["RECORDED", "VOIDED"] as const;

export const createPaymentSchema = z
  .object({
    invoiceId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    expenseId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
    amount: amountString("Payment amount").refine(
      (value) => Number.parseFloat(value) > 0,
      { message: "The payment amount must be greater than zero" },
    ),
    paymentDate: businessDate,
    method: z.enum(PAYMENT_METHODS, { message: "Choose a payment method" }),
    reference: optionalText(200),
    notes: optionalText(2000),
  })
  // Exactly one parent, checked before anything reaches the database — the
  // check constraint behind it is the backstop, not the message (PRD #15 §74).
  .refine((value) => Boolean(value.invoiceId) !== Boolean(value.expenseId), {
    message: "A payment must settle exactly one invoice or one expense.",
    path: ["invoiceId"],
  });

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const voidPaymentSchema = z.object({
  reason: requiredText(3, 2000, "Void reason"),
});

export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

export const PAYMENT_SORT_KEYS = ["date-desc", "date-asc", "amount-desc", "amount-asc"] as const;
export type PaymentSortKey = (typeof PAYMENT_SORT_KEYS)[number];

export const paymentListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  direction: z.array(z.enum(PAYMENT_DIRECTIONS)).optional(),
  status: z.array(z.enum(PAYMENT_STATUSES)).optional(),
  method: z.array(z.enum(PAYMENT_METHODS)).optional(),
  invoiceId: z.string().optional(),
  expenseId: z.string().optional(),
  currency: z.string().optional(),
  paidFrom: optionalDate,
  paidTo: optionalDate,
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(25),
  sort: z.enum(PAYMENT_SORT_KEYS).default("date-desc"),
});

export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
