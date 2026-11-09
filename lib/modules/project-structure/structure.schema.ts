import { z } from "zod";

import { UNIT_TYPE_CATEGORIES, UNIT_TYPE_CODE_MAX, UNIT_TYPE_NAME_MAX } from "@/config/unit-types";
import { COUNT_CHOICES, type CountField, FLOOR_LEVEL_TYPES, MAX_BULK_FLOORS, MAX_BULK_UNITS, UNIT_MISSING_KINDS, UNIT_ORIENTATIONS, UNIT_SORTS, UNIT_PAGE_SIZE } from "./structure.types";

/**
 * Structure validation (E-05B §72, §124-§126). Ids are shapes only: whether a
 * building, floor, unit or unit type belongs to this project and company is
 * the service's question (§117). Areas arrive as numbers or strings and leave
 * as exact two-decimal strings — never a float (§23, §73).
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const idSchema = z.string().regex(ID, "Unknown record.");

export const NAME_MAX = 120;
export const CODE_MAX = 40;
export const UNIT_CODE_MAX = 80;
export const TEXT_MAX = 1_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max.toLocaleString("en")} characters.`)
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));

const blankToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

/** A non-negative area in m², at most two decimals, within DECIMAL(12,2). */
const area = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : blankToNull(typeof value === "string" ? value.trim() : value)),
  z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter an area of 0 or more, with at most two decimals.")
    .nullable(),
);

/** Metres, may be below the datum, within DECIMAL(10,2). */
const metres = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "number" ? String(value) : blankToNull(typeof value === "string" ? value.trim() : value)),
    z.string().regex(/^-?\d{1,8}(\.\d{1,2})?$/, message).nullable(),
  );

/** A count chosen from its short list (2026-11): bedrooms 0-3, bathrooms 1-3, storage 0-1. */
const choice = (field: CountField, message: string) => {
  const choices = COUNT_CHOICES[field];
  return z.preprocess(
    (value) => (typeof value === "string" ? (value.trim() === "" ? null : Number(value)) : blankToNull(value)),
    z.number({ error: message }).int(message).refine((value) => choices.includes(value), message).nullable(),
  );
};

const expectedVersion = z.number().int().min(1);
const dryRun = z.boolean().optional().default(false);

/* Buildings ---------------------------------------------------------------- */

const buildingFields = {
  name: z.string().trim().min(1, "Give the building a name.").max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`),
  code: optionalText(CODE_MAX),
  description: optionalText(TEXT_MAX),
};

export const createBuildingSchema = z.object(buildingFields);
export const updateBuildingSchema = z.object({ ...buildingFields, isActive: z.boolean(), expectedVersion });
export const reorderSchema = z.object({ ids: z.array(idSchema).min(1).max(2_000) });

export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingSchema>;

/* Floors ------------------------------------------------------------------- */

const floorNumber = z.preprocess(
  (value) => (typeof value === "string" ? (value.trim() === "" ? null : Number(value)) : blankToNull(value)),
  z.number({ error: "The floor number is a whole number." }).int("The floor number is a whole number.").min(-50, "Floors go down to -50.").max(500, "Floors go up to 500.").nullable(),
);

const floorFields = {
  number: floorNumber,
  name: z.string().trim().min(1, "Give the floor a name.").max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`),
  levelType: z.enum(FLOOR_LEVEL_TYPES),
};

/** A standard floor, a basement or the ground floor is a numbered level (§12). */
function numbered(value: { number: number | null; levelType: string }, ctx: z.RefinementCtx) {
  if (value.number === null && ["STANDARD", "BASEMENT", "GROUND"].includes(value.levelType)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["number"], message: "Give this level its number." });
  }
  if (value.number !== null && value.levelType === "BASEMENT" && value.number >= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["number"], message: "A basement is below ground: use -1, -2…" });
}

export const createFloorSchema = z.object({ ...floorFields, elevation: metres("Enter the elevation in metres, with at most two decimals."), description: optionalText(TEXT_MAX) }).superRefine(numbered);
export const updateFloorSchema = z
  .object({ ...floorFields, elevation: metres("Enter the elevation in metres, with at most two decimals."), description: optionalText(TEXT_MAX), isActive: z.boolean(), expectedVersion })
  .superRefine(numbered);
/**
 * An entry of a range that the building already has: the floor it is, the
 * version the preview saw, and whether to make it active again. The entry's
 * name is the name the floor ends with — its own name to keep it, another to
 * rename it. An entry that only keeps a floor as it is is not sent at all.
 */
const existingFloor = z.object({ floorId: idSchema, expectedVersion, reactivate: z.boolean().optional().default(false) });

export const bulkFloorsSchema = z.object({
  floors: z
    .array(z.object({ ...floorFields, existing: existingFloor.optional() }).superRefine(numbered))
    .min(1, "Add at least one floor.")
    .max(MAX_BULK_FLOORS, `Create at most ${MAX_BULK_FLOORS} floors at once.`),
  confirmLarge: z.boolean().optional().default(false),
  dryRun,
});
export const moveFloorSchema = z.object({ buildingId: idSchema, expectedVersion });

export type CreateFloorInput = z.infer<typeof createFloorSchema>;
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;
export type BulkFloorsInput = z.infer<typeof bulkFloorsSchema>;

/* Units -------------------------------------------------------------------- */

const attributes = z
  .object({
    covered: z.boolean().optional(),
    evReady: z.boolean().optional(),
    frontage: metres("Enter the frontage in metres, with at most two decimals.").optional(),
    ceilingHeight: metres("Enter the ceiling height in metres, with at most two decimals.").optional(),
  })
  .strict()
  .optional()
  .nullable()
  .transform((value) => value ?? null);

const unitCode = z.string().trim().min(1, "Give the unit a code.").max(UNIT_CODE_MAX, `Keep the code under ${UNIT_CODE_MAX} characters.`);

/**
 * Everything technical about a unit except its code (§17, §28). A unit has no
 * name, position or room count any more (2026-11); a request that still sends
 * them has them ignored. The net area is never sent, and the gross area counts
 * only for land: the server works both out from the areas they add up from.
 */
const technicalFields = {
  unitTypeId: idSchema,
  orientation: z.enum(UNIT_ORIENTATIONS).optional().nullable().transform((value) => value ?? null),
  internalArea: area,
  balconyArea: area,
  terraceArea: area,
  commonAreaAllocation: area,
  grossArea: area,
  saleableArea: area,
  outdoorArea: area,
  gardenArea: area,
  bedrooms: choice("bedrooms", "Choose 0 to 3 bedrooms."),
  bathrooms: choice("bathrooms", "Choose 1 to 3 bathrooms."),
  storage: choice("storage", "Choose 0 or 1 storage room."),
  attributes,
  description: optionalText(TEXT_MAX),
};

export const createUnitSchema = z.object({ unitCode, ...technicalFields });
/**
 * A unit edit (AUD-09 §4, FV-05): the code, the type and the version are
 * always sent; every other technical field may be left out and then keeps its
 * saved value — an absent area used to become `null` and erase it. `null` (or
 * `""`) clears. The dialog sends every field. `isActive` too keeps its saved
 * value when left out: the dialog has had no Active tick since a unit leaves
 * use by Archive (2026-11-09).
 */
const keptTechnical = Object.fromEntries(
  Object.entries(technicalFields).map(([key, schema]) => [key, key === "unitTypeId" ? schema : (schema as z.ZodTypeAny).optional()]),
) as { [K in keyof typeof technicalFields]: K extends "unitTypeId" ? (typeof technicalFields)[K] : z.ZodOptional<(typeof technicalFields)[K]> };

export const updateUnitSchema = z.object({ unitCode, ...keptTechnical, isActive: z.boolean().optional(), expectedVersion });

/**
 * One change for many units (2026-11-09, "Edit details" on ticked units): the
 * technical fields the person touched, each optional — a field left out keeps
 * every unit's own value, `null` clears it. Not the code, which is each unit's
 * own, nor the gross area or attributes, which belong to one unit's type.
 */
export const BULK_DETAIL_FIELDS = ["unitTypeId", "orientation", "internalArea", "balconyArea", "terraceArea", "commonAreaAllocation", "saleableArea", "outdoorArea", "gardenArea", "bedrooms", "bathrooms", "storage", "description"] as const satisfies ReadonlyArray<keyof typeof technicalFields>;
export type BulkDetailField = (typeof BULK_DETAIL_FIELDS)[number];

export const unitDetailsChangeSchema = z
  .object(Object.fromEntries(BULK_DETAIL_FIELDS.map((field) => [field, (technicalFields[field] as z.ZodTypeAny).optional()])) as { [K in BulkDetailField]: z.ZodOptional<(typeof technicalFields)[K]> })
  .strict()
  .refine((change) => Object.values(change).some((value) => value !== undefined), "Change at least one field.");
export type UnitDetailsChange = z.infer<typeof unitDetailsChangeSchema>;
export const bulkUnitsSchema = z.object({
  units: z.array(z.object({ unitCode })).min(1, "Add at least one unit.").max(MAX_BULK_UNITS, `Create at most ${MAX_BULK_UNITS} units at once.`),
  defaults: z.object(technicalFields),
  dryRun,
});
export const copyUnitsSchema = z.object({
  sourceFloorId: idSchema,
  units: z.array(z.object({ sourceUnitId: idSchema, unitCode })).min(1, "Choose at least one unit to copy.").max(MAX_BULK_UNITS, `Copy at most ${MAX_BULK_UNITS} units at once.`),
  dryRun,
});
export const moveUnitSchema = z.object({ floorId: idSchema, expectedVersion });

export type TechnicalInput = z.infer<z.ZodObject<typeof technicalFields>>;
export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type BulkUnitsInput = z.infer<typeof bulkUnitsSchema>;
export type CopyUnitsInput = z.infer<typeof copyUnitsSchema>;

/* The unit list (§66) ------------------------------------------------------- */

const optionalId = idSchema.optional().catch(undefined);
const optionalCount = z.coerce.number().int().min(0).max(10_000).optional().catch(undefined);
const optionalArea = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional().catch(undefined);
const optionalAmount = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/).optional().catch(undefined);

export const unitListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  buildingId: optionalId,
  floorId: optionalId,
  unitTypeId: optionalId,
  orientation: z.enum(UNIT_ORIENTATIONS).optional().catch(undefined),
  bedrooms: optionalCount,
  bathrooms: optionalCount,
  internalAreaMin: optionalArea,
  internalAreaMax: optionalArea,
  // The sale area: saleable when typed, else gross (2026-11-09).
  areaMin: optionalArea,
  areaMax: optionalArea,
  // The asking price and the price per m² of the sale area, as Sales filters them (2026-11-09).
  priceMin: optionalAmount,
  priceMax: optionalAmount,
  pricePerSqmMin: optionalAmount,
  pricePerSqmMax: optionalAmount,
  // Only for a selection read (`select=all`): the units still missing this.
  missing: z.enum(UNIT_MISSING_KINDS).optional().catch(undefined),
  // Publishing (E-05D §13): a unit is Published or Archived (units publish on create, 2026-11). An old
  // link's retired status or `unpublishedChanges=true` is ignored, not refused — unknown keys are dropped.
  publicationStatus: z.enum(["PUBLISHED", "ARCHIVED"]).optional().catch(undefined),
  sort: z.enum(UNIT_SORTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});

export type UnitListQuery = z.infer<typeof unitListQuerySchema>;

export function parseUnitListQuery(search: URLSearchParams | Record<string, string | string[] | undefined>): UnitListQuery & { page: number; limit: number } {
  const entries: Record<string, string> = {};
  if (search instanceof URLSearchParams) {
    for (const [key, value] of search.entries()) if (value !== "") entries[key] = value;
  } else {
    for (const [key, value] of Object.entries(search)) {
      const one = Array.isArray(value) ? value[0] : value;
      if (one !== undefined && one !== "") entries[key] = one;
    }
  }
  const parsed = unitListQuerySchema.parse(entries);
  return { ...parsed, page: parsed.page ?? 1, limit: parsed.limit ?? UNIT_PAGE_SIZE };
}

/* Unit types ---------------------------------------------------------------- */

const typeName = z.string().trim().min(1, "Give the type a name.").max(UNIT_TYPE_NAME_MAX, `Keep the name under ${UNIT_TYPE_NAME_MAX} characters.`);
const typeCode = z
  .string()
  .trim()
  .max(UNIT_TYPE_CODE_MAX, `Keep the code under ${UNIT_TYPE_CODE_MAX} characters.`)
  .regex(/^[A-Za-z0-9_]*$/, "Use letters, digits and underscores in the code.")
  .transform((value) => value.toUpperCase());

export const createUnitTypeSchema = z.object({ name: typeName, code: typeCode.optional(), category: z.enum(UNIT_TYPE_CATEGORIES) });
export const updateUnitTypeSchema = z.object({ name: typeName.optional(), code: typeCode.optional(), category: z.enum(UNIT_TYPE_CATEGORIES).optional(), isActive: z.boolean().optional() });

export type CreateUnitTypeInput = z.infer<typeof createUnitTypeSchema>;
export type UpdateUnitTypeInput = z.infer<typeof updateUnitTypeSchema>;
