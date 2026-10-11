import { getLocale } from "@/lib/i18n/server";
import { threeDEditorSq } from "@/lib/i18n/modules/threeD/config-sq";

import { createEditorText, type EditorText, type EditorTexts } from "./editor-text";

/** The dictionary the editor's client components receive: empty for English, which answers as written. */
export async function getEditorTexts(): Promise<EditorTexts> {
  return (await getLocale()) === "sq" ? threeDEditorSq : {};
}

/** The editor's text function for a Server Component (its access and not-found screens, its tab title). */
export async function getEditorTranslations(): Promise<EditorText> {
  return createEditorText(await getEditorTexts());
}
