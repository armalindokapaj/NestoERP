import { describe, expect, it } from "vitest";

import type { Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import { adaptProjectViewerBootstrap, quarterLabel } from "@/lib/3d/viewer/bootstrap-adapter";
import { formatPrice } from "@/lib/3d/viewer/utils";
import { unitPriceLabel } from "@/components/3d/viewer/units-workspace/unitDisplay";

type BootstrapUnit = Project3DBootstrap["units"][number];

function unit(overrides: Partial<BootstrapUnit> = {}): BootstrapUnit {
  return {
    id: "unit-1",
    code: "CV-101",
    name: "Corner residence",
    status: "available",
    building: { id: "building-1", name: "Tower A", code: "A" },
    floor: { id: "floor-1", name: "Floor 3", number: 3 },
    type: { id: "type-1", name: "Apartment", category: "RESIDENTIAL" },
    internalArea: "80.00",
    saleableArea: "100.00",
    rooms: 4,
    bedrooms: 2,
    bathrooms: 1,
    orientation: "S",
    commercial: { askingPrice: "250000.00", currency: "EUR", pricePerSqm: "2500.00" },
    salesPlan: null,
    media: [
      { id: "m-1", category: "FLOOR_PLAN_IMAGE", caption: null, isPrimary: false, thumbnailHref: "/api/project-units/unit-1/media/m-1/thumbnail" },
      { id: "m-2", category: "INTERIOR_RENDER", caption: null, isPrimary: true, thumbnailHref: "/api/project-units/unit-1/media/m-2/thumbnail" },
    ],
    ...overrides,
  };
}

function bootstrap(overrides: Partial<Project3DBootstrap> = {}): Project3DBootstrap {
  return {
    schemaVersion: 1,
    project: {
      id: "project-1",
      name: "Viewer Project",
      code: "VP-01",
      status: "ACTIVE",
      city: "Tirana",
      company: { id: "company-1", name: "Company A", phone: "+355 69 000 0000", email: "sales@example.test" },
    },
    release: { id: "release-1", number: 3, publishedAt: "2026-09-20T08:00:00.000Z" },
    experience: structuredClone(DEFAULT_PROJECT_3D_CONFIG) as unknown as Record<string, unknown>,
    models: [{
      slotId: "slot-1",
      slotName: "Unit blocks",
      slotRole: "UNITS",
      transformParentSlotId: null,
      versionId: "version-1",
      versionNumber: 1,
      asset: { url: "http://localhost/runtime.glb?sig=test", expiresAt: "2026-09-20T09:00:00.000Z", fileName: "runtime.glb", contentType: "model/gltf-binary" },
      transform: { scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0 },
      visible: true,
      castShadow: true,
      receiveShadow: true,
      selectable: true,
      sceneManifest: [],
      nodeOverrides: [],
      unitBindings: [{ meshName: "Unit_CV-101", unitId: "unit-1", unitCode: "CV-101", poiYawDeg: 0, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null }],
    }],
    units: [unit()],
    construction: {
      progressPercent: 50,
      stages: [
        { id: "phase-1", name: "Foundations", order: 1, status: "done", progressPercent: 100, endDate: "2026-03-15T12:00:00.000Z" },
        { id: "phase-2", name: "Structure", order: 2, status: "active", progressPercent: 0, endDate: "2027-08-01T12:00:00.000Z" },
      ],
    },
    capabilities: { mapbox: false, unitDetails: true, commercial: true, files: true },
    ...overrides,
  };
}

describe("Company bootstrap → ported Rozaris viewer", () => {
  it("maps the project, company, construction plan and models", () => {
    const adapted = adaptProjectViewerBootstrap(bootstrap());
    expect(adapted.project).toMatchObject({
      id: "project-1",
      slug: "VP-01",
      name: "Viewer Project",
      status: "under_construction",
      city: "Tirana",
      totalUnits: 1,
      availableUnits: 1,
      buildings: ["Tower A"],
      completionLabel: "Q3 2027",
      commercialVisible: true,
      backHref: "/projects/project-1",
      developer: { name: "Company A", phone: "+355 69 000 0000", whatsapp: "+355 69 000 0000", type: "developer" },
    });
    expect(adapted.construction).toEqual({
      progressPercent: 50,
      stages: [
        { id: "phase-1", name: "Foundations", order: 1, status: "done", progressPercent: 100, dateLabel: "Q1 2026" },
        { id: "phase-2", name: "Structure", order: 2, status: "active", progressPercent: 0, dateLabel: "Q3 2027" },
      ],
    });
    expect(adapted.detailModels).toHaveLength(1);
    expect(adapted.detailModels[0]).toMatchObject({ slotRole: "units", model: { glbUrl: "http://localhost/runtime.glb?sig=test", transformLocked: true } });
    // No Mapbox token on this deployment: the map-backed site stays off.
    expect(adapted.viewerConfig).toMatchObject({ siteEnabled: false, mapViewEnabled: false });
  });

  it("maps a unit with its structure, media, orientation and the canonical record link", () => {
    const [mapped] = adaptProjectViewerBootstrap(bootstrap()).units;
    expect(mapped).toEqual({
      id: "unit-1",
      code: "CV-101",
      type: "residential",
      buildingName: "Tower A",
      floor: 3,
      area: 100,
      bedrooms: 2,
      bathrooms: 1,
      price: 250000,
      currency: "EUR",
      transaction: "sale",
      status: "available",
      images: ["/api/project-units/unit-1/media/m-2/thumbnail"],
      floorPlanImage: "/api/project-units/unit-1/media/m-1/thumbnail",
      facadeImage: undefined,
      orientation: "S",
      href: "/projects/project-1/units/unit-1",
    });
  });

  it("never shows a price the reader may not see (no project.unit.sales.view)", () => {
    const adapted = adaptProjectViewerBootstrap(bootstrap({
      units: [unit({ commercial: null })],
      capabilities: { mapbox: false, unitDetails: true, commercial: false, files: true },
    }));
    const [mapped] = adapted.units;
    expect(mapped.price).toBeNull();
    expect(adapted.project.commercialVisible).toBe(false);
    expect(JSON.stringify(adapted)).not.toContain("250000");
    expect(unitPriceLabel(mapped, "EUR", 97, "Price on request")).toBe("Price on request");
  });

  it("drops the canonical link and structure when the reader cannot open unit details", () => {
    const [mapped] = adaptProjectViewerBootstrap(bootstrap({
      units: [unit({ name: null, building: null, floor: null, type: null, internalArea: null, saleableArea: null, rooms: null, bedrooms: null, bathrooms: null, orientation: null })],
      capabilities: { mapbox: false, unitDetails: false, commercial: false, files: false },
    })).units;
    expect(mapped).toMatchObject({ href: null, buildingName: "", floor: 0, area: 0, bedrooms: 0, bathrooms: 0 });
    expect(mapped.orientation).toBeUndefined();
  });

  it("keeps compound orientations, and hides the phone when the company has none", () => {
    const adapted = adaptProjectViewerBootstrap(bootstrap({
      project: { ...bootstrap().project, company: { id: "company-1", name: "Company A", phone: null, email: null } },
      units: [unit({ orientation: "NE" })],
      construction: null,
    }));
    expect(adapted.units[0]).toMatchObject({ orientationCode: "NE" });
    expect(adapted.units[0]!.orientation).toBeUndefined();
    expect(adapted.project.developer.phone).toBe("");
    expect(adapted.construction).toEqual({ progressPercent: 0, stages: [] });
    expect(adapted.project.completionLabel).toBe("—");
  });

  it("formats prices as Rozaris does, and keeps a foreign currency's code", () => {
    expect(formatPrice(250000, "EUR", { locale: "en" })).toBe("€250,000");
    expect(formatPrice(250000, "USD", { locale: "en" })).toBe("250,000 USD");
    expect(unitPriceLabel({ price: 1000, currency: "EUR" }, "ALL", 97, "")).toBe(formatPrice(97000, "ALL"));
    expect(quarterLabel(null)).toBe("—");
  });
});
