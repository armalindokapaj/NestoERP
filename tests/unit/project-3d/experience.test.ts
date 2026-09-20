import { describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_3D_CONFIG, defaultProject3DExperience, parseProject3DExperience } from "@/lib/3d/shared/experience";

describe("Project 3D Experience document", () => {
  it("normalizes an early empty document into the full editor contract", () => {
    expect(parseProject3DExperience({ schemaVersion: 1, revision: 4 })).toMatchObject({
      schemaVersion: 1,
      revision: 4,
      config: { renderingMode: "auto", skyEnabled: true, cameraFovDesktop: 38, sections: [] },
    });
  });

  it("returns independent defaults and rejects invalid runtime values", () => {
    const first = defaultProject3DExperience();
    first.config.cameraPresets.push({ id: "one", label: "One", position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 38, durationMs: 900 });
    expect(defaultProject3DExperience().config.cameraPresets).toEqual([]);
    expect(() => parseProject3DExperience({ schemaVersion: 1, revision: 1, config: { ...DEFAULT_PROJECT_3D_CONFIG, cameraNearClip: 10, cameraFarClip: 5 } })).toThrow(/far clip/i);
  });
});
