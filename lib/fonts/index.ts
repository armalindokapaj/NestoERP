import localFont from "next/font/local";

/**
 * The interface typefaces, served from the application itself (PRD #38 §102).
 *
 * Loaded with `next/font/local` from files in this repository, so a production
 * build never reaches out to Google Fonts: a build without internet access, or
 * on a day the font CDN is unreachable, produces the same artifact. Both
 * families are under the SIL Open Font License; the licences sit beside the
 * files. Manrope 5.3.0 (Fontsource, Latin variable), Geist Mono 1.7.2 (Vercel), Instrument Serif 5.3.0 (Fontsource, Latin 400 upright and italic).
 */

export const manrope = localFont({
  src: "./files/manrope-latin-wght-normal.woff2",
  variable: "--font-nesto-sans",
  weight: "200 800",
  display: "swap",
});

export const geistMono = localFont({
  src: "./files/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

/**
 * Display face for the wordmark and executive headings (design spec §7).
 * Used sparingly — the application interface itself stays on Manrope.
 */
export const instrumentSerif = localFont({
  src: [
    { path: "./files/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-nesto-serif",
  display: "swap",
});


/*
 * Theme 2's typefaces (lib/layout/look-state.ts; docs/ui/UI-03-vertical-look.md
 * §3). Fontsource 5.3.0, Latin subset, SIL OFL: IBM Plex Sans (variable
 * weight), IBM Plex Mono (400, 500, 600), Newsreader (variable weight and
 * optical size) and Archivo (variable weight and width).
 *
 * Declared for every page and fetched only where a rule uses them — hence no
 * preload: Theme 1 never downloads them. styles/look-2.css points the
 * product's three font variables at the first three inside
 * <html data-look="2">; the fourth, the display face, is spent by the
 * `font-display` utility.
 */

export const plexSans = localFont({
  src: [
    { path: "./files/ibm-plex-sans-latin-wght-normal.woff2", weight: "100 700", style: "normal" },
    { path: "./files/ibm-plex-sans-latin-wght-italic.woff2", weight: "100 700", style: "italic" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
  preload: false,
});

export const plexMono = localFont({
  src: [
    { path: "./files/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./files/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

export const newsreader = localFont({
  src: [
    { path: "./files/newsreader-latin-opsz-normal.woff2", weight: "200 800", style: "normal" },
    { path: "./files/newsreader-latin-opsz-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
});

/** The width axis runs 62–125; `font-display` sets it through `font-variation-settings`. */
export const archivo = localFont({
  src: "./files/archivo-latin-wdth-normal.woff2",
  variable: "--font-nesto-display",
  weight: "100 900",
  display: "swap",
  preload: false,
});
