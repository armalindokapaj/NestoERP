import type { UnitSort } from "@/lib/modules/project-structure/structure.types";

/**
 * The unit list's filters as the page holds them (E-05B §47-§50): text, so a
 * half-typed area survives. Not a client module, so the server page can build
 * the first state from the URL.
 */
export type UnitFilters = {
  q: string;
  unitTypeId: string;
  orientation: string;
  position: string;
  bedrooms: string;
  bathrooms: string;
  internalAreaMin: string;
  internalAreaMax: string;
  saleableAreaMin: string;
  saleableAreaMax: string;
  sort: UnitSort;
};

export const EMPTY_FILTERS: UnitFilters = { q: "", unitTypeId: "", orientation: "", position: "", bedrooms: "", bathrooms: "", internalAreaMin: "", internalAreaMax: "", saleableAreaMin: "", saleableAreaMax: "", sort: "structure" };
