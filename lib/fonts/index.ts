import localFont from "next/font/local";

/**
 * The interface typefaces, served from the application itself (PRD #38 §102).
 *
 * Loaded with `next/font/local` from files in this repository, so a production
 * build never reaches out to Google Fonts: a build without internet access, or
 * on a day the font CDN is unreachable, produces the same artifact. Both
 * families are under the SIL Open Font License; the licences sit beside the
 * files. Geist 1.7.2 (Vercel), Instrument Serif 5.3.0 (Fontsource, Latin 400).
 */

export const geistSans = localFont({
  src: "./files/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
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
 * Used sparingly — the application interface itself stays on Geist.
 */
export const instrumentSerif = localFont({
  src: "./files/instrument-serif-latin-400-normal.woff2",
  variable: "--font-nesto-serif",
  weight: "400",
  style: "normal",
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
