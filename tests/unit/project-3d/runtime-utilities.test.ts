import { describe, expect, it } from "vitest";

import { cleanGlbNodeName, glbNodeNameKey, sanitizeGlbNodeName } from "@/lib/3d/shared/glbNodeName";
import { isSlotCutBySections } from "@/lib/3d/runtime/render-engine/sectionScope";
import { sunDirectionVector, sunPositionForAnchors, sunPositionForHour } from "@/lib/3d/runtime/sunPosition";

describe("Project 3D runtime utilities", () => {
  it("normalizes authoring and loader node names to the same key", () => {
    expect(cleanGlbNodeName("Layer: Unit.A/101")).toBe("Unit.A/101");
    expect(sanitizeGlbNodeName("Unit.A/101")).toBe("UnitA101");
    expect(glbNodeNameKey("Layer: Unit.A/101")).toBe(glbNodeNameKey("UnitA101"));
  });

  it("keeps site context out of section cuts", () => {
    expect(isSlotCutBySections({ slotRole: "surroundings", slotName: "Trees" })).toBe(false);
    expect(isSlotCutBySections({ slotRole: "building", slotName: "Terrain East" })).toBe(false);
    expect(isSlotCutBySections({ slotRole: "units", slotName: "Tower units" })).toBe(true);
  });

  it("interpolates sun anchors across the shortest azimuth arc", () => {
    expect(sunPositionForAnchors(12, [
      { id: "morning", timeHours: 8, elevationDeg: 20, azimuthDeg: 350 },
      { id: "afternoon", timeHours: 16, elevationDeg: 60, azimuthDeg: 10 },
    ])).toEqual({ elevationDeg: 40, azimuthDeg: 0 });
  });

  it("clamps manual sun hours and returns a normalized direction", () => {
    expect(sunPositionForHour(2, 6, 20)).toEqual({ elevationDeg: 0, azimuthDeg: 85 });
    const direction = sunDirectionVector({ elevationDeg: 45, azimuthDeg: 180 });
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 10);
  });
});
