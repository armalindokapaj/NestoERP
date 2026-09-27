import { describe, expect, it } from "vitest";

import type { Section, Unit } from "@/lib/3d/viewer/types";
import { buildFloorRail } from "@/lib/3d/viewer/floorRail";
import { parseSectionFloorNumber, resolveFloorSection } from "@/lib/3d/viewer/floorSections";
import { applyViewerQuality, applyViewerQualityToLighting, applyViewerQualityToRendering } from "@/lib/3d/viewer/viewerQuality";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import {
  activeFilterCount,
  DEFAULT_UNIT_FILTERS,
  filterUnits,
  hasPricedUnits,
  sortOptionsFor,
  sortUnits,
  unitFacets,
} from "@/components/3d/viewer/units-workspace/unitFilters";

function unit(id: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    code: id.toUpperCase(),
    type: "residential",
    buildingName: "Tower A",
    floor: 1,
    area: 80,
    bedrooms: 2,
    bathrooms: 1,
    price: 100000,
    currency: "EUR",
    transaction: "sale",
    status: "available",
    images: [],
    floorPlanImage: "",
    href: null,
    ...overrides,
  };
}

function section(id: string, name: string, overrides: Partial<Section> = {}): Section {
  return {
    id,
    name,
    scope: "project",
    centerX: 0,
    centerZ: 0,
    widthM: 10,
    depthM: 10,
    rotationDeg: 0,
    heightM: 3,
    bottomEnabled: false,
    fillGapsEnabled: false,
    fillColor: "#ffffff",
    ...overrides,
  };
}

const units = [
  unit("a1", { floor: 1, price: 90000, area: 60, status: "sold" }),
  unit("a2", { floor: 2, price: 150000, area: 110, bedrooms: 3 }),
  unit("b1", { buildingName: "Tower B", floor: 1, price: null, area: 75, status: "reserved" }),
];

describe("floor rail and floor sections (ported from Rozaris)", () => {
  it("groups by building, highest floor first, and links each floor to its section", () => {
    const rail = buildFloorRail(units, [section("s2", "Floor 2"), section("s-hidden", "Floor 1", { hidden: true })]);
    expect(rail.map((b) => b.name)).toEqual(["Tower A", "Tower B"]);
    expect(rail[0]!.floors.map((f) => [f.floor, f.unitIds, f.sectionId])).toEqual([
      [2, ["a2"], "s2"],
      [1, ["a1"], null],
    ]);
  });

  it("reads floor numbers from English and Albanian section names", () => {
    expect(parseSectionFloorNumber("Floor 3")).toBe(3);
    expect(parseSectionFloorNumber("Kati 4")).toBe(4);
    expect(parseSectionFloorNumber("2nd floor")).toBe(2);
    expect(parseSectionFloorNumber("Roof")).toBeNull();
    expect(resolveFloorSection([section("x", "Kati 2", { floorId: "Tower A::2" })], units[1]!)?.id).toBe("x");
  });
});

describe("unit filters", () => {
  it("filters and counts like Rozaris, and never lets an unpriced unit through a price bound", () => {
    expect(filterUnits(units, { ...DEFAULT_UNIT_FILTERS, status: "available" }).map((u) => u.id)).toEqual(["a2"]);
    expect(filterUnits(units, { ...DEFAULT_UNIT_FILTERS, minPrice: 50000 }).map((u) => u.id)).toEqual(["a1", "a2"]);
    expect(filterUnits(units, { ...DEFAULT_UNIT_FILTERS, query: "tower b" }).map((u) => u.id)).toEqual(["b1"]);
    expect(activeFilterCount({ ...DEFAULT_UNIT_FILTERS, minPrice: 1, maxPrice: 2, building: "Tower A" })).toBe(2);
    expect(unitFacets(units).buildings).toEqual(["Tower A", "Tower B"]);
  });

  it("sorts unpriced units last in both price orders", () => {
    expect(sortUnits(units, "priceAsc").map((u) => u.id)).toEqual(["a1", "a2", "b1"]);
    expect(sortUnits(units, "priceDesc").map((u) => u.id)).toEqual(["a2", "a1", "b1"]);
    expect(sortUnits(units, "recommended").map((u) => u.id)).toEqual(["a2", "b1", "a1"]);
  });

  it("offers no price filter or price sort when no price is readable", () => {
    const hidden = units.map((u) => ({ ...u, price: null }));
    expect(hasPricedUnits(units)).toBe(true);
    expect(hasPricedUnits(hidden)).toBe(false);
    expect(sortOptionsFor(hidden)).not.toContain("priceAsc");
    expect(sortOptionsFor(units)).toContain("priceDesc");
  });
});

describe("viewer quality presets", () => {
  const config = DEFAULT_PROJECT_3D_CONFIG;

  it("leaves the authored experience alone on Auto", () => {
    expect(applyViewerQuality("auto", config)).toBe(config);
    expect(applyViewerQualityToRendering("auto", config)).toBe(config);
  });

  it("maps a level to a render preset and caps the costly effects", () => {
    expect(applyViewerQuality("low", config)).toMatchObject({ qualityPreset: "mobile_low", customRenderScale: null, customDprCap: null });
    const lighting = applyViewerQualityToLighting("low", { ...config, shadowsEnabled: true, giEnabled: true });
    expect(lighting).toMatchObject({ shadowsEnabled: false, giEnabled: false });
    const rendering = applyViewerQualityToRendering("high", { ...config, bloomEnabled: true, depthOfFieldEnabled: true });
    expect(rendering).toMatchObject({ bloomEnabled: true, depthOfFieldEnabled: true });
    expect(applyViewerQualityToLighting("high", { ...config, giEnabled: true }).giEnabled).toBe(false);
  });
});
