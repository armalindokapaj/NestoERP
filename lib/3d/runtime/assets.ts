/** Static assets used by the ported browser runtime. */
export const PROJECT_3D_ASSETS = {
  waterNormals: "/3d/textures/waternormals.jpg",
  caustics: "/3d/textures/caustics.jpg",
  lutRoot: "/3d/luts",
  dracoDecoderRoot: "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
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

