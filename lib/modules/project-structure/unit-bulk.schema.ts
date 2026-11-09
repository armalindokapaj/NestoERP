import { z } from "zod";

import { parseDecimalInput } from "@/lib/forms/decimal";
import { idSchema, unitDetailsChangeSchema } from "./structure.schema";
import { MAX_BULK_UNITS } from "./structure.types";

/**
 * A change to ticked units (2026-11-09): the units, each with the version the
 * person saw, and one change for all of them. One request, one `action`:
 *
 *   details   the technical fields touched — `project.unit.update`
 *   price     one total, or a rate per m² of each unit's sale area —
 *             `project.unit.price.manage`; `putOnSale` also puts the units
 *             not for sale on sale — `project.unit.sales_status.manage`
 *   status    put on sale or take off sale — `project.unit.sales_status.manage`
 *   move      another floor of the project — `project.unit.move`
 *   archive   out of use — `project.unit.archive`
 *
 * `version` is the version of what the action changes: the unit's own for
 * details, move and archive; its sales record's for price and status, where 0
 * means it has none yet (the unit page's own rule).
 */

/** As long as a sales reason may be (`SALES_REASON_MAX`). */
const REASON_MAX = 1_000;

const unitRef = z.object({ id: idSchema, version: z.number().int().min(0) });

const units = z
  .array(unitRef)
  .min(1, "Tick at least one unit.")
  .max(MAX_BULK_UNITS, `Change at most ${MAX_BULK_UNITS} units at once.`)
  .refine((list) => new Set(list.map((unit) => unit.id)).size === list.length, "A unit is ticked twice.");

/** A positive amount with at most two decimals, within DECIMAL(18,2), as the client's locale rule already read it. */
const amount = z.string().transform((value, ctx): string => {
  const parsed = parseDecimalInput(value, { label: "Amount", scale: 2, maxIntegerDigits: 15, min: "0.01" });
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.value;
});

const reason = z
  .string()
  .trim()
  .max(REASON_MAX, "Keep the reason under 1,000 characters.")
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const unitBulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), units, change: unitDetailsChangeSchema }),
  z.object({ action: z.literal("price"), units, entry: z.enum(["TOTAL", "PER_SQM"]), amount, reason, putOnSale: z.boolean().optional().default(false) }),
  z.object({ action: z.literal("status"), units, change: z.enum(["put_on_sale", "take_off_sale"]) }),
  z.object({ action: z.literal("move"), units, floorId: idSchema }),
  z.object({ action: z.literal("archive"), units }),
]);

export type UnitBulkInput = z.infer<typeof unitBulkSchema>;
export type UnitBulkRef = z.infer<typeof unitRef>;
