"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { salesEn } from "@/lib/i18n/modules/sales/en";
import { salesLabel, type SalesLabelGroup } from "@/lib/i18n/modules/sales/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type SalesKey = MessageKey<"sales">;

/** Sales' strings in English, for code that runs without a reader. */
export const englishSales: Translate<"sales"> = createTranslator("en", salesEn);

/**
 * `t` for Sales' Client Components. Some render outside the Sales boundary
 * (a project's or unit's sales panel), where a string falls back to English
 * rather than showing its key.
 */
export function useSalesTranslations(): Translate<"sales"> {
  const t = useTranslations("sales");
  return React.useCallback<Translate<"sales">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishSales(key, values) : value;
  }, [t]);
}

/** A Sales string, for components that render on both the server and the client. */
export function SalesText({ k, values }: { k: SalesKey; values?: MessageValues }) {
  return <>{useSalesTranslations()(k, values)}</>;
}

/** A stored Sales value's word, keyed by value; `fallback` is the config's English label. */
export function SalesLabel({ group, value, fallback }: { group: SalesLabelGroup; value: string | number; fallback: string }) {
  return <>{salesLabel(useSalesTranslations(), group, value, fallback)}</>;
}

/** Every English message the Sales server actions return, back to its key. */
const SERVER_KEYS = new Map(Object.entries(salesEn.server).map(([key, text]) => [text, `server.${key}` as SalesKey]));

/**
 * A server action's message in the reader's language. The actions answer in
 * English (they cannot read the reader's locale without the server-only
 * helper); a message this module does not know passes through unchanged.
 */
export function useSalesServerText(): (message: string | undefined | null) => string | undefined {
  const t = useSalesTranslations();
  return React.useCallback(
    (message) => {
      if (!message) return undefined;
      const key = SERVER_KEYS.get(message);
      return key ? t(key) : message;
    },
    [t],
  );
}
