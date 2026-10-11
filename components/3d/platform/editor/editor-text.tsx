"use client";

import * as React from "react";

import { createEditorText, type EditorText, type EditorTexts } from "@/lib/3d/platform/editor-text";

const EditorTextContext = React.createContext<EditorTexts>({});

/** Mounted by the editor's layout with the reader's dictionary; without it every text reads as written (English). */
export function EditorTextProvider({ texts, children }: { texts: EditorTexts; children: React.ReactNode }) {
  return <EditorTextContext.Provider value={texts}>{children}</EditorTextContext.Provider>;
}

export function useEditorWord(): EditorText {
  const texts = React.useContext(EditorTextContext);
  return React.useMemo(() => createEditorText(texts), [texts]);
}

/**
 * A text with markup inside it: `{0}` in the text takes the matching node
 * (`editorNodesServerText("The {0} moves", <b>site</b>)`), wherever the language puts it.
 */
export function useEditorNodeWord(): (text: string, ...nodes: React.ReactNode[]) => React.ReactNode {
  const t = useEditorWord();
  return React.useCallback((text, ...nodes) => {
    const parts = t(text).split(/(\{\d+\})/);
    return parts.map((part, index) => {
      const hole = /^\{(\d+)\}$/.exec(part);
      return hole ? <React.Fragment key={index}>{nodes[Number(hole[1])]}</React.Fragment> : part;
    });
  }, [t]);
}
