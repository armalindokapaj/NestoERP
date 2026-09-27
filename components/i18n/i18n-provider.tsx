"use client";

import * as React from "react";

import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { en, type Messages as FrameMessages } from "@/lib/i18n/messages/en";
import type { ModuleMessages } from "@/lib/i18n/modules";
import {
  createTranslator,
  type Messages,
  type Namespace,
  type Translate,
} from "@/lib/i18n/translator";

type I18nValue = { locale: Locale; messages: FrameMessages & Partial<ModuleMessages> };

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

/**
 * Adds module dictionaries to the ones already in context. Mounted by
 * `ModuleMessages` (a Server Component) in a module's layout, so a module's
 * strings reach the browser only on that module's pages.
 */
export function ModuleMessagesProvider({
  messages: added,
  children,
}: {
  messages: Partial<ModuleMessages>;
  children: React.ReactNode;
}) {
  const parent = React.useContext(I18nContext);
  const value = React.useMemo(
    () => ({ locale: parent.locale, messages: { ...parent.messages, ...added } }),
    [parent, added],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `t` for a Client Component. */
export function useTranslations<N extends Namespace>(namespace: N): Translate<N> {
  const { locale, messages } = React.useContext(I18nContext);
  if (process.env.NODE_ENV !== "production" && !(namespace in messages)) {
    console.warn(`useTranslations("${namespace}") outside its ModuleMessages boundary.`);
  }
  return React.useMemo(
    () =>
      createTranslator(
        locale,
        ((messages as Partial<Messages>)[namespace] ?? {}) as Messages[N],
      ),
    [locale, messages, namespace],
  );
}
