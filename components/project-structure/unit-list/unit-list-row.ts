import type { UnitCommercialStatusKey, UnitDTO } from "@/lib/modules/project-structure/structure.types";
import type { SelectedUnit } from "@/lib/modules/project-structure/unit-bulk.rules";
import { saleArea, saleRate } from "@/lib/modules/sales/units/unit-pricing.rules";
import { saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import type { InventoryRowDTO, UnitPriceBasis, UnitSaleStatus } from "@/lib/modules/sales/units/unit-sales.types";

/**
 * A unit as both lists draw it (2026-11-09, "Two tabs, one table"): the Units
 * tab's and the Sales tab's rows come from different reads but say the same
 * things in the same words, so one table draws both. Client-safe.
 */
export type UnitListRow = {
  id: string;
  unitCode: string;
  /** "T-501": the building's code and the unit's own. */
  label: string;
  typeName: string;
  floorId: string;
  floorName: string;
  bedrooms: number | null;
  grossArea: string | null;
  /** The area the unit is sold by: saleable when typed, else gross. */
  saleArea: string | null;
  saleAreaBasis: UnitPriceBasis;
  status: UnitCommercialStatusKey;
  /** The status as shown, with Not Priced. */
  saleStatus: UnitSaleStatus;
  askingPrice: string | null;
  currency: string | null;
  pricePerSqm: string | null;
  isActive: boolean;
  archived: boolean;
  /** Published for Sales use: what putting on sale and reserving need, with being active. */
  published: boolean;
  version: number;
  salesVersion: number;
  /** Sales only: the active reservation's client, deal and expiry, for a reader who may see them. */
  client: { id: string; name: string } | null;
  deal: { id: string; name: string } | null;
  reservationExpiresAt: string | null;
};

/** A row of the Units tab. */
export function rowFromUnit(unit: UnitDTO): UnitListRow {
  const areas = { saleableArea: unit.areas.saleableArea, grossArea: unit.areas.grossArea };
  const sale = saleArea(areas);
  const price = unit.askingPrice?.amount ?? null;
  return {
    id: unit.id,
    unitCode: unit.unitCode,
    label: unit.label,
    typeName: unit.unitType.name,
    floorId: unit.floor.id,
    floorName: unit.floor.name,
    bedrooms: unit.bedrooms,
    grossArea: unit.areas.grossArea,
    saleArea: sale.area,
    saleAreaBasis: sale.basis,
    status: unit.commercialStatus,
    saleStatus: saleStatusOf(unit.commercialStatus, price),
    askingPrice: price,
    currency: unit.askingPrice?.currency ?? null,
    pricePerSqm: saleRate(areas, price),
    isActive: unit.isActive,
    archived: unit.publication.status === "ARCHIVED",
    published: unit.publication.status === "PUBLISHED",
    version: unit.version,
    salesVersion: unit.salesVersion,
    client: null,
    deal: null,
    reservationExpiresAt: null,
  };
}

/** A row of the Sales tab. */
export function rowFromInventory(row: InventoryRowDTO): UnitListRow {
  return {
    id: row.id,
    unitCode: row.unitCode,
    label: row.label,
    typeName: row.unitType,
    floorId: row.floorId,
    floorName: row.floor,
    bedrooms: row.bedrooms,
    grossArea: row.grossArea,
    saleArea: row.saleArea,
    saleAreaBasis: row.saleAreaBasis,
    status: row.status,
    saleStatus: row.saleStatus,
    askingPrice: row.askingPrice,
    currency: row.currency,
    pricePerSqm: row.pricePerSqm,
    isActive: row.isActive,
    archived: row.publicationStatus === "ARCHIVED",
    published: row.publicationStatus === "PUBLISHED",
    version: row.version,
    salesVersion: row.salesVersion,
    client: row.client,
    deal: row.deal,
    reservationExpiresAt: row.reservationExpiresAt,
  };
}

/** What the selection keeps of a ticked row. */
export function selectedFromRow(row: UnitListRow): SelectedUnit {
  return { id: row.id, label: row.label, floorId: row.floorId, version: row.version, salesVersion: row.salesVersion, status: row.status, priced: row.askingPrice !== null, archived: row.archived };
}
