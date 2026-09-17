import { z } from "zod";

import { idSchema } from "@/lib/modules/project-structure/structure.schema";
import { toBusinessDate } from "../finance.fields";
import { PAYMENT_METHODS } from "../payments/payment.schema";
import { FINANCE_REASON_MAX, INSTALLMENT_TYPES, MAX_INSTALLMENTS, UNIT_FINANCIAL_STATUSES } from "./unit-finance.types";

/**
 * Validation for collecting a unit's sale (E-05F §110). Shapes only: whether a
 * total matches, a payment fits or an installment still owes money is the
 * service's question, asked under its locks.
 */

const blank = (value: unknown) => (value === "" || value === undefined ? undefined : value);

/** An amount of zero or more with at most two decimals, kept a string (§73). */
const amount = (label: string, positive = false) =>
  z.preprocess(
    (value) => (typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/\s/g, "").replace(",", ".") : value),
    z
      .string({ error: `Enter the ${label}.` })
      .regex(/^\d{1,16}(\.\d{1,2})?$/, `Enter the ${label} as a number with at most two decimals.`)
      .refine((value) => !positive || Number(value) > 0, `The ${label} must be greater than zero.`),
  );

/** A calendar date, stored at midday UTC like every finance date (PRD #15 §257). */
const businessDay = (label: string) => z.coerce.date({ error: `Choose the ${label}.` }).transform(toBusinessDate);

const reason = z.string().trim().min(3, "Give a reason.").max(FINANCE_REASON_MAX, `Keep the reason under ${FINANCE_REASON_MAX.toLocaleString("en")} characters.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const expectedVersion = z.number().int().min(1).optional();

export const installmentInputSchema = z.object({
  label: z.string().trim().min(1, "Give each installment a label.").max(120, "Keep the label under 120 characters."),
  type: z.enum(INSTALLMENT_TYPES).default("INSTALLMENT"),
  amount: amount("installment amount"),
  dueDate: businessDay("due date"),
  notes: optionalText(500),
});

const installments = z.array(installmentInputSchema).min(1, "Add at least one installment.").max(MAX_INSTALLMENTS, `A schedule has at most ${MAX_INSTALLMENTS} installments.`);

export const createScheduleSchema = z.object({
  installments,
  notes: optionalText(2_000),
  /** Start from the schedule in force, to revise it rather than retype it (§25). */
  copyCurrent: z.boolean().optional(),
});

export const updateScheduleSchema = z.object({
  installments,
  notes: optionalText(2_000),
  expectedVersion,
});

export const activateScheduleSchema = z.object({
  /** Given only when the installments deliberately do not add up; needs the correction grant (§24). */
  exceptionReason: optionalText(FINANCE_REASON_MAX),
  expectedVersion,
});

export const discardScheduleSchema = z.object({ reason: optionalText(FINANCE_REASON_MAX), expectedVersion });

export const allocationInputSchema = z.object({
  installmentId: idSchema,
  amount: amount("allocation", true),
});

export const recordContractPaymentSchema = z.object({
  amount: amount("payment amount", true),
  paymentDate: businessDay("payment date"),
  method: z.enum(PAYMENT_METHODS, { message: "Choose a payment method" }),
  reference: optionalText(200),
  notes: optionalText(2_000),
  /** What the money pays. Anything left over stays unallocated for Finance to review (§34). */
  allocations: z.array(allocationInputSchema).max(MAX_INSTALLMENTS).default([]),
  /** Recorded anyway, after the reader has seen a payment that looks the same (§78). */
  acceptDuplicate: z.boolean().optional(),
  /** A voided payment of the same contract this one replaces (§81). */
  replacesPaymentId: z.preprocess(blank, idSchema.optional()),
});

export const allocatePaymentSchema = z.object({
  allocations: z.array(allocationInputSchema).min(1, "Allocate some of the payment.").max(MAX_INSTALLMENTS),
});

export const reverseAllocationSchema = z.object({ reason });

export const issueInvoiceSchema = z.object({
  issueDate: z.preprocess(blank, businessDay("issue date").optional()),
  dueDate: z.preprocess(blank, businessDay("due date").optional()),
});

export const FINANCE_INVENTORY_SORTS = ["structure", "code", "outstanding", "-outstanding", "overdue", "nextDue", "value"] as const;

const optionalNumberText = z.preprocess(blank, z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).optional());

export const financeInventoryQuerySchema = z.object({
  q: z.preprocess(blank, z.string().trim().max(200).optional()),
  buildingId: z.preprocess(blank, idSchema.optional()),
  floorId: z.preprocess(blank, idSchema.optional()),
  unitTypeId: z.preprocess(blank, idSchema.optional()),
  clientId: z.preprocess(blank, idSchema.optional()),
  contractStatus: z.preprocess(blank, z.string().regex(/^[A-Z_]{3,30}$/).optional()),
  financialStatus: z.preprocess(blank, z.enum(UNIT_FINANCIAL_STATUSES).optional()),
  overdue: z.preprocess((value) => (value === "1" || value === "true" || value === true ? true : undefined), z.boolean().optional()),
  dueFrom: z.preprocess(blank, businessDay("start date").optional()),
  dueTo: z.preprocess(blank, businessDay("end date").optional()),
  currency: z.preprocess(blank, z.string().regex(/^[A-Z]{3}$/).optional()),
  outstandingMin: optionalNumberText,
  sort: z.preprocess(blank, z.enum(FINANCE_INVENTORY_SORTS).default("structure")),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type FinanceInventoryQuery = z.infer<typeof financeInventoryQuerySchema>;

/** Query parameters as a page or a route receives them; a value that does not parse is dropped rather than refused. */
export function parseFinanceInventoryQuery(search: URLSearchParams | Record<string, string | string[] | undefined>): FinanceInventoryQuery {
  return parseLeniently(financeInventoryQuerySchema, search);
}

export function parseLeniently<T extends z.ZodTypeAny>(schema: T, search: URLSearchParams | Record<string, string | string[] | undefined>): z.infer<T> {
  const entries: Record<string, string> = {};
  if (search instanceof URLSearchParams) {
    for (const [key, value] of search.entries()) if (value !== "") entries[key] = value;
  } else {
    for (const [key, value] of Object.entries(search)) {
      const one = Array.isArray(value) ? value[0] : value;
      if (one !== undefined && one !== "") entries[key] = one;
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = schema.safeParse(entries);
    if (result.success) return result.data;
    const bad = new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "")));
    if (bad.size === 0 || [...bad].every((key) => !(key in entries))) break;
    for (const key of bad) delete entries[key];
  }
  return schema.parse({});
}
