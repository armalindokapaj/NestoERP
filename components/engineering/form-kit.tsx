"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { FormErrorSummary, guardComposingEnter, reveal, useSubmitOnlyButton, type SummaryEntry } from "@/components/forms/form-contract";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormDirty, useUnsavedEditor, useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import { checkField, isShown, payloadFor, validateFieldValues, valuesFor, type FormField, type FormValue, type FormValues } from "@/lib/forms/field-config";
import { unsaved, type SaveKind, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";
import { failureMessage, failureOutcome, fieldErrorsOf, isFailure } from "./engineering-api";
import { FormSelect } from "@/components/ui/form-select";

/**
 * One form grammar for contractor and engineering records (PRD #46 §166,
 * §170). A field list drives the dialog: labels above inputs, errors under the
 * field the server named, optional fields sent as null, the submit button busy
 * while the server decides. Every dialog in the module reads the same way.
 *
 * AUD-09 (§3-§6): the same field and submission contract as RecordForm —
 * per-instance ids, required state and descriptions wired to each control,
 * nothing shown on load, a field checked when left and everything on submit,
 * an error summary with focus, one submission path (button, Enter, Save and
 * continue), and distinct outcomes. Hidden fields follow an explicit
 * `whenHidden` policy (`lib/forms/field-config.ts`), omitted by default.
 *
 * The kit's own words come from the frame dictionary (`ui`): people,
 * organization, HR, workforce and the admin consoles use these dialogs too,
 * and a module's dictionary is not there on their pages.
 */

export { payloadFor, valuesFor, type FormField, type FormValue, type FormValues, type HiddenPolicy } from "@/lib/forms/field-config";

/**
 * What a thrown call means for unsaved work (AUD-03 §6), as the kit reads it:
 * a gateway that timed out or gave up (502, 504) never said whether the
 * change went through, so it is unknown — not a failure to retry.
 */
function kitOutcome(failure: unknown): SaveOutcome {
  if (isFailure(failure) && (failure.status === 502 || failure.status === 504)) return { kind: "unknown" };
  return failureOutcome(failure);
}

export function FormFields({
  fields,
  values,
  onChange,
  errors,
  idPrefix,
  onBlurField,
  onBadInput,
}: {
  fields: FormField[];
  values: FormValues;
  onChange: (name: string, value: FormValue) => void;
  errors: Record<string, string>;
  idPrefix: string;
  /** A field was left: the dialog checks it now (AUD-09 §3). */
  onBlurField?: (name: string) => void;
  /** A number field's text the browser could not read — it reports it as empty, which it is not. */
  onBadInput?: (name: string, bad: boolean) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        if (!isShown(field, values)) return null;
        const id = `${idPrefix}-${field.name}`;
        const error = errors[field.name];
        const describedBy = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
        const blur = onBlurField ? () => onBlurField(field.name) : undefined;
        if (field.type === "checkbox") {
          return (
            <div key={field.name} className={cn("flex flex-col gap-1", field.wide !== false && "sm:col-span-2")}>
              <label htmlFor={id} className="flex items-start gap-2.5 text-body text-fg">
                <Checkbox
                  id={id}
                  checked={Boolean(values[field.name])}
                  onCheckedChange={(checked) => onChange(field.name, checked === true)}
                  onBlur={blur}
                  disabled={field.disabled}
                  aria-invalid={Boolean(error) || undefined}
                  aria-required={field.required || undefined}
                  aria-describedby={describedBy}
                />
                <span>
                  {field.label}
                  {field.hint && !error ? (
                    <span id={`${id}-hint`} className="block text-meta text-fg-subtle">
                      {field.hint}
                    </span>
                  ) : null}
                </span>
              </label>
              {error ? (
                <p id={`${id}-error`} className="text-meta text-danger-strong" data-testid="field-error">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }
        const common = {
          id,
          name: field.name,
          "aria-invalid": Boolean(error) || undefined,
          "aria-describedby": describedBy,
          "aria-required": field.required || undefined,
          disabled: field.disabled,
          required: field.required,
          onBlur: blur,
        };
        return (
          <div key={field.name} className={cn("flex min-w-0 flex-col gap-1", (field.wide || field.type === "textarea") && "sm:col-span-2")} data-field={field.name}>
            <label htmlFor={id} className="text-meta font-medium text-fg-muted">
              {field.label}
              {field.required ? (
                <span className="text-danger-strong" aria-hidden="true">
                  {" "}*
                </span>
              ) : null}
            </label>
            {field.type === "textarea" ? (
              <Textarea {...common} rows={field.rows ?? 3} value={String(values[field.name] ?? "")} placeholder={field.placeholder} maxLength={field.maxLength} onChange={(event) => onChange(field.name, event.target.value)} />
            ) : field.type === "select" ? (
              <FormSelect {...common} className={selectClass} value={String(values[field.name] ?? "")} onChange={(event) => onChange(field.name, event.target.value)}>
                {field.emptyLabel !== undefined || !field.required ? <option value="">{field.emptyLabel ?? "—"}</option> : null}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FormSelect>
            ) : (
              <Input
                {...common}
                type={field.type === "number" ? "number" : field.type}
                step={field.step}
                inputMode={field.type === "number" ? "decimal" : field.type === "tel" ? "tel" : undefined}
                value={String(values[field.name] ?? "")}
                placeholder={field.placeholder}
                maxLength={field.type === "number" ? undefined : field.maxLength}
                onChange={(event) => {
                  if (field.type === "number") onBadInput?.(field.name, event.target.validity.badInput);
                  onChange(field.name, event.target.value);
                }}
              />
            )}
            {error ? (
              <p id={`${id}-error`} className="text-meta text-danger-strong" data-testid="field-error">
                {error}
              </p>
            ) : field.hint ? (
              <p id={`${id}-hint`} className="text-meta text-fg-subtle">
                {field.hint}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** What a submit label says about the step (AUD-03 §3): an ordinary save, a create, or a workflow step. */
function saveKindOf(submitLabel: string): SaveKind {
  if (/^(create|add|new|log|record|raise|report|start|register)\b/i.test(submitLabel)) return "create";
  if (/^(save|update)\b/i.test(submitLabel)) return "save";
  return "none";
}

function sameValues(a: FormValues, b: FormValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * A dialog of fields under the unsaved-work contract (AUD-03 §3, §5). Its
 * values live inside the dialog, so they start fresh each time it opens and
 * survive a close that was refused. Every close — X, Escape, the backdrop,
 * Cancel — asks while anything typed is unsaved. A submit that is an ordinary
 * save offers "Save and continue" through the same path as its own button; a
 * workflow step (Verify, Assign, Void…) is never run from the prompt. Pass
 * `saveKind` when the submit label does not say which it is.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  wide = false,
  testId,
  ...body
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FormField[];
  initial?: Partial<Record<string, unknown>>;
  submitLabel: string;
  /**
   * Throw the API failure to show it; resolve to close. Resolve to
   * `{ redirectTo }` to open a page after an ordinary save — never navigate
   * from here: the editor is still saving, and after the prompt's Save and
   * continue the person's own destination wins (AUD-03 §6).
   */
  onSubmit: (payload: Record<string, unknown>, values: FormValues) => Promise<void | { redirectTo?: string }>;
  wide?: boolean;
  testId?: string;
  children?: React.ReactNode;
  onValuesChange?: (values: FormValues) => void;
  /** Inferred from `submitLabel` when absent: Save/Update, Create/Add/…, otherwise a workflow step. */
  saveKind?: SaveKind;
  /** For telemetry only. */
  module?: string;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog open={open} locked={pending} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[92dvh] overflow-y-auto", wide ? "max-w-3xl" : "max-w-xl")} data-testid={testId}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {/* Inside the dialog, so the editor belongs to its guarded close (AUD-03 §5). */}
        <FormDialogBody {...body} title={title} pending={pending} setPending={setPending} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function FormDialogBody({
  title,
  fields,
  initial,
  submitLabel,
  onSubmit,
  children,
  onValuesChange,
  saveKind,
  module,
  pending,
  setPending,
  onDone,
}: {
  title: string;
  fields: FormField[];
  initial?: Partial<Record<string, unknown>>;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>, values: FormValues) => Promise<void | { redirectTo?: string }>;
  children?: React.ReactNode;
  onValuesChange?: (values: FormValues) => void;
  saveKind?: SaveKind;
  module?: string;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onDone: () => void;
}) {
  const close = useDialogClose();
  const t = useTranslations("ui");
  const formRef = React.useRef<HTMLFormElement>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  // Mounted when the dialog opens: the values start from `initial` each time.
  const [baseline, setBaseline] = React.useState<FormValues>(() => valuesFor(fields, initial));
  const [values, setValues] = React.useState<FormValues>(baseline);
  // The server's field errors, until the field is edited (its verdict was about the old value).
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  // The client's, for fields left or after a submit attempt (AUD-09 §3).
  const [clientErrors, setClientErrors] = React.useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = React.useState<string[]>([]);
  const [attempted, setAttempted] = React.useState(false);
  const [badInput, setBadInput] = React.useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = React.useState<SaveOutcome["kind"] | null>(null);
  const idPrefix = React.useId().replace(/:/g, "");
  const running = React.useRef(false);
  const frozen = useUnsavedFrozen();
  useSubmitOnlyButton(formRef);

  const kind = saveKind ?? saveKindOf(submitLabel);
  const router = useRouter();
  const run = React.useRef<(mode: RequestMode) => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({
    module,
    saveKind: kind,
    workflow: kind === "none" ? submitLabel : undefined,
    label: title,
    save: kind === "none" ? undefined : () => run.current("continue"),
    focus: () => focusFirstInvalid(),
  });
  const { setDirty, setSaving, setUnresolved, touch } = editor;

  // Named inputs a caller adds as children (a file, a note) count as well.
  const [childrenDirty, setChildrenDirty] = React.useState(false);
  const childEditor = React.useMemo(() => ({ setDirty: setChildrenDirty, touch }), [touch]);
  useFormDirty(formRef, childEditor, { paused: pending });

  const valuesDirty = !sameValues(values, baseline);
  React.useEffect(() => setDirty(valuesDirty || childrenDirty), [valuesDirty, childrenDirty, setDirty]);

  const shown = React.useMemo(() => {
    const merged: Record<string, string> = { ...serverErrors };
    for (const [name, message] of Object.entries(clientErrors)) merged[name] = message;
    return merged;
  }, [serverErrors, clientErrors]);

  const change = (name: string, value: FormValue) => {
    setServerErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setValues((current) => {
      const next = { ...current, [name]: value };
      onValuesChange?.(next);
      // Re-checked as it is corrected once it shows an error; a choice as soon as it is made.
      const field = fields.find((item) => item.name === name);
      if (field) {
        setClientErrors((errors) => {
          if (!(name in errors) && !(attempted && (field.type === "select" || field.type === "checkbox"))) return errors;
          const message = checkField(field, value, next, badInput.has(name));
          const copy = { ...errors };
          if (message) copy[name] = message;
          else delete copy[name];
          return copy;
        });
      }
      if (attempted) setFormErrors(validateFieldValues(fields, next, badInput).formErrors);
      return next;
    });
  };

  const blurField = (name: string) => {
    const field = fields.find((item) => item.name === name);
    if (!field || !isShown(field, values)) return;
    const message = checkField(field, values[name], values, badInput.has(name));
    setClientErrors((errors) => {
      if ((errors[name] ?? null) === message) return errors;
      const copy = { ...errors };
      if (message) copy[name] = message;
      else delete copy[name];
      return copy;
    });
  };

  const markBadInput = (name: string, bad: boolean) =>
    setBadInput((current) => {
      if (current.has(name) === bad) return current;
      const next = new Set(current);
      if (bad) next.add(name);
      else next.delete(name);
      return next;
    });

  /**
   * The first of these fields in the dialog's order — or, called by the
   * unsaved-changes prompt after Save and continue, whatever the dialog now
   * marks invalid (read from the DOM, so never a stale render's errors).
   */
  function focusFirstInvalid(names?: string[]) {
    const form = formRef.current;
    if (!form) return;
    let control: HTMLElement | null;
    if (names) {
      const wanted = new Set(names);
      const first = fields.find((field) => wanted.has(field.name) && isShown(field, values));
      control = first ? document.getElementById(`${idPrefix}-${first.name}`) : null;
    } else control = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (control) {
      reveal(control);
      control.focus();
    } else summaryRef.current?.focus();
  }

  const summaryEntries: SummaryEntry[] = fields
    .filter((field) => shown[field.name] && isShown(field, values))
    .map((field) => ({ name: field.name, label: field.label, message: shown[field.name], controlId: `${idPrefix}-${field.name}` }));
  // Errors for a path no field here renders (a row, a rule over the whole payload).
  for (const [name, message] of Object.entries(serverErrors)) {
    if (!fields.some((field) => field.name === name && isShown(field, values))) summaryEntries.push({ name, label: name, message, controlId: null });
  }
  formErrors.forEach((message, index) => summaryEntries.push({ name: `form-${index}`, label: "", message, controlId: null }));

  run.current = async (mode) => {
    if (running.current) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    // Everything is checked on submit, before anything is sent (AUD-09 §3, §6).
    const check = validateFieldValues(fields, values, badInput);
    setClientErrors(check.fieldErrors);
    setFormErrors(check.formErrors);
    if (Object.keys(check.fieldErrors).length || check.formErrors.length) {
      setAttempted(true);
      setLastOutcome("invalid");
      // After Save and continue the prompt hands focus back itself, once closed.
      if (mode === "normal") window.setTimeout(() => focusFirstInvalid(Object.keys(check.fieldErrors)), 0);
      return { kind: "invalid" };
    }
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    setOutcomeText(null);
    setServerErrors({});
    setLastOutcome(null);
    let outcome: SaveOutcome;
    let redirectTo: string | undefined;
    try {
      redirectTo = (await onSubmit(payloadFor(fields, values), values))?.redirectTo;
      outcome = { kind: "committed" };
      // Clean before it stops saving: the navigation that follows goes on
      // without asking. The saved values are the new baseline.
      setBaseline(values);
      setChildrenDirty(false);
      setDirty(false);
      setUnresolved(false);
    } catch (failure) {
      outcome = kitOutcome(failure);
      setUnresolved(outcome.kind === "unknown");
      const byField = fieldErrorsOf(failure);
      setServerErrors(byField);
      setAttempted(true);
      setError(failureMessage(failure, t("errorTitle")));
      setOutcomeText(outcome.kind === "unknown" ? OUTCOME_COPY.unknown : outcome.kind === "failed" || outcome.kind === "invalid" ? OUTCOME_COPY.notSaved : null);
      if (mode === "normal" && Object.keys(byField).length) window.setTimeout(() => focusFirstInvalid(Object.keys(byField)), 0);
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    setLastOutcome(outcome.kind);
    if (outcome.kind === "committed") {
      onDone();
      // Once: the dialog is closed and clean, so nothing asks and nothing resends.
      if (mode === "normal" && redirectTo) router.push(redirectTo);
    }
    return outcome;
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    void run.current("normal");
  }

  return (
    <form ref={formRef} onSubmit={submit} onKeyDown={guardComposingEnter} className="mt-4 space-y-5" noValidate data-save-outcome={lastOutcome ?? undefined} aria-busy={pending || undefined}>
      <FormErrorSummary contract={{ summary: { visible: attempted && summaryEntries.length > 0, entries: summaryEntries }, summaryRef }} />
      {/* The submitted snapshot saves as it was (AUD-03 §6). */}
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        {children}
        <FormFields fields={fields} values={values} onChange={change} errors={shown} idPrefix={idPrefix} onBlurField={blurField} onBadInput={markBadInput} />
      </fieldset>
      {error || outcomeText ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong" data-testid="form-dialog-error">
          {error ? <p>{error}</p> : null}
          {outcomeText ? <p data-testid="form-dialog-outcome">{outcomeText}</p> : null}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending || frozen}>
          {pending ? t("saving") : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * A command that needs a reason — void, waive, terminate, reactivate (§49, §31, §19).
 * Always a workflow step: the prompt never runs it (AUD-03 §3).
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  label,
  name = "reason",
  required = true,
  destructive = false,
  extraFields = [],
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  label?: string;
  name?: string;
  required?: boolean;
  destructive?: boolean;
  extraFields?: FormField[];
  onConfirm: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTranslations("ui");
  const fields: FormField[] = [...extraFields, { name, label: label ?? t("reason"), type: "textarea", required, rows: 3 }];
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} description={description} fields={fields} submitLabel={confirmLabel} saveKind="none" onSubmit={(payload) => onConfirm(payload)}>
      {destructive ? <p className="text-table text-fg-muted">{t("auditNote")}</p> : null}
    </FormDialog>
  );
}

export type RequestMode = "normal" | "continue";

/**
 * A controlled editor whose save is one request — a dialog's fields, a
 * composer, an inline edit — under the unsaved-work contract (AUD-03 §3, §6).
 *
 * The caller says whether its values differ from what it opened with
 * (`dirty`); this registers the editor, runs one request per attempt, keeps
 * the values on any refusal, calls an unanswered request unknown, and marks
 * the editor clean before it stops saving, so a navigation `onCommitted`
 * starts goes on without asking. `onCommitted` must make `dirty` false —
 * rebaseline, clear or close. With `saveKind: "none"` the step is a workflow
 * the prompt never runs; otherwise the prompt's Save and continue runs this
 * same request with mode "continue", where `onCommitted` must not navigate.
 */
export function useRequestEditor<T>({
  module,
  saveKind,
  workflow,
  label,
  dirty,
  request,
  onCommitted,
}: {
  module?: string;
  saveKind: SaveKind;
  workflow?: string;
  label?: string | (() => string);
  dirty: boolean;
  request: () => Promise<T>;
  onCommitted?: (result: T, mode: RequestMode) => void;
}) {
  const t = useTranslations("ui");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [commits, setCommits] = React.useState(0);
  const running = React.useRef(false);
  const latest = React.useRef({ request, onCommitted });
  latest.current = { request, onCommitted };
  const run = React.useRef<(mode: RequestMode) => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module, saveKind, workflow: saveKind === "none" ? workflow : undefined, label, save: saveKind === "none" ? undefined : () => run.current("continue") });
  const { setDirty, setSaving, setUnresolved } = editor;
  // Re-read after each commit: the caller's rebaseline decides what is left.
  React.useEffect(() => setDirty(dirty), [dirty, commits, setDirty]);

  run.current = async (mode) => {
    if (running.current) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    setOutcomeText(null);
    setFailure(null);
    let outcome: SaveOutcome;
    let result: T | undefined;
    try {
      result = await latest.current.request();
      outcome = { kind: "committed" };
      setDirty(false);
      setUnresolved(false);
    } catch (caught) {
      outcome = failureOutcome(caught);
      setUnresolved(outcome.kind === "unknown");
      setFailure(caught);
      setError(failureMessage(caught, t("errorTitle")));
      setOutcomeText(outcome.kind === "unknown" ? OUTCOME_COPY.unknown : null);
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    if (outcome.kind === "committed") {
      setCommits((count) => count + 1);
      latest.current.onCommitted?.(result as T, mode);
    }
    return outcome;
  };

  const submit = React.useCallback((mode: RequestMode = "normal") => run.current(mode), []);
  const onSubmit = React.useCallback((event: React.FormEvent) => {
    event.preventDefault();
    void run.current("normal");
  }, []);
  const clearMessages = React.useCallback(() => {
    setError(null);
    setOutcomeText(null);
    setFailure(null);
  }, []);
  return { editor, pending, error, outcomeText, failure, submit, onSubmit, clearMessages };
}

/** The refusal and the "not confirmed" line a request editor keeps until the next attempt (AUD-03 §6). */
export function RequestMessages({ error, outcomeText, className }: { error: string | null; outcomeText: string | null; className?: string }) {
  if (!error && !outcomeText) return null;
  return (
    <div role="alert" className={cn("space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong", className)}>
      {error ? <p>{error}</p> : null}
      {outcomeText ? <p>{outcomeText}</p> : null}
    </div>
  );
}

/** Runs a command, says what happened, and refreshes the server-rendered page. */
export function useCommand() {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("ui");
  const [pending, setPending] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (key: string, action: () => Promise<unknown>, success: string, after?: (result: unknown) => void) => {
      setPending(key);
      try {
        const result = await action();
        toast({ title: success, tone: "success" });
        after?.(result);
        router.refresh();
        return true;
      } catch (failure) {
        toast({ title: failureMessage(failure, t("errorTitle")), tone: "danger" });
        return false;
      } finally {
        setPending(null);
      }
    },
    [router, toast, t],
  );
  return { pending, run };
}

export const toOptions = (items: Array<{ id: string; label: string }>) => items.map((item) => ({ value: item.id, label: item.label }));
export const fromLabels = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: labels[value] }));
