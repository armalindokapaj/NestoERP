"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { threeDEn } from "@/lib/i18n/modules/threeD/en";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";

export type ThreeDKey = MessageKey<"threeD">;

/** The 3D viewer's strings in English, for code that runs without a reader. */
export const englishThreeD: Translate<"threeD"> = createTranslator("en", threeDEn);

/**
 * `t` for the 3D viewer's Client Components. The renderer also mounts inside
 * the platform Experience Editor, outside the viewer's boundary, where a
 * string falls back to English rather than showing its key.
 */
export function useThreeDTranslations(): Translate<"threeD"> {
  const t = useTranslations("threeD");
  return React.useCallback<Translate<"threeD">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishThreeD(key, values) : value;
  }, [t]);
}
