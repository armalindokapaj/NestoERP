import type { BulkSkip } from "@/lib/modules/project-structure/unit-bulk.rules";
import type { UnitCommercialStatus, UnitPriceBasis } from "./unit-sales.types";

/**
 * A project's price list (2026-11): every active unit with its asking price, laid
 * out building by building and floor by floor, so Sales can price a whole floor
 * at a rate per square metre and every parking space at one price, then change
 * any single unit. Client-safe.
 *
 * Nothing new is stored: a floor's rate and the parking price only fill in each
 * unit's own asking price, which keeps its history exactly as a one-unit change
 * does (E-05E §10-§12).
 */

/** The unit type categories a price list sets by the space, not by the square metre. */
export type UnitTypeCategoryKey = "RESIDENTIAL" | "COMMERCIAL" | "PARKING" | "STORAGE" | "LAND" | "OTHER";

export type PriceListUnitDTO = {
  id: string;
  unitCode: string;
  /** How the unit is named to people: its building's code and its own, "T-501". */
  label: string;
  unitType: string;
  category: UnitTypeCategoryKey;
  saleableArea: string | null;
  internalArea: string | null;
  grossArea: string | null;
  status: UnitCommercialStatus;
  askingPrice: string | null;
  currency: string | null;
  priceBasis: UnitPriceBasis;
  /** The commercial profile's version; 0 while the unit has none. Sent back with a change. */
  version: number;
};

export type PriceListFloorDTO = { id: string; name: string; units: PriceListUnitDTO[] };
export type PriceListBuildingDTO = { id: string; name: string; floors: PriceListFloorDTO[] };

export type PriceListDTO = {
  projectId: string;
  /** The company's currency, for a project nothing is priced in yet. */
  baseCurrency: string;
  buildings: PriceListBuildingDTO[];
  canManagePrice: boolean;
  /** Whether a save may also put the units it prices on sale (`project.unit.sales_status.manage`). */
  canManageStatus: boolean;
};

/**
 * What a save did: how many prices changed, the list as it is now, and — when
 * the save also put the priced units on sale — which went on sale and which
 * stayed off it, with the reason.
 */
export type PriceListSaveResult = { saved: number; list: PriceListDTO; putOnSale?: { moved: string[]; skipped: BulkSkip[] } };

/** One save holds at most this many prices: a large project, never an unbounded request. */
export const MAX_PRICE_LIST_CHANGES = 2000;
