import { z } from "zod";

import { idSchema } from "@/lib/modules/project-structure/structure.schema";
import { currency, money, optionalText } from "./unit-sales.schema";
import { SALES_REASON_MAX, UNIT_PRICE_BASES } from "./unit-sales.types";
import { MAX_PRICE_LIST_CHANGES } from "./unit-pricing.types";

/**
 * Saving a price list (2026-11): the prices that changed, each with the version
 * of the unit's sales it was read at (0 while the unit had none), all in one
 * currency, with one optional reason for the history, and whether the units
 * priced that are not for sale also go on sale. Whether each unit is the
 * project's, active and not sold is the service's question.
 */
export const priceListSaveSchema = z
  .object({
    currency,
    reason: optionalText(SALES_REASON_MAX),
    /** "Also put them on sale" (2026-11-09): after the prices save, the units priced here that are not for sale go on sale. */
    putOnSale: z.boolean().optional().default(false),
    prices: z
      .array(
        z.object({
          unitId: idSchema,
          askingPrice: money,
          priceBasis: z.enum(UNIT_PRICE_BASES),
          expectedVersion: z.number().int().min(0),
        }),
      )
      .min(1, "Change at least one price.")
      .max(MAX_PRICE_LIST_CHANGES, `Save at most ${MAX_PRICE_LIST_CHANGES} prices at a time.`),
  })
  .refine((input) => new Set(input.prices.map((price) => price.unitId)).size === input.prices.length, { message: "Each unit is priced once.", path: ["prices"] });

export type PriceListSaveInput = z.infer<typeof priceListSaveSchema>;
