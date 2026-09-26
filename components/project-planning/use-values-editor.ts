"use client";

import * as React from "react";

import { isFailure } from "@/components/project-planning/planning-api";
import { useUnsavedEditor, type UnsavedEditor, type UnsavedEditorOptions } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { outcomeOf } from "@/lib/unsaved/outcome";

/**
 * A controlled editor's part in the unsaved-work contract (AUD-03 §3, §6), for
 * the planning, structure and project dialogs whose values live in React state
 * and save through `planningApi` / `announcementApi`.
 *
 * Dirtiness is the editor's values against the baseline they opened with, so
 * typing a value back makes it clean again. `track` wraps one save request:
 * saving while it runs, a new baseline only after the server answered yes, and
 * an unknown outcome when the request never got an answer (a lost connection
 * may have committed). It rethrows, so the editor keeps showing the server's
 * own message.
 */
export type ValuesEditor = UnsavedEditor & {
  track: <T>(request: () => Promise<T>) => Promise<T>;
  /** The current values become the baseline: only after a committed save. */
  rebaseline: () => void;
};

export function useValuesEditor(values: unknown, options: UnsavedEditorOptions): ValuesEditor {
  const editor = useUnsavedEditor(options);
  const current = JSON.stringify(values ?? null);
  const [baseline, setBaseline] = React.useState(current);
  const currentRef = React.useRef(current);
  currentRef.current = current;
  const { setDirty, setSaving, setUnresolved } = editor;

  React.useEffect(() => setDirty(current !== baseline), [current, baseline, setDirty]);

  /** `sent` is what the save carried; anything typed while it ran stays unsaved. */
  const settle = React.useCallback(
    (sent: string) => {
      setBaseline(sent);
      // At once: Save and continue looks again right after the save answers.
      setDirty(sent !== currentRef.current);
    },
    [setDirty],
  );
  const rebaseline = React.useCallback(() => settle(currentRef.current), [settle]);

  const track = React.useCallback(
    async <T,>(request: () => Promise<T>): Promise<T> => {
      const sent = currentRef.current;
      setSaving(true);
      try {
        const result = await request();
        setUnresolved(false);
        settle(sent);
        return result;
      } catch (error) {
        setUnresolved(failureOutcome(error).kind === "unknown");
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setUnresolved, settle],
  );

  return React.useMemo(() => ({ ...editor, track, rebaseline }), [editor, track, rebaseline]);
}

/**
 * What a failed `planningApi` / `announcementApi` call means for a save (§6):
 * the server's refusal by its code, or unknown when no answer came back.
 */
export function failureOutcome(error: unknown): SaveOutcome {
  if (!isFailure(error) || error.status === 0) return { kind: "unknown" };
  return outcomeOf({ ok: false, code: error.detailCode ?? error.code, error: error.message });
}

export const COMMITTED: SaveOutcome = { kind: "committed" };
export const INVALID: SaveOutcome = { kind: "invalid" };
