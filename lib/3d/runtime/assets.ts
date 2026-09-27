/** Static assets used by the ported browser runtime. */
export const PROJECT_3D_ASSETS = {
  waterNormals: "/3d/textures/waternormals.jpg",
  caustics: "/3d/textures/caustics.jpg",
  lutRoot: "/3d/luts",
  // three.js's own glTF Draco decoder (WebAssembly), copied from
  // node_modules/three/examples/jsm/libs/draco/gltf/ and served from this
  // origin, so the CSP names no third party and the decoder matches the
  // installed loader (tests/unit/project-3d/draco-decoder.test.ts).
  dracoDecoderRoot: "/3d/draco/",
} as const;

export const PROJECT_3D_LUTS = [
  { id: "bourbon64", file: "Bourbon 64.CUBE", format: "cube" },
  { id: "chemical168", file: "Chemical 168.CUBE", format: "cube" },
  { id: "clayton33", file: "Clayton 33.CUBE", format: "cube" },
  { id: "cubicle99", file: "Cubicle 99.CUBE", format: "cube" },
  { id: "remy24", file: "Remy 24.CUBE", format: "cube" },
  { id: "presetproCinematic", file: "Presetpro-Cinematic.3dl", format: "3dl" },
  { id: "neutral", file: "NeutralLUT.png", format: "image" },
  { id: "blackAndWhite", file: "B&WLUT.png", format: "image" },
  { id: "night", file: "NightLUT.png", format: "image" },
] as const;

export type Project3DLutId = (typeof PROJECT_3D_LUTS)[number]["id"];

