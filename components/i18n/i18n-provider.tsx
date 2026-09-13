"use client";

import * as React from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { en, type Messages } from "@/lib/i18n/messages/en";
import { createTranslator, type Namespace, type Translate } from "@/lib/i18n/translator";

type I18nValue = { locale: Locale; messages: Messages };

/*
 * English is the default rather than a thrown error, so a client component
 * rendered outside the root layout still reads as the product did before
 * translation existed.
 */
const I18nContext = React.createContext<I18nValue>({ locale: DEFAULT_LOCALE, messages: en });

/**
 * Hands the reader's dictionary to client components.
 *
 * Mounted once, in the root layout, with only the active language's messages —
 * the other dictionaries never reach the browser. Changing language refreshes
 * the route, which re-renders the layout and replaces this value.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: I18nValue & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return React.useContext(I18nContext).locale;
}

/** `t` for a Client Component. */
export function useTranslations<N extends Namespace>(namespace: N): Translate<N> {
  const { locale, messages } = React.useContext(I18nContext);
  return React.useMemo(
    () => createTranslator(locale, messages[namespace]),
    [locale, messages, namespace],
  );
}
