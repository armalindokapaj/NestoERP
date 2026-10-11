"use client";

import * as React from "react";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { approvalsEn } from "@/lib/i18n/modules/approvals/en";
import { approvalsWord } from "@/lib/i18n/modules/approvals/server-text";
import { createTranslator, type MessageKey, type MessageValues, type Translate } from "@/lib/i18n/translator";

export { approvalsWord };

export type ApprovalsKey = MessageKey<"approvals">;

/** The Approvals Center's strings in English, for code that runs without a reader. */
export const englishApprovals: Translate<"approvals"> = createTranslator("en", approvalsEn);

/**
 * `t` for the Approvals Center's Client Components. Outside the Approvals
 * boundary (a unit test's render) a string falls back to English rather than
 * showing its key.
 */
export function useApprovalsTranslations(): Translate<"approvals"> {
  const t = useTranslations("approvals");
  return React.useCallback<Translate<"approvals">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishApprovals(key, values) : value;
  }, [t]);
}

/** An Approvals string, for components that render on both the server and the client. */
export function ApprovalsText({ k, values }: { k: ApprovalsKey; values?: MessageValues }) {
  return <>{useApprovalsTranslations()(k, values)}</>;
}

/** `approvalsWord` bound to the reader. */
export function useApprovalsWord(): (english: string) => string {
  const t = useApprovalsTranslations();
  const locale = useLocale();
  return React.useCallback((english: string) => approvalsWord(t, english, locale), [t, locale]);
}
