"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringEn } from "@/lib/i18n/modules/engineering/en";
import { engineeringLabel, type EngineeringLabelGroup } from "@/lib/i18n/modules/engineering/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type EngineeringKey = MessageKey<"engineering">;

/** Engineering's strings in English, for code that runs without a reader. */
export const englishEngineering: Translate<"engineering"> = createTranslator("en", engineeringEn);

/**
 * `t` for Engineering's Client Components. Some render outside the Engineering
 * boundary (a contractor's pages, a work package), where a string falls back to
 * English rather than showing its key.
 */
export function useEngineeringTranslations(): Translate<"engineering"> {
  const t = useTranslations("engineering");
  return React.useCallback<Translate<"engineering">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishEngineering(key, values) : value;
  }, [t]);
}

/** An Engineering string, for components that render on both the server and the client. */
export function EngineeringText({ k, values }: { k: EngineeringKey; values?: MessageValues }) {
  return <>{useEngineeringTranslations()(k, values)}</>;
}

/** A stored Engineering value's word, keyed by value; `fallback` is the config's English label. */
export function EngineeringLabel({ group, value, fallback }: { group: EngineeringLabelGroup; value: string | number; fallback: string }) {
  return <>{engineeringLabel(useEngineeringTranslations(), group, value, fallback)}</>;
}
