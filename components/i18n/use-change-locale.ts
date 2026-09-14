"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useLocale } from "@/components/i18n/i18n-provider";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";

/**
 * Switches the interface language for whoever is reading.
 *
 * Writes the cookie the server reads before rendering, then refreshes the
 * route: every server-rendered string comes back in the new language without a
 * full reload, and the root layout hands client components the new dictionary.
 * `choice` moves at once, so the control answers the click before the refresh
 * has landed.
 */
export function useChangeLocale() {
  const router = useRouter();
  const locale = useLocale();
  const [choice, setChoice] = React.useState<Locale>(locale);
  const [isPending, startTransition] = React.useTransition();

  function change(next: Locale) {
    if (next === choice) return;
    setChoice(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }

  return { choice, change, isPending };
}
