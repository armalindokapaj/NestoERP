import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { cookies } from "next/headers";

import { brand } from "@/config/brand";
import { site } from "@/config/marketing";
import {
  readThemeChoice,
  themeAttribute,
  THEME_COOKIE,
} from "@/lib/layout/theme-state";
import { siteUrl } from "@/lib/marketing/site-url";
import "../styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Display face for the wordmark and executive headings (design spec §7).
 * Used sparingly — the application interface itself stays on Geist.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-nesto-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "NESTO",
    template: "%s · NESTO",
  },
  description: site.summary,
  applicationName: brand.name,
  keywords: [
    "construction ERP",
    "construction management software",
    "project management",
    "procurement",
    "QA/QC",
    "HSE",
    "construction operating system",
  ],
  openGraph: {
    type: "website",
    siteName: brand.name,
    title: `NESTO — ${site.category}`,
    description: site.summary,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: `NESTO — ${site.category}`,
    description: site.summary,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* Rendered server-side so the first paint is already in the right scheme. */
  const cookieStore = await cookies();
  const theme = themeAttribute(readThemeChoice(cookieStore.get(THEME_COOKIE)?.value));

  return (
    <html lang="en" data-theme={theme}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
