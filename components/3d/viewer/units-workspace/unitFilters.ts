import type { Unit } from "@/lib/3d/viewer/types";

export function bedroomLabel(bedrooms: number): string {
  return bedrooms === 0 ? "Studio" : `${bedrooms}+1`;
}

export type StatusFilter = "available" | "reserved" | "sold" | "all";

export const STATUS_DOT: Record<Unit["status"], string> = {
  available: "bg-emerald-400",
  reserved: "bg-amber-400",
  sold: "bg-red-400",
};
export type SortOption = "recommended" | "priceAsc" | "priceDesc" | "areaAsc" | "areaDesc" | "floorAsc" | "floorDesc";

const ALL_SORT_OPTIONS: SortOption[] = ["recommended", "priceAsc", "priceDesc", "areaAsc", "areaDesc", "floorAsc", "floorDesc"];

/**
 * NESTO: whether any unit carries a readable price. None does for a reader
 * without project.unit.sales.view, and then the price filter and the price
 * sorts are not offered at all rather than filtering on nothing.
 */
export function hasPricedUnits(units: Unit[]): boolean {
  return units.some((u) => u.price != null);
}

export function sortOptionsFor(units: Unit[]): SortOption[] {
  return hasPricedUnits(units) ? ALL_SORT_OPTIONS : ALL_SORT_OPTIONS.filter((o) => o !== "priceAsc" && o !== "priceDesc");
}

export interface UnitFilterState {
  query: string;
  status: StatusFilter;
  bedrooms: number | null;
  bathrooms: number | null;
  building: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  minFloor: number | null;
  maxFloor: number | null;
  minArea: number | null;
  maxArea: number | null;
  sort: SortOption;
}

export const DEFAULT_UNIT_FILTERS: UnitFilterState = {
  query: "",
  status: "all",
  bedrooms: null,
  bathrooms: null,
  building: null,
  minPrice: null,
  maxPrice: null,
  minFloor: null,
  maxFloor: null,
  minArea: null,
  maxArea: null,
  sort: "recommended",
};

export function activeFilterCount(state: UnitFilterState): number {
  let n = 0;
  if (state.bedrooms != null) n++;
  if (state.bathrooms != null) n++;
  if (state.building != null) n++;
  if (state.minPrice != null || state.maxPrice != null) n++;
  if (state.minFloor != null || state.maxFloor != null) n++;
  if (state.minArea != null || state.maxArea != null) n++;
  return n;
}

const STATUS_RANK: Record<Unit["status"], number> = { available: 0, reserved: 1, sold: 2 };

export interface UnitFacets {
  bedrooms: number[];
  bathrooms: number[];
  buildings: string[];
  statuses: Unit["status"][];
}

function facetList<T>(values: T[], active: T | null, compare: (a: T, b: T) => number): T[] {
  const distinct = new Set(values);
  if (active != null) distinct.add(active);
  const list = [...distinct].sort(compare);
  return list.length < 2 && active == null ? [] : list;
}

export function unitFacets(units: Unit[], active?: UnitFilterState): UnitFacets {
  const activeStatus = active && active.status !== "all" ? active.status : null;
  return {
    bedrooms: facetList(
      units.map((u) => u.bedrooms),
      active?.bedrooms ?? null,
      (a, b) => a - b
    ),
    bathrooms: facetList(
      units.map((u) => u.bathrooms),
      active?.bathrooms ?? null,
      (a, b) => a - b
    ),
    buildings: facetList(
      units.map((u) => u.buildingName).filter((name) => name.trim().length > 0),
      active?.building ?? null,
      (a, b) => a.localeCompare(b)
    ),
    statuses: facetList(
      units.map((u) => u.status),
      activeStatus,
      (a, b) => STATUS_RANK[a] - STATUS_RANK[b]
    ),
  };
}

export function filterUnits(units: Unit[], state: UnitFilterState): Unit[] {
  const q = state.query.trim().toLowerCase();
  return units.filter((u) => {
    if (state.status !== "all" && u.status !== state.status) return false;
    if (state.bedrooms != null && u.bedrooms !== state.bedrooms) return false;
    if (state.bathrooms != null && u.bathrooms !== state.bathrooms) return false;
    if (state.building != null && u.buildingName !== state.building) return false;
    // A unit without a readable price cannot satisfy a price bound.
    if (state.minPrice != null && (u.price == null || u.price < state.minPrice)) return false;
    if (state.maxPrice != null && (u.price == null || u.price > state.maxPrice)) return false;
    if (state.minFloor != null && u.floor < state.minFloor) return false;
    if (state.maxFloor != null && u.floor > state.maxFloor) return false;
    if (state.minArea != null && u.area < state.minArea) return false;
    if (state.maxArea != null && u.area > state.maxArea) return false;
    if (q) {
      const haystack = `${u.code} ${u.buildingName} ${bedroomLabel(u.bedrooms)}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Price order with unpriced units ("Price on request") always last. */
function byPrice(a: Unit, b: Unit, direction: 1 | -1): number {
  if (a.price == null || b.price == null) return (a.price == null ? 1 : 0) - (b.price == null ? 1 : 0);
  return (a.price - b.price) * direction;
}

export function sortUnits(units: Unit[], sort: SortOption): Unit[] {
  const sorted = [...units];
  switch (sort) {
    case "priceAsc":
      return sorted.sort((a, b) => byPrice(a, b, 1));
    case "priceDesc":
      return sorted.sort((a, b) => byPrice(a, b, -1));
    case "areaAsc":
      return sorted.sort((a, b) => a.area - b.area);
    case "areaDesc":
      return sorted.sort((a, b) => b.area - a.area);
    case "floorAsc":
      return sorted.sort((a, b) => a.floor - b.floor);
    case "floorDesc":
      return sorted.sort((a, b) => b.floor - a.floor);
    case "recommended":
    default:
      return sorted.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.floor - b.floor);
  }
}
