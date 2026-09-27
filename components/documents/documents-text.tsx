"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  contextLabel,
  documentsLabel,
  englishDocuments,
  fileTypeLabel,
  storageMessageLabel,
  uploadErrorText,
  type DocumentsLabelGroup,
} from "@/lib/i18n/modules/documents/labels";
import type { MessageKey, MessageValues, Translate } from "@/lib/i18n/translator";

export type DocumentsKey = MessageKey<"documents">;
export { contextLabel, documentsLabel, englishDocuments, fileTypeLabel, storageMessageLabel, uploadErrorText, type DocumentsLabelGroup };

/**
 * `t` for Documents' Client Components. Most render outside the Documents
 * boundary (a record's upload queue, a unit's media), so a string there falls
 * back to English rather than showing its key.
 */
export function useDocumentsTranslations(): Translate<"documents"> {
  const t = useTranslations("documents");
  return React.useCallback<Translate<"documents">>((key, values) => {
    const value = t(key, values);
    return value === key ? englishDocuments(key, values) : value;
  }, [t]);
}

/** A Documents string, for components that render on both the server and the client. */
export function DocumentsText({ k, values }: { k: DocumentsKey; values?: MessageValues }) {
  return <>{useDocumentsTranslations()(k, values)}</>;
}
