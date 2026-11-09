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
  bedrooms: string;
  bathrooms: string;
  internalAreaMin: string;
  internalAreaMax: string;
  saleableAreaMin: string;
  saleableAreaMax: string;
  /** Publishing (E-05D §13): PUBLISHED or ARCHIVED, or "" for both. */
  publication: string;
  sort: UnitSort;
};

export const EMPTY_FILTERS: UnitFilters = { q: "", unitTypeId: "", orientation: "", bedrooms: "", bathrooms: "", internalAreaMin: "", internalAreaMax: "", saleableAreaMin: "", saleableAreaMax: "", publication: "", sort: "structure" };
