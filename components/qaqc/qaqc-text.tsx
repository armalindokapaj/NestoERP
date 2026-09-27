"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { qaqcEn } from "@/lib/i18n/modules/qaqc/en";
import { qaqcLabel, type QaqcLabelGroup } from "./qaqc-labels";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export type QaqcKey = MessageKey<"qaqc">;
export { qaqcLabel, type QaqcLabelGroup };

/** QA/QC's strings in English, for code that runs without a reader. */
export const englishQaqc: Translate<"qaqc"> = createTranslator("en", qaqcEn);

/**
 * `t` for QA/QC's Client Components. Some render outside the QA/QC boundary
 * (the badges on a project tab), so a string there falls back to English
 * rather than showing its key.
 */
export function useQaqcTranslations(): Translate<"qaqc"> {
  const t = useTranslations("qaqc");
  return React.useCallback<Translate<"qaqc">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishQaqc(key, values) : value;
  }, [t]);
}

/** A QA/QC string, for components that render on both the server and the client. */
export function QaqcText({ k, values }: { k: QaqcKey; values?: MessageValues }) {
  return <>{useQaqcTranslations()(k, values)}</>;
}

/** A stored value's label, for components that render on both the server and the client. */
export function QaqcLabel({ group, value }: { group: QaqcLabelGroup; value: string }) {
  return <>{qaqcLabel(useQaqcTranslations(), group, value)}</>;
}
