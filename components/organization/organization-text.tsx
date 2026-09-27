"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { organizationEn } from "@/lib/i18n/modules/organization/en";
import { moduleName } from "@/lib/i18n/modules/organization/labels";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";

export type OrganizationKey = MessageKey<"organization">;

/** Organization's strings in English, for code that runs without a reader. */
export const englishOrganization: Translate<"organization"> = createTranslator("en", organizationEn);

/**
 * `t` for Organization's Client Components. The department dialogs also serve
 * the Platform Admin's group setup, outside the Organization boundary, where a
 * string falls back to English rather than showing its key.
 */
export function useOrganizationTranslations(): Translate<"organization"> {
  const t = useTranslations("organization");
  return React.useCallback<Translate<"organization">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishOrganization(key, values) : value;
  }, [t]);
}

/** A module's name in the reader's language, from the frame's module names; `fallback` is the registry's English. */
export function useModuleName(): (key: string, fallback: string) => string {
  const t = useTranslations("modules");
  return React.useCallback((key, fallback) => moduleName(t, key, fallback), [t]);
}
