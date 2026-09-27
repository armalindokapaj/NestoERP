"use client";

import * as React from "react";

import {
  FormContractProvider,
  FormErrorSummary,
  useFieldWiring,
  useFormContract,
  useFormContractContext,
  type FieldValidator,
} from "@/components/forms/form-contract";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import type { FormErrorCategory } from "@/lib/forms/errors";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";

export { decimalValidator, dateValidator, FormErrorSummary, useFormContract, type FieldValidator } from "@/components/forms/form-contract";

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
 *
 * AUD-09 (§3, §6): the field and submission contract lives in
 * `form-contract.tsx` — unique per-instance ids, labels and required state
 * wired to the control, hints and errors through `aria-describedby`, blur and
 * submit validation timing, the error summary with focus, one submission path
 * for the button, Enter and Save and continue, and a distinct outcome for
 * every answer (`data-save-outcome`).
 */

export type SelectOption = { value: string; label: string };

export type FormActionResult =
  | { ok: true; redirectTo?: string }
  | {
      ok: false;
      error: string;
      code?: string;
      fieldErrors?: Record<string, string[]>;
      /** AUD-09 §3: which kind of refusal (`lib/actions/result.ts`); derived from `code` when absent. */
      category?: FormErrorCategory;
      /** A reference the person can quote for an unexpected failure. */
      reference?: string;
    };

/**
 * What a save answered, kept distinct (AUD-09 §3, §6; AUD-03 §6): saved, a
 * value to correct, a newer version, a permission or session that no longer
 * holds, a failure that saved nothing, or no answer at all — which keeps every
 * value and is never retried by itself.
 */
export type FormOutcome = SaveOutcome["kind"];

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

/** Native selects across the forms: 44px under touch; the 16px phone font is one rule in globals.css (AUD-04 §3, §6). */
export const selectClass =
  "h-10 touch:h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger";

/**
 * One labelled field (AUD-09 §3, FV-02). The control inside keeps the markup
 * its module gives it; the Field wires it: a unique id the label points at,
 * the hint or the error in `aria-describedby`, `aria-invalid` while an error
 * shows, and `required` / `aria-required` from the same `required` the
 * asterisk shows — so the browser, assistive technology and the label agree.
 *
 * `validate` adds the field's own rule (`decimalValidator`, `dateValidator`,
 * or any function answering a message) on top of the native constraints; it
 * should be the same `lib/forms` rule the server schema runs. `optional`
 * marks a field whose optionality is not obvious.
 */
export function Field({
  label,
  name,
  hint,
  required,
  optional,
  validate,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  validate?: FieldValidator;
  className?: string;
  children: React.ReactNode;
}) {
  const errors = useFieldErrors();
  const contract = useFormContractContext();
  const error = contract ? contract.errorFor(name) : errors[name]?.[0];
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const { controlId, nativeRequired } = useFieldWiring({ name, required, hint, error, wrapperRef });
  const register = contract?.register;
  React.useEffect(() => register?.(name, { label, validate }), [register, name, label, validate]);
  const showRequired = Boolean(required) || nativeRequired;

  return (
    <div ref={wrapperRef} className={cn("space-y-1.5", className)} data-field={name}>
      <Label htmlFor={controlId}>
        {label}
        {showRequired ? (
          <span className="ml-0.5 text-danger-strong" aria-hidden="true">
            *
          </span>
        ) : optional ? (
          <span className="ml-1 font-normal text-fg-subtle">(optional)</span>
        ) : null}
      </Label>
      {children}
      {hint && !error ? (
        <p id={`${controlId}-hint`} className="text-meta text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${controlId}-error`} className="text-meta text-danger-strong" data-testid="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A group of fields. `collapsible` renders it as a disclosure (`<details>`),
 * open unless `defaultOpen` is false; an invalid submit opens any section
 * holding an error before focusing it (AUD-09 §6).
 */
export function FormSection({
  title,
  description,
  collapsible,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  if (collapsible) {
    return (
      <details className="nesto-card group p-5" open={defaultOpen} data-form-section={title}>
        <summary className="cursor-pointer list-none text-card font-semibold text-fg">{title}</summary>
        {description ? <p className="mt-1 text-meta text-fg-subtle">{description}</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
      </details>
    );
  }
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
  instanceIds,
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
  /**
   * Prefix every field id with this form's own instance id, even where the
   * bare name would be unique (a form repeated on one page). Inside a dialog
   * this is automatic; on a page a bare `id={name}` is kept while it is unique.
   */
  instanceIds?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const frozen = useUnsavedFrozen();
  const kind = saveKind ?? (/^(create|add|new|log|record|raise|report|start)\b/i.test(submitLabel) ? "create" : "save");
  const [outcome, setOutcome] = React.useState<FormOutcome | null>(null);
  const contractRef = React.useRef<ReturnType<typeof useFormContract> | null>(null);
  const save = useEditorSave({
    formRef,
    action,
    label,
    module,
    saveKind: kind,
    baselineValues,
    onRefused: (result, submitted, saveOutcome) => {
      setOutcome(saveOutcome.kind);
      contractRef.current?.showServerRefusal();
      return onFailure?.(result as Extract<FormActionResult, { ok: false }>, submitted) === true;
    },
    onCommitted: (result, mode) => {
      setOutcome("committed");
      return result ? onSuccess?.(result, mode) === true : false;
    },
  });
  const { pending, saved, fieldErrors } = save;
  const contract = useFormContract(formRef, { serverErrors: fieldErrors, scoped: instanceIds });
  contractRef.current = contract;

  function onCancel() {
    router.push(cancelHref);
  }

  /**
   * The one submission path (AUD-09 §6, FV-12): the button and Enter arrive
   * here as the form's submit; AUD-03's Save and continue runs the same save
   * through `save.submit("continue")`, whose native check this contract
   * answers too. Nothing is sent while a field is invalid; one request runs
   * per submitted snapshot.
   */
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || saved) return;
    if (!contract.checkBeforeSubmit()) {
      setOutcome("invalid");
      return;
    }
    setOutcome(null);
    save.onSubmit(event);
  }

  return (
    <FieldErrorContext.Provider value={fieldErrors}>
      <FormContractProvider value={contract}>
        <form
          ref={formRef}
          {...contract.formProps}
          onSubmit={onSubmit}
          className="space-y-5"
          data-unsaved-dirty={save.editor.dirty || undefined}
          data-save-outcome={outcome ?? undefined}
          aria-busy={pending || undefined}
        >
          {versionUpdatedAt ? (
            <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
          ) : null}

          <FormErrorSummary contract={contract} />
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
      </FormContractProvider>
    </FieldErrorContext.Provider>
  );
}
