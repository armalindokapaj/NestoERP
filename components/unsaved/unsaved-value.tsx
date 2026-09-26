"use client";

import * as React from "react";

import { useUnsavedEditor, type UnsavedEditorOptions } from "@/components/unsaved/use-unsaved";

/**
 * Registers a piece of state an owner already tracks — a reason typed into a
 * dialog, a note beside a decision — as an editor (AUD-03 §3). Rendered where
 * the input lives, inside its dialog, so closing that dialog asks about it.
 */
export function UnsavedValue({ dirty, saving = false, ...options }: UnsavedEditorOptions & { dirty: boolean; saving?: boolean }) {
  const editor = useUnsavedEditor(options);
  const { setDirty, setSaving } = editor;
  React.useEffect(() => setDirty(dirty), [dirty, setDirty]);
  React.useEffect(() => setSaving(saving), [saving, setSaving]);
  return null;
}
