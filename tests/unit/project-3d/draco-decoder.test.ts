import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PROJECT_3D_ASSETS } from "@/lib/3d/runtime/assets";

/**
 * The renderer loads the Draco decoder from this origin (the CSP names no
 * third party). The copies in public/ must be the ones the installed three.js
 * ships with its DRACOLoader; after a three.js upgrade, copy them again from
 * node_modules/three/examples/jsm/libs/draco/gltf/.
 */
describe("the self-hosted Draco decoder", () => {
  it.each(["draco_wasm_wrapper.js", "draco_decoder.wasm"])("public/3d/draco/%s matches the installed three.js", (file) => {
    const served = readFileSync(path.join(process.cwd(), "public", PROJECT_3D_ASSETS.dracoDecoderRoot, file));
    const shipped = readFileSync(path.join(process.cwd(), "node_modules/three/examples/jsm/libs/draco/gltf", file));
    expect(served.equals(shipped)).toBe(true);
  });
});
