"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { commonEn } from "@/lib/i18n/modules/common/en";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";
import { statusLabel } from "@/lib/utils/status";

/** The shared module components' strings in English, for code that runs without a reader (pure helpers, tests). */
export const englishCommon: Translate<"common"> = createTranslator("en", commonEn);

/**
 * `t` for the shared module components. They render on nearly every page, so a
 * page outside every `ModuleMessages` boundary still reads English rather than keys.
 */
export function useCommonTranslations(): Translate<"common"> {
  const t = useTranslations("common");
  return React.useCallback<Translate<"common">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishCommon(key, values) : value;
  }, [t]);
}

/** A stored status or priority value, in the reader's language; an unknown value keeps its English label. */
export function StatusText({ status }: { status: string }) {
  const t = useTranslations("common");
  const key = `status.${status}` as MessageKey<"common">;
  const value = t(key);
  return <>{value === key ? statusLabel(status) : value}</>;
}
