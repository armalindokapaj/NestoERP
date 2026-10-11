/**
 * The Experience Editor's wording. The editor is one dense authoring surface
 * whose labels are written in English where they are used, so its dictionary
 * is keyed by that English text: a text the dictionary does not know (and every
 * text for an English reader) answers as written. `{0}`, `{1}` hold values.
 */
export type EditorTexts = Readonly<Record<string, string>>;
export type EditorTextValue = string | number;
export type EditorText = (text: string, ...values: EditorTextValue[]) => string;

export function fillEditorText(template: string, values: readonly EditorTextValue[]): string {
  return values.length === 0 ? template : template.replace(/\{(\d+)\}/g, (hole, index: string) => String(values[Number(index)] ?? hole));
}

export function createEditorText(texts: EditorTexts): EditorText {
  return (text, ...values) => fillEditorText(Object.hasOwn(texts, text) ? texts[text] : text, values);
}
