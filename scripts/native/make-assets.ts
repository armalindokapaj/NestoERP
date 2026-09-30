/**
 * Renders the source artwork `@capacitor/assets` fans out into every icon and
 * splash size (MOB-08 §59, §60): the NESTO mark — a light serif N on graphite,
 * as in `components/layout/nesto-logo.tsx`. Re-run `pnpm native:assets` after
 * any brand change; the generated platform images are committed.
 */
import { mkdirSync } from "node:fs";

import sharp from "sharp";

const GRAPHITE = process.env.NESTO_ICON_BG ?? "#15171c";
const FG = "#f4f6fa";
mkdirSync("native/assets", { recursive: true });

const letter = (size: number, scale: number, color: string) =>
  `<text x="50%" y="50%" dy="${size * scale * 0.35}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${size * scale}" fill="${color}">N</text>`;
const svg = (size: number, body: string, bg?: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ""}${body}</svg>`);

async function png(name: string, buffer: Buffer, size: number) {
  await sharp(buffer).resize(size, size).png().toFile(`native/assets/${name}`);
}

async function main() {
  await png("icon-only.png", svg(1024, letter(1024, 0.62, FG), GRAPHITE), 1024);
  // Adaptive icon layers: the glyph stays inside the central safe zone (66%).
  await png("icon-foreground.png", svg(1024, letter(1024, 0.5, FG)), 1024);
  await png("icon-background.png", svg(1024, "", GRAPHITE), 1024);
  await png("splash.png", svg(2732, letter(2732, 0.16, FG), GRAPHITE), 2732);
  await png("splash-dark.png", svg(2732, letter(2732, 0.16, FG), GRAPHITE), 2732);
  console.log("Source artwork written to native/assets");
}

void main();
