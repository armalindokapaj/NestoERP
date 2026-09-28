"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { workforceEn } from "@/lib/i18n/modules/workforce/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type WorkforceKey = MessageKey<"workforce">;

/** Workforce's strings in English, for code that runs without a reader. */
export const englishWorkforce: Translate<"workforce"> = createTranslator("en", workforceEn);

/**
 * `t` for Workforce's Client Components. Some render outside the Workforce
 * boundary (a project's Workforce tab, a person's profile), where a string
 * falls back to English rather than showing its key.
 */
export function useWorkforceTranslations(): Translate<"workforce"> {
  const t = useTranslations("workforce");
  return React.useCallback<Translate<"workforce">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishWorkforce(key, values) : value;
  }, [t]);
}

/** A Workforce string, for components that render on both the server and the client. */
export function WorkforceText({ k, values }: { k: WorkforceKey; values?: MessageValues }) {
  return <>{useWorkforceTranslations()(k, values)}</>;
}
