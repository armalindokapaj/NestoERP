import type { UnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { UNIT_SORTS } from "@/lib/modules/project-structure/structure.types";
import { INVENTORY_SORTS, type InventoryQuery, type InventorySort } from "@/lib/modules/sales/units/unit-sales.schema";

/**
 * The unit lists' filters as a page holds them (E-05B §47-§50, E-05E §14):
 * text, so a half-typed area survives. Units and Sales share one set
 * (2026-11-09) — one toolbar, one filter panel, one sort list — and each tab
 * uses the fields that apply to it: Units chooses the building and floor in
 * its tree and filters archived units; Sales has the building and floor in its
 * panel and the status chips. Not a client module, so the server pages can
 * build the first state from the URL.
 */
export type UnitListFilters = {
  q: string;
  buildingId: string;
  floorId: string;
  unitTypeId: string;
  orientation: string;
  bedrooms: string;
  bathrooms: string;
  /** The sale area: saleable when typed, else gross (2026-11-09). */
  areaMin: string;
  areaMax: string;
  priceMin: string;
  priceMax: string;
  pricePerSqmMin: string;
  pricePerSqmMax: string;
  /** Units only — publishing (E-05D §13): PUBLISHED or ARCHIVED, or "" for both. */
  publication: string;
  /** Sales only — the status chip, Not Priced included. */
  commercialStatus: string;
  sort: InventorySort;
};

/** The Units tab's filters: the same shape. */
export type UnitFilters = UnitListFilters;

export const EMPTY_FILTERS: UnitListFilters = {
  q: "",
  buildingId: "",
  floorId: "",
  unitTypeId: "",
  orientation: "",
  bedrooms: "",
  bathrooms: "",
  areaMin: "",
  areaMax: "",
  priceMin: "",
  priceMax: "",
  pricePerSqmMin: "",
  pricePerSqmMax: "",
  publication: "",
  commercialStatus: "",
  sort: "structure",
};

export type UnitListKind = "units" | "sales";

/** A field of the filter panel. */
export type FilterField = "building" | "floor" | "type" | "orientation" | "bedrooms" | "bathrooms" | "area" | "price" | "pricePerSqm" | "publication";

/** The panel's fields on each tab, in the order they are drawn. */
export const FILTER_FIELDS: Record<UnitListKind, readonly FilterField[]> = {
  units: ["type", "orientation", "bedrooms", "bathrooms", "area", "price", "pricePerSqm", "publication"],
  sales: ["building", "floor", "type", "orientation", "bedrooms", "bathrooms", "area", "price", "pricePerSqm"],
};

/** The filter keys each field sets. */
export const FIELD_KEYS: Record<FilterField, ReadonlyArray<keyof UnitListFilters>> = {
  building: ["buildingId"],
  floor: ["floorId"],
  type: ["unitTypeId"],
  orientation: ["orientation"],
  bedrooms: ["bedrooms"],
  bathrooms: ["bathrooms"],
  area: ["areaMin", "areaMax"],
  price: ["priceMin", "priceMax"],
  pricePerSqm: ["pricePerSqmMin", "pricePerSqmMax"],
  publication: ["publication"],
};

/** The sort list on each tab: one list, and Sales adds the reservation expiry. */
export const SORTS: Record<UnitListKind, readonly InventorySort[]> = { units: UNIT_SORTS, sales: INVENTORY_SORTS };

/** How many of the panel's fields are set, for its button. */
export function panelCount(filters: UnitListFilters, kind: UnitListKind): number {
  return FILTER_FIELDS[kind].filter((field) => FIELD_KEYS[field].some((key) => filters[key])).length;
}

/** Everything that narrows the list: the search, the panel and the status chip. */
export function activeCount(filters: UnitListFilters, kind: UnitListKind): number {
  return panelCount(filters, kind) + (filters.q.trim() ? 1 : 0) + (kind === "sales" && filters.commercialStatus ? 1 : 0);
}

/** The filters as the list API reads them: only what the tab uses, and the default sort left out. */
export function filterParams(filters: UnitListFilters, kind: UnitListKind): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (kind === "sales" && filters.commercialStatus) params.set("commercialStatus", filters.commercialStatus);
  for (const field of FILTER_FIELDS[kind]) {
    for (const key of FIELD_KEYS[field]) {
      const value = filters[key];
      if (!value) continue;
      // Publishing is `publicationStatus` in the API (E-05D §13).
      params.set(key === "publication" ? "publicationStatus" : key, value);
    }
  }
  if (filters.sort !== "structure") params.set("sort", filters.sort);
  return params;
}

/** A list URL as either tab parses it. */
type ParsedListQuery = Partial<Omit<UnitListQuery, "sort"> & Omit<InventoryQuery, "sort">> & { sort?: InventorySort };

/** The first state from a parsed URL, on either tab. */
export function filtersFromQuery(query: ParsedListQuery): UnitListFilters {
  const text = (value: string | number | undefined) => (value === undefined ? "" : String(value));
  return {
    ...EMPTY_FILTERS,
    q: query.q ?? "",
    buildingId: query.buildingId ?? "",
    floorId: query.floorId ?? "",
    unitTypeId: query.unitTypeId ?? "",
    orientation: query.orientation ?? "",
    bedrooms: text(query.bedrooms),
    bathrooms: text(query.bathrooms),
    areaMin: query.areaMin ?? "",
    areaMax: query.areaMax ?? "",
    priceMin: query.priceMin ?? "",
    priceMax: query.priceMax ?? "",
    pricePerSqmMin: query.pricePerSqmMin ?? "",
    pricePerSqmMax: query.pricePerSqmMax ?? "",
    publication: query.publicationStatus ?? "",
    commercialStatus: query.commercialStatus ?? "",
    sort: query.sort ?? "structure",
  };
}
