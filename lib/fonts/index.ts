import localFont from "next/font/local";

/**
 * The Nesto theme's typefaces (docs/ui/UI-03-nesto-theme.md §4), served from
 * the application itself (PRD #38 §102).
 *
 * Loaded with `next/font/local` from files in this repository, so a production
 * build never reaches out to a font CDN: a build without internet access
 * produces the same artifact. Fontsource 5.3.0, Latin subset, SIL Open Font
 * License; the licences sit beside the files.
 *
 * - IBM Plex Sans (variable weight): the running text and controls.
 * - IBM Plex Mono (400, 500): labels, section heads, figures' captions, table
 *   headings — on every screen since the drawing set (docs/ui/UI-07), so it is
 *   preloaded too; labels are medium (500), and nothing asks for 600.
 * - Newsreader (variable weight and optical size): the italic standfirst.
 * - Archivo (variable weight and width): headings and figures, `font-display`.
 *
 * The body, display and mono faces are preloaded, being on every first paint;
 * the serif swaps in.
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
  preload: false,
});

/** The width axis runs 62–125; `font-display` sets it through `font-variation-settings`. */
export const archivo = localFont({
  src: "./files/archivo-latin-wdth-normal.woff2",
  variable: "--font-nesto-display",
  weight: "100 900",
  display: "swap",
});
