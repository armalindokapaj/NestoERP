import type { BaselineEntry, DiffBuilding, DiffInput, DiffType, DiffUnit, UnitBaseline } from "@/lib/modules/unit-sheet/unit-sheet.diff";
import type { SheetCell, SheetGrid } from "@/lib/modules/unit-sheet/unit-sheet.parse";
import type { SheetField } from "@/lib/modules/unit-sheet/unit-sheet.types";

/**
 * A small project for the sheet's pure tests: Tower (code T) with Floor 5
 * and the ground floor, Block B (code B) with Floor 1; apartments, parking,
 * land and a retired type; units T-501, T-502, B-101, a parking space T-P1
 * with no area, a plot T-L1, and the archived T-503.
 */

export const TYPES: DiffType[] = [
  { id: "type_apt", name: "Apartment", code: "APARTMENT", category: "RESIDENTIAL", isActive: true },
  { id: "type_park", name: "Parking", code: "PARKING", category: "PARKING", isActive: true },
  { id: "type_land", name: "Land", code: "LAND", category: "LAND", isActive: true },
  { id: "type_old", name: "Duplex", code: "DUPLEX", category: "RESIDENTIAL", isActive: false },
];

export const BUILDINGS: DiffBuilding[] = [
  { id: "b_t", name: "Tower", code: "T", floors: [{ id: "f_t5", name: "Floor 5", number: 5 }, { id: "f_t0", name: "Ground Floor", number: 0 }] },
  { id: "b_b", name: "Block B", code: "B", floors: [{ id: "f_b1", name: "Floor 1", number: 1 }] },
];

const EMPTY: Record<SheetField, string | null> = {
  type: "type_apt",
  orientation: null,
  internalArea: null,
  balconyArea: null,
  terraceArea: null,
  commonAreaAllocation: null,
  grossArea: null,
  saleableArea: null,
  outdoorArea: null,
  gardenArea: null,
  bedrooms: null,
  bathrooms: null,
  storage: null,
  price: null,
};

export function unit(id: string, unitCode: string, building: "b_t" | "b_b", values: Partial<Record<SheetField, string | null>> = {}, extra: Partial<DiffUnit> = {}): DiffUnit {
  const code = building === "b_t" ? "T" : "B";
  return {
    id,
    unitCode,
    label: unitCode.startsWith(`${code}-`) ? unitCode : `${code}-${unitCode}`,
    buildingId: building,
    floorId: building === "b_t" ? "f_t5" : "f_b1",
    category: "RESIDENTIAL",
    archived: false,
    version: 3,
    salesVersion: 2,
    status: "NOT_FOR_SALE",
    currency: "EUR",
    values: { ...EMPTY, ...values },
    ...extra,
  };
}

export function units(): DiffUnit[] {
  return [
    unit("u501", "501", "b_t", { internalArea: "64.72", balconyArea: "8.00", commonAreaAllocation: "10.00", grossArea: "82.72", saleableArea: "80.00", bedrooms: "2", bathrooms: "1", orientation: "NE", price: "160000.00" }),
    unit("u502", "502", "b_t", { internalArea: "50.00", grossArea: "50.00", bedrooms: "1" }),
    unit("u101", "101", "b_b", { internalArea: "70.00", grossArea: "70.00" }),
    unit("up1", "P1", "b_t", { type: "type_park", price: "15000.00" }, { category: "PARKING" }),
    unit("ul1", "L1", "b_t", { type: "type_land", grossArea: "500.00" }, { category: "LAND" }),
    unit("u503", "503", "b_t", { internalArea: "40.00" }, { archived: true }),
  ];
}

/** A row's cells: a number is a number Google typed, a string is text, null or "" is an empty cell. */
export function grid(header: string[], rows: Array<Array<string | number | null>>, typed = true): SheetGrid {
  const cell = (value: string | number | null): SheetCell => (value === null || value === "" ? { kind: "blank" } : typeof value === "number" ? { kind: "number", value, text: String(value) } : { kind: "text", text: value });
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  return { header: Array.from({ length: width }, (_, index) => header[index] ?? ""), rows: rows.map((row) => Array.from({ length: width }, (_, index) => cell(row[index] ?? null))), typed };
}

export function input(sheet: SheetGrid, overrides: Partial<DiffInput> = {}): DiffInput {
  return { grid: sheet, units: units(), buildings: BUILDINGS, types: TYPES, baselines: new Map(), can: { managePrice: true, createUnit: true }, ...overrides };
}

export function baselines(entries: Record<string, Partial<Record<SheetField, BaselineEntry>>>): Map<string, UnitBaseline> {
  return new Map(Object.entries(entries));
}
