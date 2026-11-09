import localFont from "next/font/local";

/**
 * The interface typefaces, served from the application itself (PRD #38 §102).
 *
 * Loaded with `next/font/local` from files in this repository, so a production
 * build never reaches out to Google Fonts: a build without internet access, or
 * on a day the font CDN is unreachable, produces the same artifact. All four
 * families are under the SIL Open Font License; the licences sit beside the
 * files. Fontsource 5.3.0, Latin subset: IBM Plex Sans (variable weight),
 * IBM Plex Mono (400, 500, 600), Newsreader (variable weight and optical
 * size) and Archivo (variable weight and width).
 *
 * Four roles (docs/ui/UI-03-vertical-look.md):
 * - sans: running text and controls;
 * - mono: the small uppercase labels, table headings, codes and counts;
 * - serif: the italic standfirst under a title and the italic word inside one;
 * - display: titles and figures, set condensed.
 */

export const plexSans = localFont({
  src: [
    { path: "./files/ibm-plex-sans-latin-wght-normal.woff2", weight: "100 700", style: "normal" },
    { path: "./files/ibm-plex-sans-latin-wght-italic.woff2", weight: "100 700", style: "italic" },
  ],
  variable: "--font-nesto-sans",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "./files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-nesto-mono",
  display: "swap",
});

export const newsreader = localFont({
  src: [
    { path: "./files/newsreader-latin-opsz-normal.woff2", weight: "200 800", style: "normal" },
    { path: "./files/newsreader-latin-opsz-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-nesto-serif",
  display: "swap",
});

/**
 * The width axis runs 62–125; the product sets it through
 * `font-variation-settings` (the `font-display` rule in styles/globals.css).
 */
export const archivo = localFont({
  src: "./files/archivo-latin-wdth-normal.woff2",
  variable: "--font-nesto-display",
  weight: "100 900",
  display: "swap",
});
