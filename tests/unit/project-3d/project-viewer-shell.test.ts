import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project3DBootstrap } from "@/lib/3d/company/bootstrap.schema";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", async () => {
  const ReactModule = await import("react");
  return {
    default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => ReactModule.createElement("a", { ...props, href }, children),
  };
});

vi.mock("@/components/3d/company/ThreeProjectViewer", async () => {
  const ReactModule = await import("react");
  return {
    ThreeProjectViewer: ReactModule.forwardRef(function MockViewer(props: {
      onUnitClick?: (unitId: string | null) => void;
      onModelLoadStatus?: (status: { state: "failed"; models: string[]; forbidden: boolean }) => void;
    }, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        resetView() {},
        setSelectedUnit() {},
        revealUnit() { return true; },
      }));
      return ReactModule.createElement("div", { "data-testid": "mock-runtime" },
        ReactModule.createElement("button", { "data-testid": "select-unit", onClick: () => props.onUnitClick?.("unit-1") }, "Select unit"),
        ReactModule.createElement("button", { "data-testid": "fail-asset", onClick: () => props.onModelLoadStatus?.({ state: "failed", models: ["Unit blocks"], forbidden: true }) }, "Fail asset"),
      );
    }),
  };
});

import { Project3DViewer } from "@/components/3d/company/Project3DViewer";

function bootstrap(withBinding = true): Project3DBootstrap {
  return {
    schemaVersion: 1,
    project: { id: "project-1", name: "Viewer Project" },
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
      unitBindings: withBinding ? [{ meshName: "Unit_CV-101", unitId: "unit-1", unitCode: "CV-101", poiYawDeg: 0, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null }] : [],
    }],
    units: withBinding ? [{ id: "unit-1", code: "CV-101", name: "Corner residence", status: "available", building: { id: "building-1", name: "Tower A", code: "A" }, floor: { id: "floor-1", name: "Floor 1", number: 1 }, type: { id: "type-1", name: "Apartment", category: "RESIDENTIAL" }, internalArea: "80.00", saleableArea: "100.00", rooms: 4, bedrooms: 2, bathrooms: 2, commercial: { askingPrice: "250000.00", currency: "EUR", pricePerSqm: "2500.00" }, salesPlan: null, media: [] }] : [],
    capabilities: { mapbox: false, unitDetails: true, commercial: true, files: false },
  };
}

async function renderBootstrap(data: Project3DBootstrap): Promise<ReactTestRenderer> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } })));
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Project3DViewer, { projectId: data.project.id }), { createNodeMock: () => ({ requestFullscreen: vi.fn() }) });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Company Project 3D viewer shell", () => {
  it("mounts a valid bootstrap, resolves a mesh click to the canonical unit, and controls asset failure", async () => {
    const renderer = await renderBootstrap(bootstrap());
    expect(JSON.stringify(renderer.toJSON())).toContain("Published experience · Release ");

    await act(async () => renderer.root.findByProps({ "data-testid": "select-unit" }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain("CV-101");
    expect(renderer.root.findAllByType("a").some((link) => link.props.href === "/projects/project-1/units/unit-1")).toBe(true);

    await act(async () => renderer.root.findByProps({ "data-testid": "fail-asset" }).props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain("signed model access may have expired");
    await act(async () => renderer.unmount());
  });

  it("does not crash when the published model has no unit binding", async () => {
    const renderer = await renderBootstrap(bootstrap(false));
    expect(JSON.stringify(renderer.toJSON())).toContain("No mapped units found");
    await act(async () => renderer.unmount());
  });
});
