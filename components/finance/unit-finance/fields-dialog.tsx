"use client";

import * as React from "react";

import { useFinanceTranslations } from "@/components/finance/finance-text";
import { Field } from "@/components/project-structure/structure-ui";
import { FormDialog, requestOutcome, useDialogRequest, useOpenedWith } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * A small form that sends one request (E-05F): a reason, a date, a confirmation.
 * The legal and finance sections ask for these the same way; the server says
 * whether the change is allowed, and its message lands beside the field it is
 * about or above the form.
 *
 * Most are workflow steps (request, decline, activate, void): leaving with
 * input in them offers Stay or Discard, never the step itself. One that is an
 * ordinary save — a unit's value — says so with `saveKind`, and "Save and
 * continue" runs the same checks and request as its button (AUD-03 §3, §4).
 */

export type Submit = (url: string, body: Record<string, unknown>, success: string, method?: string) => Promise<void>;

export type DialogField =
  | { name: string; label: string; kind: "text" | "textarea"; required?: boolean; initial?: string; hint?: string; max?: number }
  | { name: string; label: string; kind: "date"; required?: boolean; initial?: string; hint?: string }
  | { name: string; label: string; kind: "checkbox"; initial?: boolean; hint?: string };

export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function FieldsDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  url,
  method,
  body,
  fields,
  success,
  submit,
  testId,
  saveKind,
  module,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  url: string;
  method?: string;
  body?: Record<string, unknown>;
  fields: DialogField[];
  success: string;
  submit: Submit;
  testId?: string;
  /** Set when the confirm is an ordinary save, not a workflow step. */
  saveKind?: "save" | "create";
  /** For telemetry: the unit's page unless said otherwise. */
  module?: string;
}) {
  const request = useDialogRequest((target, payload, message) => submit(target, payload, message, method));
  const t = useFinanceTranslations();
  const [values, setValues] = React.useState<Record<string, string | boolean>>({});
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fields.map((field) => [field.name, field.kind === "checkbox" ? Boolean(field.initial) : (field.initial ?? "")])));
    setTouched(false);
    request.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changed = useOpenedWith(open, values);
  const missing = fields.filter((field) => field.kind !== "checkbox" && field.required && String(values[field.name] ?? "").trim() === "").map((field) => field.name);

  /** The dialog's one path to the server, for its button and "Save and continue" alike. */
  async function confirm(): Promise<unknown> {
    setTouched(true);
    if (missing.length) return { code: "VALIDATION_ERROR", message: t("unit.required") };
    const payload: Record<string, unknown> = { ...body };
    for (const field of fields) {
      const value = values[field.name];
      if (field.kind === "checkbox") payload[field.name] = Boolean(value);
      else if (String(value ?? "").trim() !== "") payload[field.name] = String(value).trim();
    }
    return request.send(url, payload, success);
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pending={request.pending}
      error={request.error}
      testId={testId}
      module={module}
      dirty={changed && !request.done}
      unresolved={request.unresolved}
      save={saveKind ? { kind: saveKind, run: async () => requestOutcome(await confirm()) } : undefined}
      onSubmit={() => void confirm().then((failed) => (failed ? null : onClose()))}
    >
      {fields.map((field) => {
        const id = `dialog-${field.name}`;
        const error = (touched && missing.includes(field.name) ? (field.kind === "date" ? t("unit.chooseDate") : t("unit.required")) : undefined) ?? request.fields[field.name];
        if (field.kind === "checkbox") {
          return (
            <label key={field.name} htmlFor={id} className="flex items-start gap-2 text-table text-fg">
              <Checkbox id={id} checked={Boolean(values[field.name])} onCheckedChange={(checked) => setValues((current) => ({ ...current, [field.name]: checked === true }))} className="mt-0.5" />
              <span>
                {field.label}
                {field.hint ? <span className="block text-meta text-fg-subtle">{field.hint}</span> : null}
              </span>
            </label>
          );
        }
        return (
          <Field key={field.name} label={field.label} htmlFor={id} required={field.required} error={error} hint={field.hint}>
            {field.kind === "textarea" ? (
              <Textarea id={id} rows={3} maxLength={field.max ?? 1000} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} aria-invalid={Boolean(error)} />
            ) : (
              <Input id={id} type={field.kind === "date" ? "date" : "text"} maxLength={field.kind === "text" ? (field.max ?? 200) : undefined} value={String(values[field.name] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} aria-invalid={Boolean(error)} />
            )}
          </Field>
        );
      })}
    </FormDialog>
  );
}
