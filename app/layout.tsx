import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { cookies } from "next/headers";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { brand } from "@/config/brand";
import { site } from "@/config/marketing";
import {
  readThemeChoice,
  themeAttribute,
  THEME_COOKIE,
} from "@/lib/layout/theme-state";
import { getLocale } from "@/lib/i18n/server";
import { messages } from "@/lib/i18n/messages";
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
  /* Rendered server-side so the first paint is already in the right scheme
     and the right language. */
  const cookieStore = await cookies();
  const theme = themeAttribute(readThemeChoice(cookieStore.get(THEME_COOKIE)?.value));
  const locale = await getLocale();

  return (
    <html lang={locale} data-theme={theme}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <I18nProvider locale={locale} messages={messages[locale]}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
