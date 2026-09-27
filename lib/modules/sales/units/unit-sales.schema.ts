import { z } from "zod";

import { parseDecimalInput } from "@/lib/forms/decimal";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";

import { SUPPORTED_CURRENCIES } from "@/lib/modules/finance/finance.currency";
import { idSchema } from "@/lib/modules/project-structure/structure.schema";
import { SALES_NOTES_MAX, SALES_REASON_MAX, UNIT_COMMERCIAL_STATUSES, UNIT_PRICE_BASES } from "./unit-sales.types";

/**
 * Unit sales validation (E-05E §45, §47). Ids are shapes only; whether a client or
 * deal is the reader's, and belongs together, is the service's question — which
 * is also where "Select a Client before reserving this Unit" is said (§48).
 */

const currency = z.enum(SUPPORTED_CURRENCIES as unknown as [string, ...string[]]);

/**
 * A non-negative amount, two decimals at most, within DECIMAL(18,2); kept as a
 * string. Empty is "no amount" (null). Read by the shared decimal rule (AUD-09
 * §4, FV-06): `1,234` is refused as ambiguous, not read as 1.234.
 */
const money = z
  .unknown()
  .transform((value, ctx): string | null => {
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (text === undefined || text === null || (typeof text === "string" && text.trim() === "")) return null;
    if (typeof text !== "string") {
      ctx.addIssue({ code: "custom", message: "Enter an amount of 0 or more, with at most two decimals." });
      return z.NEVER;
    }
    const parsed = parseDecimalInput(text, { label: "Amount", ...MONEY_RULE });
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message });
      return z.NEVER;
    }
    return parsed.value;
  });

const reason = z.string().trim().min(1, "Give a reason.").max(SALES_REASON_MAX, `Keep the reason under ${SALES_REASON_MAX.toLocaleString("en")} characters.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const instant = z.coerce.date({ error: "Choose a date." });
const expectedVersion = z.number().int().min(1).optional();

export const commercialDetailsSchema = z.object({
  askingPrice: money,
  currency: currency.nullable().optional(),
  priceBasis: z.enum(UNIT_PRICE_BASES),
  salesNotes: optionalText(SALES_NOTES_MAX),
  reason: optionalText(SALES_REASON_MAX),
  expectedVersion,
});

export const SALE_STATUS_ACTIONS = ["put_on_sale", "take_off_sale", "hold", "release_hold"] as const;
export const saleStatusSchema = z.object({
  action: z.enum(SALE_STATUS_ACTIONS),
  reason: optionalText(SALES_REASON_MAX),
  holdUntil: instant.optional().nullable(),
  expectedVersion,
});

export const reserveSchema = z.object({
  clientId: idSchema.optional(),
  newClient: z
    .object({
      name: z.string().trim().min(2, "Give the client's name.").max(200),
      type: z.enum(["INDIVIDUAL", "COMPANY", "PUBLIC_ENTITY", "OTHER"]).default("INDIVIDUAL"),
      email: z.string().trim().email("Enter a valid email address.").max(254).optional().or(z.literal("")),
      phone: z.string().trim().max(40).optional(),
      /** Create it even though a similar client exists — after the reader has seen them (PRD #12 §53). */
      acceptDuplicate: z.boolean().optional(),
    })
    .optional(),
  opportunityId: idSchema.optional(),
  newDeal: z.object({ name: z.string().trim().max(200).optional() }).optional(),
  expiresAt: instant.optional(),
  agreedPrice: money.optional(),
  currency: currency.optional(),
  notes: optionalText(SALES_NOTES_MAX),
  expectedVersion,
});

export const extendReservationSchema = z.object({ expiresAt: instant, reason, expectedVersion });
export const releaseReservationSchema = z.object({ reason, expectedVersion });
export const correctReservationSchema = z.object({ agreedPrice: money, currency: currency.nullable().optional(), notes: optionalText(SALES_NOTES_MAX), reason, expectedVersion });
export const markSoldSchema = z.object({ expectedVersion });
export const reopenSaleSchema = z.object({ to: z.enum(["FOR_SALE", "RESERVED"]), reason, expiresAt: instant.optional(), expectedVersion });
export const dealUnitSchema = z.object({ unitId: idSchema, agreedPrice: money.optional(), currency: currency.optional() });

export const INVENTORY_SORTS = ["structure", "code", "price", "-price", "pricePerSqm", "-pricePerSqm", "area", "-area", "expiry"] as const;
export type InventorySort = (typeof INVENTORY_SORTS)[number];

const optionalId = idSchema.optional().catch(undefined);
const optionalCount = z.coerce.number().int().min(0).max(10_000).optional().catch(undefined);
const optionalAmount = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).optional().catch(undefined);

export const inventoryQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  buildingId: optionalId,
  floorId: optionalId,
  unitTypeId: optionalId,
  commercialStatus: z.enum(UNIT_COMMERCIAL_STATUSES).optional().catch(undefined),
  areaMin: optionalAmount,
  areaMax: optionalAmount,
  bedrooms: optionalCount,
  bathrooms: optionalCount,
  orientation: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "MULTI", "UNKNOWN"]).optional().catch(undefined),
  position: z.enum(["FRONT", "REAR", "CORNER", "INTERNAL", "LEFT", "RIGHT", "CENTER", "OTHER"]).optional().catch(undefined),
  priceMin: optionalAmount,
  priceMax: optionalAmount,
  pricePerSqmMin: optionalAmount,
  pricePerSqmMax: optionalAmount,
  sort: z.enum(INVENTORY_SORTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});
export type InventoryQuery = z.infer<typeof inventoryQuerySchema> & { page: number; limit: number };

export function parseInventoryQuery(search: URLSearchParams | Record<string, string | string[] | undefined>): InventoryQuery {
  const entries: Record<string, string> = {};
  if (search instanceof URLSearchParams) {
    for (const [key, value] of search.entries()) if (value !== "") entries[key] = value;
  } else {
    for (const [key, value] of Object.entries(search)) {
      const one = Array.isArray(value) ? value[0] : value;
      if (one !== undefined && one !== "") entries[key] = one;
    }
  }
  const parsed = inventoryQuerySchema.parse(entries);
  return { ...parsed, page: parsed.page ?? 1, limit: parsed.limit ?? 50 };
}

/** Asking for, and deciding, a sale's approval under the Manual approval rule (E-05F §42). */
export const saleApprovalRequestSchema = z.object({ note: optionalText(SALES_REASON_MAX) });
export const saleApprovalDecisionSchema = z.object({ note: optionalText(SALES_REASON_MAX) });
