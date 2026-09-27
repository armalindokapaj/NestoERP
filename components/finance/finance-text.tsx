"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { financeEn } from "@/lib/i18n/modules/finance/en";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type FinanceKey = MessageKey<"finance">;

/** Finance's strings in English, for code that runs without a reader. */
export const englishFinance: Translate<"finance"> = createTranslator("en", financeEn);

/**
 * `t` for Finance's Client Components. Several of them render in other modules
 * too (the reject dialog, line rows, unit finance), so outside the Finance
 * boundary a string falls back to English rather than showing its key.
 */
export function useFinanceTranslations(): Translate<"finance"> {
  const t = useTranslations("finance");
  return React.useCallback<Translate<"finance">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishFinance(key, values) : value;
  }, [t]);
}

/** A Finance string, for components that render on both the server and the client. */
export function FinanceText({ k, values }: { k: FinanceKey; values?: MessageValues }) {
  return <>{useFinanceTranslations()(k, values)}</>;
}
