import { NativeBootstrap } from "@/components/platform/native-bootstrap";
import { SessionLifecycle } from "@/components/auth/session-lifecycle";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { brand } from "@/config/brand";
import { geistMono, geistSans, instrumentSerif } from "@/lib/fonts";
import {
  readThemeChoice,
  themeAttribute,
  THEME_COOKIE,
} from "@/lib/layout/theme-state";
import { getLocale, getSiteCopy } from "@/lib/i18n/server";
import { messages } from "@/lib/i18n/messages";
import { siteUrl } from "@/lib/marketing/site-url";
import "../styles/globals.css";

/*
 * The page reaches under a phone's notch and home indicator, so
 * `env(safe-area-inset-*)` is real and the fixed bars, sheets and dialogs pad
 * themselves by it (AUD-04 §3). Pinch zoom stays allowed: no maximum-scale,
 * no user-scalable=no.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* MOB-01 §27: on Android Chrome the on-screen keyboard shrinks the layout viewport, so a bottom action bar rides above it instead of being covered. iOS ignores this. */
  interactiveWidget: "resizes-content",
};

/* In the reader's language, like the page. A crawler sends no language
   cookie, so what is indexed is the English source. */
export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteCopy();

  return {
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
}

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
          <SessionLifecycle />
          <NativeBootstrap />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
