import { FILE_TYPES } from "@/lib/core/storage/file-type.registry";
import { createTranslator, type MessageKey, type Translate } from "@/lib/i18n/translator";

import { documentsEn } from "./en";

export type DocumentsLabelGroup = keyof typeof documentsEn.labels;

/** Documents' strings in English, for pure helpers called without a reader's `t`. */
export const englishDocuments: Translate<"documents"> = createTranslator("en", documentsEn);

/**
 * A stored Documents value's word in the reader's language. The config keeps
 * its English labels; `fallback` (that English label, or the value) shows for a
 * value the dictionary does not know.
 */
export function documentsLabel(
  t: Translate<"documents">,
  group: DocumentsLabelGroup,
  value: string,
  fallback?: string,
): string {
  const key = `labels.${group}.${value}` as MessageKey<"documents">;
  const text = t(key);
  return text === key ? (fallback ?? value) : text;
}

const FILE_TYPE_KEY_BY_LABEL = new Map(FILE_TYPES.map((type) => [type.label, type.key]));

/** A file type's English label (what the DTOs carry) in the reader's language. */
export function fileTypeLabel(t: Translate<"documents">, label: string): string {
  const key = FILE_TYPE_KEY_BY_LABEL.get(label);
  return key ? documentsLabel(t, "fileType", key, label) : label;
}

/** A document context's English label ("Project", "Client", a module) in the reader's language. */
export function contextLabel(t: Translate<"documents">, label: string): string {
  return documentsLabel(t, "context", label, label);
}

/** The storage state's message, keyed by status; `message` shows when the dictionary has none. */
export function storageMessageLabel(t: Translate<"documents">, status: string, message: string | null): string | null {
  return message === null ? null : documentsLabel(t, "storageMessage", status, message);
}

const UPLOAD_ERROR_KEYS = new Map(
  Object.entries(documentsEn.uploadErrors).map(([key, text]) => [text, `uploadErrors.${key}` as MessageKey<"documents">]),
);

/**
 * An upload or action message raised in English (upload client, queue, server
 * actions) in the reader's language; a message this module does not know
 * passes through unchanged.
 */
export function uploadErrorText(t: Translate<"documents">, message: string): string {
  const key = UPLOAD_ERROR_KEYS.get(message);
  if (key) return t(key);
  const choose = /^Choose (.+)\.$/.exec(message);
  if (choose) return t("queue.choose", { types: choose[1] });
  return message;
}
