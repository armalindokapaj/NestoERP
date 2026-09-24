"use client";

import * as React from "react";

import { clampPanelWidth, PANEL_LIMITS } from "./save-state";

/**
 * Remembered panel layout for the Experience Editor (3D Editor PRD §130-§132).
 *
 * Only interface preferences are kept, in this browser: panel widths, which
 * panels are collapsed and the last tool. Nothing of the Experience itself,
 * and no selection, is ever stored here. Storage that is unavailable or holds
 * something unreadable leaves the defaults in place.
 */
export type EditorLayout<Tool extends string> = {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  tool: Tool;
};

const STORAGE_KEY = "nesto.3d-editor.layout.v1";

export function useEditorLayout<Tool extends string>(tools: readonly Tool[], initialTool: Tool) {
  const [layout, setLayout] = React.useState<EditorLayout<Tool>>({
    leftWidth: PANEL_LIMITS.left.initial,
    rightWidth: PANEL_LIMITS.right.initial,
    leftCollapsed: false,
    rightCollapsed: false,
    tool: initialTool,
  });
  const restored = React.useRef(false);

  React.useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<EditorLayout<Tool>> | null;
      if (stored && typeof stored === "object") {
        setLayout((current) => ({
          leftWidth: clampPanelWidth("left", Number(stored.leftWidth ?? current.leftWidth)),
          rightWidth: clampPanelWidth("right", Number(stored.rightWidth ?? current.rightWidth)),
          leftCollapsed: stored.leftCollapsed === true,
          rightCollapsed: stored.rightCollapsed === true,
          tool: stored.tool && tools.includes(stored.tool) ? stored.tool : current.tool,
        }));
      }
    } catch {
      // Private windows and blocked storage keep the defaults.
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Not remembering the layout is harmless.
    }
  }, [layout]);

  const update = React.useCallback((patch: Partial<EditorLayout<Tool>>) => {
    setLayout((current) => ({
      ...current,
      ...patch,
      leftWidth: clampPanelWidth("left", patch.leftWidth ?? current.leftWidth),
      rightWidth: clampPanelWidth("right", patch.rightWidth ?? current.rightWidth),
    }));
  }, []);

  return [layout, update] as const;
}
