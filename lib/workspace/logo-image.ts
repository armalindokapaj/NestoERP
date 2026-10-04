import { LOGO_DATA_URI_MAX } from "@/lib/workspace/branding";

/**
 * The logo a person uploads, made into what the shell may store: a square mark
 * (the sidebar, the account switcher and the 3D viewer's loading screen all
 * draw it square) as an inline image under the storage ceiling. Runs in the
 * browser; a wide wordmark is fitted inside the square, never cropped.
 */
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
export const LOGO_INPUT_MAX_BYTES = 5 * 1024 * 1024;
/** The side the mark is drawn at; the sidebar needs 32 px, the viewer ~96 px, so 512 stays sharp on dense screens. */
export const LOGO_TARGET_PX = 512;
/** Smaller than this reads blurry on the viewer's loading screen. */
export const LOGO_MIN_PX = 128;

export type LogoFailure = "type" | "size" | "unreadable" | "tooBig";
export class LogoError extends Error {
  constructor(readonly reason: LogoFailure) {
    super(reason);
  }
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new LogoError("unreadable")); };
    image.src = url;
  });
}

export async function prepareLogo(file: File): Promise<{ dataUri: string; width: number; height: number; small: boolean }> {
  if (!LOGO_ACCEPT.split(",").includes(file.type)) throw new LogoError("type");
  if (file.size > LOGO_INPUT_MAX_BYTES) throw new LogoError("size");
  const image = await load(file);
  const width = image.naturalWidth || LOGO_TARGET_PX;
  const height = image.naturalHeight || LOGO_TARGET_PX;
  const vector = file.type === "image/svg+xml";
  const small = !vector && Math.min(width, height) < LOGO_MIN_PX;
  for (const side of [LOGO_TARGET_PX, 384, 256, 192, 128]) {
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new LogoError("unreadable");
    const scale = Math.min(side / width, side / height);
    const w = width * scale;
    const h = height * scale;
    context.clearRect(0, 0, side, side);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (side - w) / 2, (side - h) / 2, w, h);
    for (const quality of [0.92, 0.8, 0.65, 0.5]) {
      const webp = canvas.toDataURL("image/webp", quality);
      const dataUri = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
      if (dataUri.length <= LOGO_DATA_URI_MAX - 2_000) return { dataUri, width, height, small };
    }
  }
  throw new LogoError("tooBig");
}
