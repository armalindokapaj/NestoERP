"use client";

import * as React from "react";

import { useRouter } from "@/components/navigation/guarded-router";
import { reconcileTabContext } from "@/components/unsaved/unsaved-host";
import { useFormDirty, useUnsavedEditor, type UnsavedEditorOptions } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { readForm } from "@/lib/unsaved/form-snapshot";
import { isNextControlFlow, isStaleWorkspaceRefusal, OUTCOME_COPY, outcomeOf, type ActionLikeResult } from "@/lib/unsaved/outcome";

/**
 * One form's save, under the unsaved-work contract (AUD-03 §3, §6).
 *
 * What RecordForm does, for a form that owns its markup — Clients with its
 * duplicate warning, Projects, and every custom editor: the form registers with
 * the tab's coordinator, its dirtiness is what it would submit against its
 * baseline, and its save has an explicit outcome. Only a committed answer is
 * persistence and moves the baseline; a refusal keeps every value and says so;
 * a thrown request may have committed, and is said to be unknown. One request
 * runs per submitted snapshot, whatever is clicked meanwhile.
 *
 * Normal Save goes where the action said (`redirectTo`). Save and continue —
 * the prompt's button — runs this same save and leaves the destination to the
 * departure the person asked for.
 */

type Refusal = Extract<NonNullable<ActionLikeResult>, { ok: false }>;

export type EditorSaveOptions<R extends ActionLikeResult> = UnsavedEditorOptions & {
  formRef: React.RefObject<HTMLFormElement | null>;
  action: (formData: FormData) => Promise<R>;
  /** Names that are plumbing, not input. */
  ignore?: readonly string[];
  /** Saved values for fields the form opens with unsaved values in. */
  baselineValues?: Record<string, string>;
  /** Adds what this submission carries beyond the form: a decision such as "create anyway". */
  prepare?: (formData: FormData, mode: SaveMode) => void;
  /** Answer `true` when the form shows the refusal itself (a conflict review, a duplicate warning). */
  onRefused?: (result: Refusal, submitted: FormData, outcome: SaveOutcome) => boolean | void;
  /**
   * A committed save. Answer `true` when the form has gone on by itself;
   * otherwise a normal save goes to `redirectTo`, and Save and continue leaves
   * the destination to the departure.
   */
  onCommitted?: (result: Extract<NonNullable<R>, { ok: true }> | null, mode: SaveMode) => boolean | void;
  /** Business outcomes that mean "a person must decide" (duplicate warnings). */
  classify?: (result: R) => SaveOutcome | null;
};

export type SaveMode = "normal" | "continue";

export type EditorSave = {
  editor: ReturnType<typeof useUnsavedEditor>;
  pending: boolean;
  /** Saved, navigating: the form is done; `slow` offers the way on again. */
  saved: { href: string; slow: boolean } | null;
  error: string | null;
  /** The line under the message: not saved, unknown, or refused as stale. */
  outcomeText: string | null;
  fieldErrors: Record<string, string[]>;
  alertRef: React.RefObject<HTMLDivElement | null>;
  submit: (mode?: SaveMode) => Promise<SaveOutcome>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  rebaseline: () => void;
  clearMessages: () => void;
};

export function useEditorSave<R extends ActionLikeResult>(options: EditorSaveOptions<R>): EditorSave {
  const router = useRouter();
  const { formRef } = options;
  const alertRef = React.useRef<HTMLDivElement>(null);
  const submitting = React.useRef(false);
  const lastErrors = React.useRef<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState<{ href: string; slow: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  /** The first field the server or the browser refused; the form's message otherwise (UW-09). */
  const focusFirstInvalid = React.useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const errors = lastErrors.current;
    const first = [...form.elements].find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && (element.matches(":invalid") || ("name" in element && Boolean(errors[(element as HTMLInputElement).name]))),
    );
    if (first) {
      if (first.matches(":invalid")) form.reportValidity();
      first.focus();
    } else alertRef.current?.focus();
  }, [formRef]);

  const run = React.useRef<(mode: SaveMode) => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const tracker = React.useRef<ReturnType<typeof useFormDirty> | null>(null);
  const editor = useUnsavedEditor({
    ...options,
    save: () => run.current("continue"),
    focus: focusFirstInvalid,
    sync: () => tracker.current?.sync(),
  });
  const dirty = useFormDirty(formRef, editor, { paused: pending, ignore: options.ignore, baseline: options.baselineValues });
  tracker.current = dirty;

  run.current = async (mode) => {
    const form = formRef.current;
    // One request per snapshot: a second click, an Enter, a second
    // confirmation all find the first still running (§6, UW-13).
    if (!form || submitting.current) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    // The browser's own constraints first, as a normal submit would. After
    // Save and continue they are shown once the prompt has closed.
    if (!form.checkValidity()) {
      lastErrors.current = {};
      if (mode === "normal") form.reportValidity();
      return { kind: "invalid" };
    }
    const formData = new FormData(form);
    // What this save sends, read before the fieldset disables the fields
    // (a disabled field reads as absent): the baseline once it commits.
    const sent = readForm(form, new Set(optionsRef.current.ignore ?? []));
    optionsRef.current.prepare?.(formData, mode);
    submitting.current = true;
    setPending(true);
    setSaved(null);
    editor.setSaving(true);
    setError(null);
    setOutcomeText(null);
    setFieldErrors({});

    let result: R | undefined;
    let thrown: unknown = null;
    try {
      result = await optionsRef.current.action(formData);
    } catch (caught) {
      thrown = caught ?? new Error("rejected");
    }
    submitting.current = false;
    setPending(false);
    editor.setSaving(false);

    const stale = thrown !== null && isStaleWorkspaceRefusal(thrown);
    let outcome: SaveOutcome;
    if (stale) {
      // Refused before anything happened: another tab moved the workspace.
      outcome = { kind: "refused" };
      void reconcileTabContext();
    } else if (thrown !== null && isNextControlFlow(thrown)) {
      // An action that still redirects: the server committed and the router
      // is already on its way.
      outcome = { kind: "committed" };
    } else if (thrown !== null) {
      outcome = { kind: "unknown" };
    } else {
      outcome = (result !== undefined && optionsRef.current.classify?.(result)) || outcomeOf(result);
    }

    if (outcome.kind === "committed") {
      editor.setUnresolved(false);
      dirty.rebaseline(sent);
      const committed = result && result.ok ? (result as Extract<NonNullable<R>, { ok: true }>) : null;
      if (optionsRef.current.onCommitted?.(committed, mode) === true) return outcome;
      if (mode === "normal" && outcome.redirectTo) {
        setSaved({ href: outcome.redirectTo, slow: false });
        router.push(outcome.redirectTo);
      }
      return outcome;
    }

    editor.setUnresolved(outcome.kind === "unknown");
    const refusal: Refusal =
      result && !result.ok ? result : { ok: false, code: stale ? "WORKSPACE_CHANGED" : "UNCONFIRMED", error: stale ? OUTCOME_COPY.staleWorkspace : OUTCOME_COPY.unknown };
    const errors = (refusal.fieldErrors ?? {}) as Record<string, string[]>;
    lastErrors.current = errors;
    setFieldErrors(errors);
    const handled = optionsRef.current.onRefused?.(refusal, formData, outcome) === true;
    if (!handled) {
      if (outcome.kind === "unknown") setOutcomeText(OUTCOME_COPY.unknown);
      else if (stale) setError(OUTCOME_COPY.staleWorkspace);
      else {
        setError(refusal.error ?? null);
        setOutcomeText(OUTCOME_COPY.notSaved);
      }
      // After Save and continue the prompt hands focus here itself, once closed.
      if (mode === "normal") window.setTimeout(focusFirstInvalid, 0);
    }
    return outcome;
  };

  // A save whose navigation is slow or failed stays saved, and offers the way
  // on without saving again (§6, UW-14).
  React.useEffect(() => {
    if (!saved || saved.slow) return;
    const timer = window.setTimeout(() => setSaved((current) => (current ? { ...current, slow: true } : current)), 6000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const submit = React.useCallback((mode: SaveMode = "normal") => run.current(mode), []);
  const onSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run.current("normal");
  }, []);
  const clearMessages = React.useCallback(() => {
    setError(null);
    setOutcomeText(null);
  }, []);

  return { editor, pending, saved, error, outcomeText, fieldErrors, alertRef, submit, onSubmit, rebaseline: dirty.rebaseline, clearMessages };
}
