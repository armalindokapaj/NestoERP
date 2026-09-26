"use client";

import * as React from "react";

import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";

/**
 * The shared create/edit form shell (PRD #7 §43, PRD #10 §151).
 *
 * Every module's record form is the same machine: grouped sections, field-level
 * errors returned by the server, a single pending state, and the unsaved-work
 * contract (AUD-03): semantic dirtiness against what the form would submit,
 * registration with the tab's coordinator so every departure asks first, and an
 * explicit save outcome — only a committed answer is a save. Only the fields
 * differ.
 *
 * Client-side validation exists so the person filling the form finds out
 * sooner. The server is still the authority and validates again.
 */

export type SelectOption = { value: string; label: string };

export type FormActionResult =
  | { ok: true; redirectTo?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

/**
 * An action that threw instead of answering — the connection dropped, or the
 * request timed out. The server may or may not have committed, so the form
 * says so rather than claiming either (AUD-02 §7, AUD-03 §6).
 */
export const UNCONFIRMED_RESULT: Extract<FormActionResult, { ok: false }> = {
  ok: false,
  code: "UNCONFIRMED",
  error: OUTCOME_COPY.unknown,
};

const FieldErrorContext = React.createContext<Record<string, string[]>>({});

export function useFieldErrors() {
  return React.useContext(FieldErrorContext);
}

/**
 * Exported so a form that owns its own submit path — Clients needs one for
 * "Create anyway" past a duplicate warning — still feeds the same `Field`
 * components the same errors.
 */
export function FieldErrorProvider({
  value,
  children,
}: {
  value: Record<string, string[]>;
  children: React.ReactNode;
}) {
  return <FieldErrorContext.Provider value={value}>{children}</FieldErrorContext.Provider>;
}

export const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

export function Field({
  label,
  name,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const errors = useFieldErrors();
  const error = errors[name];

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>
        {label}
        {required ? <span className="ml-0.5 text-danger-strong">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
      {error ? (
        <p id={`${name}-error`} className="text-meta text-danger-strong">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      {description ? <p className="mt-1 text-meta text-fg-subtle">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * `saveKind` says whether this form's submit is an ordinary save of a record
 * that exists ("save") or creates one ("create"): what "Save and continue" is
 * called in the unsaved-changes prompt. A form whose submit is a workflow step
 * (Send, Submit, Approve) is not a RecordForm.
 */
export function RecordForm({
  action,
  cancelHref,
  submitLabel,
  pendingLabel,
  versionUpdatedAt,
  saveKind,
  label,
  module,
  baselineValues,
  onFailure,
  onSuccess,
  children,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  /** Optimistic-concurrency stamp the form was loaded with. */
  versionUpdatedAt?: string;
  saveKind?: "save" | "create";
  /** What the unsaved-changes prompt calls this form; the page heading when absent. */
  label?: string;
  /** For telemetry only. */
  module?: string;
  /**
   * The saved values, when the form opens on values that are not saved yet —
   * a task's conflict review applies chosen changes onto the latest version
   * (AUD-02 §7). Those fields start dirty against these, not clean.
   */
  baselineValues?: Record<string, string>;
  /**
   * The whole refusal, for a form that shows more than the message — the people
   * a new employee might be (E-04 §92). Answer `true` when the form shows the
   * refusal itself, and the shared alert stays empty (a task's conflict review,
   * AUD-02 §7). The field errors are applied either way.
   */
  onFailure?: (result: Extract<FormActionResult, { ok: false }>, submitted: FormData) => void | boolean;
  /**
   * A committed save. Answer `true` when the form went on by itself; otherwise
   * a normal save opens `redirectTo`, and after Save and continue the person's
   * own destination wins (AUD-03 §6).
   */
  onSuccess?: (result: Extract<FormActionResult, { ok: true }>, mode: "normal" | "continue") => void | boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const frozen = useUnsavedFrozen();
  const kind = saveKind ?? (/^(create|add|new|log|record|raise|report|start)\b/i.test(submitLabel) ? "create" : "save");
  const save = useEditorSave({
    formRef,
    action,
    label,
    module,
    saveKind: kind,
    baselineValues,
    onRefused: (result, submitted) => onFailure?.(result as Extract<FormActionResult, { ok: false }>, submitted) === true,
    onCommitted: (result, mode) => (result ? onSuccess?.(result, mode) === true : false),
  });
  const { pending, saved, fieldErrors } = save;

  function onCancel() {
    router.push(cancelHref);
  }

  return (
    <FieldErrorContext.Provider value={fieldErrors}>
      <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5" data-unsaved-dirty={save.editor.dirty || undefined}>
        {versionUpdatedAt ? (
          <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
        ) : null}

        <SaveMessages save={save} />

        {/* The submitted snapshot saves as it was: nothing in it changes meanwhile (§6). */}
        <fieldset disabled={pending || Boolean(saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-5 border-0 p-0">
          {children}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || frozen || Boolean(saved)}>
            {pending ? pendingLabel : submitLabel}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <UnsavedIndicator save={save} />
        </div>
      </form>
    </FieldErrorContext.Provider>
  );
}
