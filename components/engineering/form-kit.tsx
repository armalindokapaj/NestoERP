"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useFormDirty, useUnsavedEditor, useUnsavedFrozen } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveKind, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { cn } from "@/lib/utils/cn";
import { failureMessage, failureOutcome, fieldErrorsOf } from "./engineering-api";

/**
 * One form grammar for contractor and engineering records (PRD #46 §166,
 * §170). A field list drives the dialog: labels above inputs, errors under the
 * field the server named, optional fields sent as null, the submit button busy
 * while the server decides. Every dialog in the module reads the same way.
 */

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

export type FormField = {
  name: string;
  label: string;
  type: "text" | "email" | "textarea" | "date" | "number" | "select" | "checkbox";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** The empty choice of a select; omit to make a choice required. */
  emptyLabel?: string;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  rows?: number;
  step?: string;
  visible?: (values: FormValues) => boolean;
  disabled?: boolean;
};

export function valuesFor(fields: FormField[], initial: Partial<Record<string, unknown>> = {}): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = initial[field.name];
    if (field.type === "checkbox") values[field.name] = Boolean(raw);
    else values[field.name] = raw === null || raw === undefined ? "" : String(raw);
  }
  return values;
}

/** Values as the API takes them: empty optional text is null, numbers are numbers, hidden fields are left out. */
export function payloadFor(fields: FormField[], values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.visible && !field.visible(values)) {
      payload[field.name] = field.type === "checkbox" ? false : null;
      continue;
    }
    const value = values[field.name];
    if (field.type === "checkbox") payload[field.name] = Boolean(value);
    else if (field.type === "number") payload[field.name] = value === "" ? null : Number(value);
    else payload[field.name] = typeof value === "string" && value.trim() === "" ? null : value;
  }
  return payload;
}

export function FormFields({ fields, values, onChange, errors, idPrefix }: { fields: FormField[]; values: FormValues; onChange: (name: string, value: FormValue) => void; errors: Record<string, string>; idPrefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        if (field.visible && !field.visible(values)) return null;
        const id = `${idPrefix}-${field.name}`;
        const error = errors[field.name];
        const describedBy = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
        if (field.type === "checkbox") {
          return (
            <label key={field.name} htmlFor={id} className={cn("flex items-start gap-2.5 text-body text-fg", field.wide !== false && "sm:col-span-2")}>
              <Checkbox id={id} checked={Boolean(values[field.name])} onCheckedChange={(checked) => onChange(field.name, checked === true)} disabled={field.disabled} />
              <span>
                {field.label}
                {field.hint ? <span className="block text-meta text-fg-subtle">{field.hint}</span> : null}
              </span>
            </label>
          );
        }
        const common = { id, name: field.name, "aria-invalid": Boolean(error) || undefined, "aria-describedby": describedBy, disabled: field.disabled, required: field.required };
        return (
          <div key={field.name} className={cn("flex min-w-0 flex-col gap-1", (field.wide || field.type === "textarea") && "sm:col-span-2")}>
            <label htmlFor={id} className="text-meta font-medium text-fg-muted">
              {field.label}
              {field.required ? <span className="text-danger-strong"> *</span> : null}
            </label>
            {field.type === "textarea" ? (
              <Textarea {...common} rows={field.rows ?? 3} value={String(values[field.name] ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field.name, event.target.value)} />
            ) : field.type === "select" ? (
              <select {...common} className={selectClass} value={String(values[field.name] ?? "")} onChange={(event) => onChange(field.name, event.target.value)}>
                {field.emptyLabel !== undefined || !field.required ? <option value="">{field.emptyLabel ?? "—"}</option> : null}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input {...common} type={field.type === "number" ? "number" : field.type} step={field.step} value={String(values[field.name] ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field.name, event.target.value)} />
            )}
            {error ? (
              <p id={`${id}-error`} className="text-meta text-danger-strong">
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
  const formRef = React.useRef<HTMLFormElement>(null);
  // Mounted when the dialog opens: the values start from `initial` each time.
  const [baseline, setBaseline] = React.useState<FormValues>(() => valuesFor(fields, initial));
  const [values, setValues] = React.useState<FormValues>(baseline);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [outcomeText, setOutcomeText] = React.useState<string | null>(null);
  const idPrefix = React.useId().replace(/:/g, "");
  const running = React.useRef(false);
  const frozen = useUnsavedFrozen();

  const kind = saveKind ?? saveKindOf(submitLabel);
  const router = useRouter();
  const run = React.useRef<(mode: RequestMode) => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({
    module,
    saveKind: kind,
    workflow: kind === "none" ? submitLabel : undefined,
    label: title,
    save: kind === "none" ? undefined : () => run.current("continue"),
  });
  const { setDirty, setSaving, setUnresolved, touch } = editor;

  // Named inputs a caller adds as children (a file, a note) count as well.
  const [childrenDirty, setChildrenDirty] = React.useState(false);
  const childEditor = React.useMemo(() => ({ setDirty: setChildrenDirty, touch }), [touch]);
  useFormDirty(formRef, childEditor, { paused: pending });

  const valuesDirty = !sameValues(values, baseline);
  React.useEffect(() => setDirty(valuesDirty || childrenDirty), [valuesDirty, childrenDirty, setDirty]);

  const change = (name: string, value: FormValue) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      onValuesChange?.(next);
      return next;
    });
  };

  run.current = async (mode) => {
    if (running.current) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    setOutcomeText(null);
    setErrors({});
    let outcome: SaveOutcome;
    let redirectTo: string | undefined;
    try {
      redirectTo = (await onSubmit(payloadFor(fields, values), values))?.redirectTo;
      outcome = { kind: "committed" };
      // Clean before it stops saving: the navigation that follows goes on
      // without asking.
      setBaseline(values);
      setChildrenDirty(false);
      setDirty(false);
      setUnresolved(false);
    } catch (failure) {
      outcome = failureOutcome(failure);
      setUnresolved(outcome.kind === "unknown");
      setErrors(fieldErrorsOf(failure));
      setError(failureMessage(failure));
      setOutcomeText(outcome.kind === "unknown" ? OUTCOME_COPY.unknown : null);
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    if (outcome.kind === "committed") {
      onDone();
      if (mode === "normal" && redirectTo) router.push(redirectTo);
    }
    return outcome;
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run.current("normal");
  }

  return (
    <form ref={formRef} onSubmit={submit} className="mt-4 space-y-5" noValidate>
      {/* The submitted snapshot saves as it was (AUD-03 §6). */}
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-5 border-0 p-0">
        {children}
        <FormFields fields={fields} values={values} onChange={change} errors={errors} idPrefix={idPrefix} />
      </fieldset>
      {error || outcomeText ? (
        <div role="alert" className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
          {error ? <p>{error}</p> : null}
          {outcomeText ? <p>{outcomeText}</p> : null}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || frozen}>
          {pending ? "Saving…" : submitLabel}
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
  label = "Reason",
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
  const fields: FormField[] = [...extraFields, { name, label, type: "textarea", required, rows: 3 }];
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} description={description} fields={fields} submitLabel={confirmLabel} saveKind="none" onSubmit={(payload) => onConfirm(payload)}>
      {destructive ? <p className="text-table text-fg-muted">This is recorded in the audit trail and cannot be undone here.</p> : null}
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
      setError(failureMessage(caught));
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
        toast({ title: failureMessage(failure), tone: "danger" });
        return false;
      } finally {
        setPending(null);
      }
    },
    [router, toast],
  );
  return { pending, run };
}

export const toOptions = (items: Array<{ id: string; label: string }>) => items.map((item) => ({ value: item.id, label: item.label }));
export const fromLabels = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: labels[value] }));
