"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { failureMessage, fieldErrorsOf } from "./engineering-api";

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

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  submitLabel,
  onSubmit,
  wide = false,
  testId,
  children,
  onValuesChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FormField[];
  initial?: Partial<Record<string, unknown>>;
  submitLabel: string;
  /** Throw the API failure to show it; resolve to close. */
  onSubmit: (payload: Record<string, unknown>, values: FormValues) => Promise<void>;
  wide?: boolean;
  testId?: string;
  children?: React.ReactNode;
  onValuesChange?: (values: FormValues) => void;
}) {
  const [values, setValues] = React.useState<FormValues>(() => valuesFor(fields, initial));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const idPrefix = React.useId().replace(/:/g, "");

  React.useEffect(() => {
    if (!open) return;
    setValues(valuesFor(fields, initial));
    setErrors({});
    setError(null);
    // Reset only when the dialog opens; the field list may be rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const change = (name: string, value: FormValue) => {
    setValues((current) => {
      const next = { ...current, [name]: value };
      onValuesChange?.(next);
      return next;
    });
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setErrors({});
    try {
      await onSubmit(payloadFor(fields, values), values);
      onOpenChange(false);
    } catch (failure) {
      const fieldErrors = fieldErrorsOf(failure);
      setErrors(fieldErrors);
      setError(failureMessage(failure));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={cn("max-h-[92dvh] overflow-y-auto", wide ? "max-w-3xl" : "max-w-xl")} data-testid={testId}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <form onSubmit={submit} className="mt-4 space-y-5" noValidate>
          {children}
          <FormFields fields={fields} values={values} onChange={change} errors={errors} idPrefix={idPrefix} />
          {error ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-table text-danger-strong">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A command that needs a reason — void, waive, terminate, reactivate (§49, §31, §19). */
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
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} description={description} fields={fields} submitLabel={confirmLabel} onSubmit={(payload) => onConfirm(payload)}>
      {destructive ? <p className="text-table text-fg-muted">This is recorded in the audit trail and cannot be undone here.</p> : null}
    </FormDialog>
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
