import { PROJECT_3D_ASSETS } from "./assets";

// GLTFLoader throws on a Draco-compressed GLB without a decoder.
export const DRACO_DECODER_PATH = PROJECT_3D_ASSETS.dracoDecoderRoot;
