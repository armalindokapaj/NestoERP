import { z } from "zod";

import {
  businessDate,
  currencyCode,
  optionalBusinessDate,
} from "@/lib/modules/finance/finance.fields";
import {
  optionalEnum,
  optionalId,
  optionalText,
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

/** A quantity: positive, at most four decimals (PRD #19 §191). */
const quantityString = z
  .string()
  .trim()
  .min(1, "Enter a quantity")
  .transform((value) => value.replace(",", "."))
  .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Quantity must be a number with at most 4 decimal places",
  })
  .refine((value) => Number.parseFloat(value) > 0, { message: "Quantity must be more than zero" });

/** A unit price: non-negative, at most four decimals (PRD #19 §192). */
const unitPriceString = z
  .string()
  .trim()
  .min(1, "Enter a unit price")
  .transform((value) => value.replace(",", "."))
  .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Unit price must be a number with at most 4 decimal places",
  });

const optionalUnitPriceString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value.replace(",", ".")))
  .refine((value) => value === undefined || /^\d{1,14}(\.\d{1,4})?$/.test(value), {
    message: "Unit price must be a number with at most 4 decimal places",
  });

/** A tax rate as a fraction: 0.2 is twenty per cent (PRD #19 §194). */
const taxRateString = z
  .string()
  .trim()
  .default("0")
  .transform((value) => (value === "" ? "0" : value.replace(",", ".")))
  .refine((value) => /^\d(\.\d{1,4})?$/.test(value), {
    message: "Tax rate must be a fraction such as 0.2",
  })
  .refine((value) => Number.parseFloat(value) <= 1, { message: "Tax rate cannot exceed 1" });

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
  paymentTermsDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(365)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  defaultCurrency: z
    .union([currencyCode, z.literal("")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  notes: optionalText(4000),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

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
  specification: optionalText(2000),
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
  items: z.array(requestItemSchema).min(1, "A request needs at least one line"),
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

export const rfqItemSchema = z.object({
  id: optionalId,
  sourceRequestItemId: optionalId,
  description: requiredText(2, 400, "Item description"),
  quantity: quantityString,
  unit,
  specification: optionalText(2000),
});

export const rfqSchema = z.object({
  title: requiredText(2, 250, "Title"),
  purchaseRequestId: optionalId,
  projectId: optionalId,
  currency: currencyCode,
  responseDueDate: optionalBusinessDate,
  supplierIds: z.array(z.string().trim().min(1)).default([]),
  items: z.array(rfqItemSchema).min(1, "An enquiry needs at least one line"),
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

export const quoteItemSchema = z.object({
  rfqItemId: z.string().trim().min(1),
  quantity: quantityString,
  unitPrice: unitPriceString,
  taxRate: taxRateString,
  notes: optionalText(1000),
});

export const quoteSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier"),
  quoteNumber: optionalText(60),
  quoteDate: businessDate,
  validUntil: optionalBusinessDate,
  leadTimeDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  deliveryDate: optionalBusinessDate,
  notes: optionalText(2000),
  items: z.array(quoteItemSchema).min(1, "A quote needs at least one priced line"),
  versionUpdatedAt: z.coerce.date().optional(),
});

export type QuoteInput = z.infer<typeof quoteSchema>;

export const quoteDisqualifySchema = z.object({
  reason: requiredText(3, 1000, "Reason"),
});

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export const orderItemSchema = z.object({
  id: optionalId,
  sourceRequestItemId: optionalId,
  sourceQuoteItemId: optionalId,
  description: requiredText(2, 400, "Item description"),
  quantity: quantityString,
  unit,
  unitPrice: unitPriceString,
  taxRate: taxRateString,
});

export const orderSchema = z.object({
  supplierId: z.string().trim().min(1, "Choose a supplier"),
  purchaseRequestId: optionalId,
  rfqId: optionalId,
  supplierQuoteId: optionalId,
  projectId: optionalId,
  contractId: optionalId,
  orderDate: businessDate,
  requiredDate: optionalBusinessDate,
  currency: currencyCode,
  notes: optionalText(4000),
  items: z.array(orderItemSchema).min(1, "An order needs at least one line"),
  versionUpdatedAt: z.coerce.date().optional(),
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

export const receiptItemSchema = z.object({
  purchaseOrderItemId: z.string().trim().min(1),
  receivedQuantity: quantityString,
  rejectedQuantity: z
    .string()
    .trim()
    .default("0")
    .transform((value) => (value === "" ? "0" : value.replace(",", ".")))
    .refine((value) => /^\d{1,14}(\.\d{1,4})?$/.test(value), {
      message: "Rejected quantity must be a number with at most 4 decimal places",
    }),
  notes: optionalText(1000),
});

export const receiptSchema = z
  .object({
    receiptDate: businessDate,
    deliveryReference: optionalText(120),
    receivedByMemberId: optionalId,
    notes: optionalText(2000),
    /** Set after the server refused an over-receipt (PRD #19 §139). */
    acknowledgeOverReceipt: z.coerce.boolean().optional().default(false),
    items: z.array(receiptItemSchema).min(1, "Record what arrived on at least one line"),
  })
  .refine(
    (value) =>
      value.items.every(
        (item) =>
          Number.parseFloat(item.rejectedQuantity) <= Number.parseFloat(item.receivedQuantity),
      ),
    {
      message: "You cannot reject more than arrived.",
      path: ["items"],
    },
  );

export type ReceiptInput = z.infer<typeof receiptSchema>;

export const receiptVoidSchema = z.object({
  reason: requiredText(3, 1000, "Reason"),
});

/* -------------------------------------------------------------------------- */
/* Lifecycle notes                                                             */
/* -------------------------------------------------------------------------- */

export const procurementNoteSchema = z.object({ note: optionalText(2000) });
export const procurementReasonSchema = z.object({ note: requiredText(3, 2000, "Reason") });
