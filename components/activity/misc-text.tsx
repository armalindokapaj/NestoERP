"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { miscEn } from "@/lib/i18n/modules/misc/en";
import { createTranslator, type Translate } from "@/lib/i18n/translator";

/** The small pages' strings in English, for code that runs without a reader. */
export const englishMisc: Translate<"misc"> = createTranslator("en", miscEn);

/**
 * `t` for the small workspace-neutral pages' Client Components (Activity Center
 * filters, the search field, the invitation forms). Outside a boundary that
 * mounts `misc`, a string falls back to English rather than showing its key.
 */
export function useMiscTranslations(): Translate<"misc"> {
  const t = useTranslations("misc");
  return React.useCallback<Translate<"misc">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishMisc(key, values) : value;
  }, [t]);
}
