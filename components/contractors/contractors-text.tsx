"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { contractorsEn } from "@/lib/i18n/modules/contractors/en";
import { contractorsLabel, type ContractorsLabelGroup } from "@/lib/i18n/modules/contractors/labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type ContractorsKey = MessageKey<"contractors">;

/** Contractors' strings in English, for code that runs without a reader. */
export const englishContractors: Translate<"contractors"> = createTranslator("en", contractorsEn);

/**
 * `t` for Contractors' Client Components. Some render outside the Contractors
 * boundary (a project's Contractors and Work packages tabs), where a string
 * falls back to English rather than showing its key.
 */
export function useContractorsTranslations(): Translate<"contractors"> {
  const t = useTranslations("contractors");
  return React.useCallback<Translate<"contractors">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishContractors(key, values) : value;
  }, [t]);
}

/** A Contractors string, for components that render on both the server and the client. */
export function ContractorsText({ k, values }: { k: ContractorsKey; values?: MessageValues }) {
  return <>{useContractorsTranslations()(k, values)}</>;
}

/** A stored Contractors value's word, keyed by value; `fallback` is the config's English label. */
export function ContractorsLabel({ group, value, fallback }: { group: ContractorsLabelGroup; value: string; fallback: string }) {
  return <>{contractorsLabel(useContractorsTranslations(), group, value, fallback)}</>;
}
