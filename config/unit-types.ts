/**
 * The unit types every company starts with (E-05B §20, §21).
 *
 * Only a starting point, like the project types beside it: each company keeps
 * its own list in `project_unit_types` — renaming, adding, ordering and
 * retiring from Projects → Unit types. Nothing reads this at runtime except to
 * create a new company's rows; migration `20260917120000_project_structure_e05b`
 * wrote the same ten for the companies that already existed.
 *
 * Client-safe: no database imports.
 */
export const UNIT_TYPE_CATEGORIES = ["RESIDENTIAL", "COMMERCIAL", "PARKING", "STORAGE", "LAND", "OTHER"] as const;
export type UnitTypeCategory = (typeof UNIT_TYPE_CATEGORIES)[number];

export const UNIT_TYPE_CATEGORY_LABELS: Record<UnitTypeCategory, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  PARKING: "Parking",
  STORAGE: "Storage",
  LAND: "Land",
  OTHER: "Other",
};

export const DEFAULT_UNIT_TYPES: ReadonlyArray<{ name: string; code: string; category: UnitTypeCategory }> = [
  { name: "Apartment", code: "APARTMENT", category: "RESIDENTIAL" },
  { name: "Penthouse", code: "PENTHOUSE", category: "RESIDENTIAL" },
  { name: "Villa", code: "VILLA", category: "RESIDENTIAL" },
  { name: "Office", code: "OFFICE", category: "COMMERCIAL" },
  { name: "Shop", code: "SHOP", category: "COMMERCIAL" },
  { name: "Parking", code: "PARKING", category: "PARKING" },
  { name: "Garage", code: "GARAGE", category: "PARKING" },
  { name: "Storage", code: "STORAGE", category: "STORAGE" },
  { name: "Land", code: "LAND", category: "LAND" },
  { name: "Other", code: "OTHER", category: "OTHER" },
];

/** The rows a new company is created with, in the order the list shows them. */
export function defaultUnitTypeRows(companyId: string) {
  return DEFAULT_UNIT_TYPES.map((type, index) => ({ companyId, name: type.name, code: type.code, category: type.category, sortOrder: index + 1 }));
}

export const UNIT_TYPE_NAME_MAX = 60;
export const UNIT_TYPE_CODE_MAX = 30;
