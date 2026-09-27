import { z } from "zod";

import { compareDecimal, integerDigits, multiplyDecimal } from "@/lib/modules/finance/finance.decimal";
import { MAX_LINE_ITEMS } from "@/lib/modules/finance/finance.form-data";
import {
  businessDate,
  currencyCode,
  decimalString,
  optionalBusinessDate,
  optionalDecimalString,
  optionalWholeNumber,
  positive,
  RATE_RULE,
} from "@/lib/modules/finance/finance.fields";
import {
  optionalBoolean,
  optionalEnum,
  optionalId,
  optionalText,
  patchId,
  patchText,
  requiredText,
} from "@/lib/modules/shared/fields";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import {
  CATEGORIES,
  ORDER_STATUSES,
  PRIORITIES,
  REQUEST_STATUSES,
  RFQ_STATUSES,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
} from "./procurement.status";

/**
 * Procurement validation (PRD #19 §191–§195, §210).
 *
 * `status` and every actor field are absent on purpose. Status moves through
 * named lifecycle actions and nowhere else, so there is nothing for a generic
 * update to set and nothing for a browser to lie about (PRD #19 §19).
 *
 * Money and quantity arrive as strings and stay strings until Prisma turns them
 * into decimals. Parsing them into JavaScript numbers on the way in would round
 * a purchase order before anybody had a chance to check it (PRD #19 §190).
 */

/*
 * Numbers go through the one decimal rule every module shares (AUD-09 §4,
 * FV-06): `1,000` used to become 1 here (a first-comma replace), `1e3` and
 * `12abc` were refused only by luck of the regex, and a comparison was a float
 * one. Quantity and unit price carry four decimals within `Decimal(18, 4)`;
 * no value is negative in Procurement.
 */

/** A quantity: positive, at most four decimals (PRD #19 §191). */
const quantityString = decimalString("Quantity", RATE_RULE).refine(positive, {
  message: "Quantity must be more than zero",
});

/** A unit price: non-negative, at most four decimals (PRD #19 §192). */
const unitPriceString = decimalString("Unit price", RATE_RULE);

/** An estimate nobody has made yet is empty, not a price of zero (PRD #19 §48). */
const optionalUnitPriceString = optionalDecimalString("Estimated unit price", RATE_RULE);

/**
 * A tax rate as a fraction: 0.2 is twenty per cent (PRD #19 §194). Empty is
 * "no tax" — a rate of 0 by the domain's rule, not by a generic parser.
 */
const taxRateString = optionalDecimalString("Tax rate", { scale: 4, maxIntegerDigits: 1 })
  .transform((value) => value ?? "0")
  .refine((value) => compareDecimal(value, "1") <= 0, { message: "Tax rate is a fraction such as 0.2 and cannot exceed 1" });

/** A priced line whose total would not fit its `Decimal(18, 2)` column is refused on the line. */
function lineFits(line: { quantity: string; unitPrice: string }, ctx: z.RefinementCtx) {
  if (integerDigits(multiplyDecimal(line.quantity, line.unitPrice, 2)) > 13) {
    ctx.addIssue({ code: "custom", path: ["unitPrice"], message: "This line's total is too large. Check the quantity and unit price." });
  }
}

/** A later date must not fall before an earlier one; the message sits on the later field. */
function inOrder(first: Date | undefined, second: Date | undefined | null): boolean {
  return !first || !second || second.getTime() >= first.getTime();
}

/** Every line carries a unit; "each" is a unit, "" is a missing answer (§195). */
const unit = requiredText(1, 24, "Unit");

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export const supplierSchema = z.object({
  code: optionalText(40),
  name: requiredText(2, 200, "Supplier name"),
  legalName: optionalText(250),
  supplierType: z.enum(SUPPLIER_TYPES).default("COMPANY"),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  email: z.union([z.string().trim().email(), z.literal("")]).optional().transform((v) => (v === "" ? undefined : v)),
  phone: optionalText(40),
  website: z
    .union([z.string().trim().url(), z.literal("")])
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    // Only http(s) reaches the database; anything else is a link nobody should
    // be invited to click (PRD #19 §26).
    .refine((v) => v === undefined || /^https?:\/\//i.test(v), {
      message: "The website must start with http:// or https://",
    }),
  taxId: optionalText(60),
  registrationNumber: optionalText(60),
  address: optionalText(400),
  city: optionalText(120),
  country: optionalText(120),
  // Empty is "not set", never 0 days; "1e2" is not 100 (AUD-09 §4, FV-06).
  paymentTermsDays: optionalWholeNumber("Payment terms", 0, 365),
  defaultCurrency: z
    .union([currencyCode, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  notes: optionalText(4000),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/**
 * An edit of a supplier (AUD-09 §4, FV-05): type and status have no create
 * default here, so a request that leaves them out keeps what is saved rather
 * than reactivating an inactive supplier.
 */
export const supplierUpdateSchema = supplierSchema.extend({
  supplierType: z.enum(SUPPLIER_TYPES).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

/**
 * The Group workspace's `company` filter (Workspace Context §86, §87). A
 * refinement of what the workspace already allows, never authority: the
 * workspace entry points check it against the companies the person may read and
 * ignore an id they may not. A company workspace does not read it at all.
 */
const companyFilter = z.string().trim().max(120).optional();

export const supplierListQuerySchema = paginationSchema.extend({
  companyId: companyFilter,
  search: z.string().trim().max(200).optional(),
  status: z.array(z.enum(SUPPLIER_STATUSES)).optional(),
  supplierType: z.array(z.enum(SUPPLIER_TYPES)).optional(),
  country: z.string().trim().max(120).optional(),
  sort: z
    .enum(["name-asc", "name-desc", "updated-desc", "created-desc", "code-asc"])
    .default("name-asc"),
});

export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Purchase requests                                                           */
/* -------------------------------------------------------------------------- */

export const requestItemSchema = z.object({
  id: optionalId,
  description: requiredText(2, 400, "Item description"),
  quantity: quantityString,
  unit,
  estimatedUnitPrice: optionalUnitPriceString,
  category: optionalEnum(CATEGORIES),
  // Absent keeps the saved specification (the editor has no input for it);
  // empty clears it (AUD-09 §4, FV-05).
  specification: patchText(2000),
});

export const requestSchema = z.object({
  title: requiredText(2, 250, "Title"),
  description: optionalText(4000),
  projectId: optionalId,
  departmentId: optionalId,
  ownerMemberId: optionalId,
  requiredDate: optionalBusinessDate,
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  currency: z
    .union([currencyCode, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  items: z
    .array(requestItemSchema)
    .min(1, "A request needs at least one line")
    .max(MAX_LINE_ITEMS, `A request can have at most ${MAX_LINE_ITEMS} lines`),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type RequestInput = z.infer<typeof requestSchema>;
export type RequestItemInput = z.infer<typeof requestItemSchema>;

export const requestListQuerySchema = paginationSchema.extend({
  companyId: companyFilter,
  search: z.string().trim().max(200).optional(),
  view: z
    .enum(["all", "mine", "drafts", "pending", "approved", "sourcing", "ordered", "archived"])
    .default("all"),
  status: z.array(z.enum(REQUEST_STATUSES)).optional(),
  priority: z.array(z.enum(PRIORITIES)).optional(),
  projectId: z.string().optional(),
  departmentId: z.string().optional(),
  requestedByMemberId: z.string().optional(),
  category: z.array(z.enum(CATEGORIES)).optional(),
  sort: z
    .enum([
      "updated-desc",
      "created-desc",
      "number-asc",
      "required-asc",
      "priority-desc",
      "value-desc",
      "status-asc",
    ])
    .default("updated-desc"),
});

export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* RFQs and quotes                                                             */
/* -------------------------------------------------------------------------- */

/** As on a request line: what the editor does not send is kept on an edit (FV-05). */
export const rfqItemSchema = z.object({
  id: optionalId,
  sourceRequestItemId: patchId,
  description: requiredText(2, 400, "Item description"),
  quantity: quantityString,
  unit,
  specification: patchText(2000),
});

export const rfqSchema = z.object({
  title: requiredText(2, 250, "Title"),
  purchaseRequestId: optionalId,
  projectId: optionalId,
  currency: currencyCode,
  responseDueDate: optionalBusinessDate,
  supplierIds: z.array(z.string().trim().min(1)).default([]),
  items: z
    .array(rfqItemSchema)
    .min(1, "An enquiry needs at least one line")
    .max(MAX_LINE_ITEMS, `An enquiry can have at most ${MAX_LINE_ITEMS} lines`),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type RfqInput = z.infer<typeof rfqSchema>;

export const rfqListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  view: z.enum(["all", "draft", "issued", "closed"]).default("all"),
  status: z.array(z.enum(RFQ_STATUSES)).optional(),
  projectId: z.string().optional(),
  sort: z
    .enum(["updated-desc", "created-desc", "number-asc", "due-asc"])
    .default("updated-desc"),
});

export type RfqListQuery = z.infer<typeof rfqListQuerySchema>;

export const quoteItemSchema = z
  .object({
    rfqItemId: z.string().trim().min(1),
    quantity: quantityString,
    unitPrice: unitPriceString,
    taxRate: taxRateString,
    notes: optionalText(1000),
  })
  .superRefine(lineFits);

/**
 * A quote's dates are calendar dates in order (AUD-09 §4, FV-07): it cannot be
 * valid, or deliver, before the day it was given.
 */
export const quoteSchema = z
  .object({
    supplierId: z.string().trim().min(1, "Choose a supplier"),
    quoteNumber: optionalText(60),
    quoteDate: businessDate,
    validUntil: optionalBusinessDate,
    leadTimeDays: optionalWholeNumber("Lead time", 0, 3650),
    deliveryDate: optionalBusinessDate,
    notes: optionalText(2000),
    items: z
      .array(quoteItemSchema)
      .min(1, "A quote needs at least one priced line")
      .max(MAX_LINE_ITEMS, `A quote can have at most ${MAX_LINE_ITEMS} lines`)
      .refine((items) => new Set(items.map((item) => item.rfqItemId)).size === items.length, {
        message: "Price each enquiry line once.",
      }),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => inOrder(value.quoteDate, value.validUntil), {
    message: "A quote cannot expire before the date it was given.",
    path: ["validUntil"],
  })
  .refine((value) => inOrder(value.quoteDate, value.deliveryDate), {
    message: "Delivery cannot be before the date of the quote.",
    path: ["deliveryDate"],
  });

export type QuoteInput = z.infer<typeof quoteSchema>;

export const quoteDisqualifySchema = z.object({
  reason: requiredText(3, 1000, "Reason"),
});

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export const orderItemSchema = z
  .object({
    id: optionalId,
    sourceRequestItemId: optionalId,
    sourceQuoteItemId: optionalId,
    description: requiredText(2, 400, "Item description"),
    quantity: quantityString,
    unit,
    unitPrice: unitPriceString,
    taxRate: taxRateString,
  })
  .superRefine(lineFits);

/**
 * `rfqId`, `supplierQuoteId` and `contractId` follow the partial-update rule
 * (AUD-09 §4, FV-05, FV-10): the order form never sends the quote links, and
 * sends the contract only to someone who may see contracts — so on an edit an
 * absent key keeps the saved link, and only an explicit empty value clears it.
 */
export const orderSchema = z
  .object({
    supplierId: z.string().trim().min(1, "Choose a supplier"),
    purchaseRequestId: optionalId,
    rfqId: patchId,
    supplierQuoteId: patchId,
    projectId: optionalId,
    contractId: patchId,
    orderDate: businessDate,
    requiredDate: optionalBusinessDate,
    currency: currencyCode,
    notes: optionalText(4000),
    items: z
      .array(orderItemSchema)
      .min(1, "An order needs at least one line")
      .max(MAX_LINE_ITEMS, `An order can have at most ${MAX_LINE_ITEMS} lines`),
    versionUpdatedAt: z.coerce.date().optional(),
  })
  .refine((value) => inOrder(value.orderDate, value.requiredDate), {
    message: "The required date cannot be before the order date.",
    path: ["requiredDate"],
  });

export type OrderInput = z.infer<typeof orderSchema>;

export const orderListQuerySchema = paginationSchema.extend({
  companyId: companyFilter,
  search: z.string().trim().max(200).optional(),
  view: z
    .enum(["all", "draft", "pending", "issued", "receiving", "closed", "archived"])
    .default("all"),
  status: z.array(z.enum(ORDER_STATUSES)).optional(),
  supplierId: z.string().optional(),
  projectId: z.string().optional(),
  currency: z.string().optional(),
  sort: z
    .enum([
      "updated-desc",
      "created-desc",
      "number-asc",
      "order-desc",
      "required-asc",
      "value-desc",
      "status-asc",
    ])
    .default("updated-desc"),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Goods receipts                                                              */
/* -------------------------------------------------------------------------- */

export const receiptItemSchema = z
  .object({
    purchaseOrderItemId: z.string().trim().min(1),
    receivedQuantity: decimalString("Received quantity", RATE_RULE).refine(positive, {
      message: "Received quantity must be more than zero",
    }),
    // Nothing rejected is a rejection of 0, by the domain's rule.
    rejectedQuantity: optionalDecimalString("Rejected quantity", RATE_RULE).transform((value) => value ?? "0"),
    notes: optionalText(1000),
  })
  // Exact, on the line it concerns (AUD-09 §4, §7): a float comparison let a
  // rejection slightly above what arrived through.
  .refine((item) => compareDecimal(item.rejectedQuantity, item.receivedQuantity) <= 0, {
    message: "You cannot reject more than arrived.",
    path: ["rejectedQuantity"],
  });

export const receiptSchema = z
  .object({
    receiptDate: businessDate,
    deliveryReference: optionalText(120),
    receivedByMemberId: optionalId,
    notes: optionalText(2000),
    /** Set after the server refused an over-receipt (PRD #19 §139). */
    // "false" is false: `z.coerce.boolean()` read the string as true (AUD-09 §4).
    acknowledgeOverReceipt: optionalBoolean.transform((value) => value ?? false),
    items: z
      .array(receiptItemSchema)
      .min(1, "Record what arrived on at least one line")
      .max(MAX_LINE_ITEMS)
      .refine((items) => new Set(items.map((item) => item.purchaseOrderItemId)).size === items.length, {
        message: "Record each order line once.",
      }),
  });

export type ReceiptInput = z.infer<typeof receiptSchema>;

export const receiptVoidSchema = z.object({
  reason: requiredText(3, 1000, "Reason"),
});

/* -------------------------------------------------------------------------- */
/* Lifecycle notes                                                             */
/* -------------------------------------------------------------------------- */

export const procurementNoteSchema = z.object({ note: optionalText(2000) });
export const procurementReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });
