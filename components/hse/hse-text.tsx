"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { hseEn } from "@/lib/i18n/modules/hse/en";
import { hseLabel, type HseLabelGroup } from "@/lib/i18n/modules/hse/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type HseKey = MessageKey<"hse">;

/** HSE's strings in English, for code that runs without a reader. */
export const englishHse: Translate<"hse"> = createTranslator("en", hseEn);

/**
 * `t` for HSE's Client Components. Some render outside the HSE boundary (a
 * project's HSE tab, the QA/QC forms), where a string falls back to English
 * rather than showing its key.
 */
export function useHseTranslations(): Translate<"hse"> {
  const t = useTranslations("hse");
  return React.useCallback<Translate<"hse">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishHse(key, values) : value;
  }, [t]);
}

/** An HSE string, for components that render on both the server and the client. */
export function HseText({ k, values }: { k: HseKey; values?: MessageValues }) {
  return <>{useHseTranslations()(k, values)}</>;
}

/** A stored HSE value's word, keyed by value; `fallback` is the config's English label. */
export function HseLabel({ group, value, fallback }: { group: HseLabelGroup; value: string | number; fallback: string }) {
  return <>{hseLabel(useHseTranslations(), group, value, fallback)}</>;
}

/** Every English message the HSE server actions return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(hseEn.server).map(([key, text]) => [text, `server.${key}` as HseKey]));

/**
 * A server action's message in the reader's language. The actions answer in
 * English (they cannot read the reader's locale without the server-only
 * helper); a message this module does not know passes through unchanged.
 */
export function useHseServerText(): (message: string | undefined | null) => string | undefined {
  const t = useHseTranslations();
  return React.useCallback(
    (message) => {
      if (!message) return undefined;
      const key = SERVER_KEYS.get(message);
      return key ? t(key) : message;
    },
    [t],
  );
}
