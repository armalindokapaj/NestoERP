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

/**
 * The Project viewer's faces (the Rozaris 3D viewer, ported as-is): Nunito
 * Sans for its interface and Roboto for figures. Latin subset, variable
 * weight, served from this repository like the others. Both SIL OFL 1.1.
 * Loaded only by the viewer's own layout.
 */
export const nunitoSans = localFont({
  src: "./files/NunitoSans-Variable-latin.woff2",
  variable: "--font-nunito-sans",
  weight: "200 1000",
  display: "swap",
});

export const roboto = localFont({
  src: "./files/Roboto-latin.woff2",
  variable: "--font-roboto",
  weight: "100 900",
  display: "swap",
});
