"use client";

import * as React from "react";

import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";

/**
 * One of a meeting panel's inline drafts — a topic being added, a decision
 * being edited — under the unsaved-work contract (AUD-03 §3).
 *
 * The panel says whether the draft differs from what it opened with, and how
 * to send it; `send` answers the save's outcome and, when committed, resets
 * the draft itself. `run` is the draft's own Save button and the prompt's
 * Save and continue alike: one request at a time, saving while it runs,
 * unknown when it never got an answer. `dismiss` asks before an in-place
 * Cancel or Done throws the draft away.
 */
export function useMeetingDraft({
  label,
  saveKind,
  dirty,
  send,
}: {
  label: string | (() => string);
  saveKind: "save" | "create";
  dirty: boolean;
  send: () => Promise<SaveOutcome>;
}) {
  const running = React.useRef(false);
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "meetings", saveKind, label, save: () => run.current() });
  const { setDirty, setSaving, setUnresolved } = editor;
  const [commits, setCommits] = React.useState(0);
  // Re-read after each commit: the panel's reset decides what is left.
  React.useEffect(() => setDirty(dirty), [dirty, commits, setDirty]);

  run.current = async () => {
    if (running.current) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    running.current = true;
    setSaving(true);
    let outcome: SaveOutcome;
    try {
      outcome = await sendRef.current();
    } catch {
      outcome = { kind: "unknown" };
    }
    // Clean before it stops saving, so a departure waiting on it goes on.
    if (outcome.kind === "committed") {
      setDirty(false);
      setCommits((count) => count + 1);
    }
    setUnresolved(outcome.kind === "unknown");
    running.current = false;
    setSaving(false);
    return outcome;
  };

  const save = React.useCallback(() => run.current(), []);
  const dismiss = React.useCallback((discard: () => void) => dismissEditor(editor.id, discard), [editor.id]);
  return { editor, save, dismiss };
}

/**
 * `requestDismiss`, and then the approval is let go at once: the page stays,
 * so the approval must not keep other editors' departures from asking (it
 * would for the coordinator's leaving window otherwise).
 */
export async function dismissEditor(editorId: string, discard: () => void): Promise<boolean> {
  const intent = { kind: "dismiss", scope: `editor:${editorId}` } as const;
  if (!unsaved.hasBlocking(intent)) {
    discard();
    return true;
  }
  const approval = await unsaved.requestDeparture(intent);
  if (!approval) return false;
  const ran = approval.run(discard);
  approval.release();
  return ran;
}
