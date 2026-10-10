"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { unsaved, type SaveOutcome } from "@/lib/unsaved/coordinator";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { SECTION_LABELS, type SectionKey } from "@/lib/modules/daily-logs/daily-log.types";
import { parseDecimalInput, type DecimalRule } from "@/lib/forms/decimal";
import { cn } from "@/lib/utils/cn";
import { dailyLogFailureOutcome, failureMessage, isFailure } from "./daily-log-api";
import { SECTION_FIELDS, SECTION_NOUNS, type FieldDef, type OptionSource } from "./entry-fields";
import { dailyLogsLabel, type DailyLogsLabelGroup } from "@/lib/i18n/modules/dailyLogs/labels";
import type { Translate } from "@/lib/i18n/translator";
import { useDailyLogsTranslations, type DailyLogsKey } from "./daily-logs-text";
import { FormSelect } from "@/components/ui/form-select";

/** The dictionary's group for a section's select field, keyed `section.field`. */
const OPTION_GROUPS: Record<string, DailyLogsLabelGroup> = { "weather.condition": "weather", "equipment.status": "equipment", "delays.category": "delayCategory", "delays.impact": "delayImpact" };

/** A section field's words in the reader's language: label, placeholder, hint and options. */
function localField(t: Translate<"dailyLogs">, section: SectionKey, field: FieldDef): FieldDef {
  const text = (branch: string, fallback: string | undefined) => {
    if (fallback === undefined) return undefined;
    const key = `entry.${branch}.${section}.${field.name}` as DailyLogsKey;
    const value = t(key);
    return value === key ? fallback : value;
  };
  const group = OPTION_GROUPS[`${section}.${field.name}`];
  return {
    ...field,
    label: text("fields", field.label) ?? field.label,
    placeholder: text("placeholders", field.placeholder),
    hint: text("hints", field.hint),
    options: group ? field.options?.map((option) => ({ ...option, label: dailyLogsLabel(t, group, option.value, option.label) })) : field.options,
  };
}

/**
 * One form for every section's entries (PRD #43 §149, §151, §156, §160, §216):
 * a centred dialog on a desktop, a bottom sheet on a phone. The server decides;
 * a field it refuses is marked with its message, and a conflict says to reload.
 *
 * `mobile` is decided by the workspace when the editor opens and held until it
 * closes (AUD-04 §3, MW-16): rotating the phone mid-entry keeps the same sheet,
 * its focus and its keyboard. The values live here either way.
 */

export type EntryOptions = Record<OptionSource, Array<{ id: string; label: string }>>;

export function EntryDialog({
  open,
  onOpenChange,
  section,
  initial,
  editing,
  options,
  mobile,
  onSave,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SectionKey | null;
  initial: Record<string, unknown>;
  editing: boolean;
  options: EntryOptions | null;
  mobile: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const t = useDailyLogsTranslations();
  const [values, setValues] = React.useState<Record<string, unknown>>(initial);
  // What the dialog opened with: the entry's values are compared with it (AUD-03 §3).
  const [baseline, setBaseline] = React.useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [unresolved, setUnresolved] = React.useState(false);
  // Removing a saved entry asks once more, in place (AUD-04 §6): it is not undone by Cancel.
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(initial);
      setBaseline(initial);
      setErrors({});
      setFormError(null);
      setUnresolved(false);
      setConfirmRemove(false);
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section]);

  if (!section) return null;
  const fields = SECTION_FIELDS[section].map((field) => localField(t, section, field));
  const title = t(editing ? "entry.edit" : "entry.add", { noun: t(`entry.nouns.${section}` as DailyLogsKey) || SECTION_NOUNS[section] });
  const sectionLabel = dailyLogsLabel(t, "section", section, SECTION_LABELS[section]);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);

  /** The entry's save, for its button and for the prompt's Save and continue alike. */
  async function run(): Promise<SaveOutcome> {
    if (pending) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    const found: Record<string, string> = {};
    const sent = { ...values };
    for (const field of fields) {
      const value = values[field.name];
      const blank = value === undefined || value === null || String(value).trim() === "";
      if (field.required && blank) found[field.name] = t("entry.required");
      // A decimal is read by the shared parser (AUD-09 §4): "12,5" is 12.5, and
      // an ambiguous or malformed figure is refused here with its reason
      // rather than sent as something else (AUD-04 §6, MW-09).
      if (field.type === "number" && !blank) {
        const parsed = parseDecimalInput(String(value), decimalRuleFor(field));
        if (parsed.ok) sent[field.name] = parsed.value;
        else found[field.name] = parsed.message;
      }
    }
    setErrors(found);
    if (Object.keys(found).length) return { kind: "invalid" };
    setPending(true);
    setFormError(null);
    try {
      await onSave(sent);
      // Clean before it stops saving, then closed.
      setBaseline(values);
      setUnresolved(false);
      onOpenChange(false);
      return { kind: "committed" };
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      const field = isFailure(error) ? (error.details.field as string | undefined) : undefined;
      const fieldErrors = isFailure(error) ? Object.entries(error.details).filter(([, value]) => Array.isArray(value)) : [];
      if (field) setErrors({ [field]: failureMessage(error, t("common.somethingWrong")) });
      else if (fieldErrors.length) setErrors(Object.fromEntries(fieldErrors.map(([key, value]) => [key, String((value as string[])[0])])));
      else setFormError(outcome.kind === "unknown" ? `${failureMessage(error, t("common.somethingWrong"))} ${OUTCOME_COPY.unknown}` : failureMessage(error, t("common.somethingWrong")));
      return outcome;
    } finally {
      setPending(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void run();
  }

  async function remove() {
    if (!onRemove || pending) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setPending(true);
    try {
      await onRemove();
      onOpenChange(false);
    } catch (error) {
      const outcome = dailyLogFailureOutcome(error);
      setFormError(outcome.kind === "unknown" ? `${failureMessage(error, t("common.somethingWrong"))} ${OUTCOME_COPY.unknown}` : failureMessage(error, t("common.somethingWrong")));
    } finally {
      setPending(false);
      setConfirmRemove(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate data-testid="entry-form">
      {/* Rendered inside the dialog or sheet, so closing it asks about the entry (AUD-03 §5). */}
      <EntryEditor label={title} saveKind={editing ? "save" : "create"} dirty={dirty} saving={pending} unresolved={unresolved} save={run} />
      <div className={cn("grid flex-1 gap-4 overflow-y-auto", mobile ? "px-5 py-4" : "mt-4 sm:grid-cols-2")}>
        {fields.map((field) => (
          <Field key={field.name} field={field} t={t} value={values[field.name]} error={errors[field.name]} options={options} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
        ))}
      </div>
      {formError ? (
        <p role="alert" className={cn("text-table text-danger-strong", mobile ? "px-5" : "mt-3")}>
          {formError}
        </p>
      ) : null}
      {/* The sheet's actions stay above the home indicator (AUD-04 §3, §6, D-08-12). */}
      <div className={cn("flex flex-wrap items-center gap-2", mobile ? "sticky bottom-0 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" : "mt-6")}>
        {editing && onRemove ? (
          <Button type="button" variant={confirmRemove ? "danger" : "ghost"} size="sm" onClick={() => void remove()} disabled={pending} className={confirmRemove ? undefined : "text-danger-strong hover:text-danger-strong"} aria-live="polite">
            <Trash2 aria-hidden="true" />
            {confirmRemove ? t("entry.confirmRemove") : t("common.remove")}
          </Button>
        ) : null}
        <span className="flex-1" />
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="sm" disabled={pending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t("common.saving") : editing ? t("common.save") : t("common.add")}
        </Button>
      </div>
    </form>
  );

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="bottom" className="bg-surface" aria-describedby="entry-sheet-description">
          <div className="border-b border-line px-5 py-4">
            <DrawerTitle className="text-card font-semibold text-fg">{title}</DrawerTitle>
            <DrawerDescription id="entry-sheet-description" className="text-meta text-fg-muted">
              {sectionLabel}
            </DrawerDescription>
          </div>
          {form}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{sectionLabel}</DialogDescription>
        {form}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The syntax a section's decimal field accepts: the shared rule's separators,
 * a minus only where the field's range goes below zero, and the range the
 * server applies. Precision is left to the server's own schema.
 */
function decimalRuleFor(field: FieldDef): DecimalRule {
  return {
    label: field.label,
    scale: 4,
    maxIntegerDigits: 9,
    allowNegative: field.min !== undefined && field.min < 0,
    min: field.min !== undefined ? String(field.min) : undefined,
    max: field.max !== undefined ? String(field.max) : undefined,
  };
}

/** The entry's registration with the unsaved-work coordinator (AUD-03 §3); the form keeps its values. */
function EntryEditor({ label, saveKind, dirty, saving, unresolved, save }: { label: string; saveKind: "save" | "create"; dirty: boolean; saving: boolean; unresolved: boolean; save: () => Promise<SaveOutcome> }) {
  const editor = useUnsavedEditor({ module: "daily_logs", saveKind, label, save });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => {
    // Dirtiness first: a save that just committed stops saving already clean.
    setDirty(dirty);
    setUnresolved(unresolved);
    setSaving(saving);
  }, [dirty, saving, unresolved, setDirty, setSaving, setUnresolved]);
  return null;
}

function Field({ field, t, value, error, options, onChange }: { field: FieldDef; t: Translate<"dailyLogs">; value: unknown; error?: string; options: EntryOptions | null; onChange: (value: unknown) => void }) {
  const id = `entry-${field.name}`;
  const described = error ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
  const label = (
    <label htmlFor={id} className="text-table font-medium text-fg">
      {field.label}
      {field.required ? <span className="text-danger-strong"> *</span> : null}
    </label>
  );
  const text = value === null || value === undefined ? "" : String(value);
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = <Textarea id={id} rows={3} className="mt-1.5" value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={described} maxLength={5000} />;
      break;
    case "select":
      control = (
        <FormSelect id={id} className={cn(selectClass, "mt-1.5")} value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={described}>
          <option value="">{field.required ? t("common.choose") : "—"}</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FormSelect>
      );
      break;
    case "option": {
      const list = (field.source && options?.[field.source]) || [];
      control = (
        <FormSelect id={id} className={cn(selectClass, "mt-1.5")} value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={described}>
          <option value="">{t("common.none")}</option>
          {list.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </FormSelect>
      );
      break;
    }
    case "checkbox":
      return (
        <label className={cn("flex items-center gap-2.5 text-table text-fg", field.wide && "sm:col-span-2")}>
          <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} aria-label={field.label} />
          {field.label}
        </label>
      );
    default: {
      // A decimal is typed as text and read by the shared parser when it is
      // sent (`numberOrRaw`), so 12,5 means twelve and a half and nothing is
      // silently dropped by a number input that cannot read it. A field that
      // can be negative (temperature) gets the full keyboard: a phone's
      // decimal pad has no minus key (AUD-04 §6, MW-09, D-08-08).
      const decimal = field.type === "number";
      const signed = decimal && field.min !== undefined && field.min < 0;
      control = (
        <Input
          id={id}
          className="mt-1.5"
          type={field.type === "integer" ? "number" : decimal ? "text" : field.type}
          inputMode={field.type === "integer" ? "numeric" : signed ? "text" : decimal ? "decimal" : undefined}
          autoComplete={decimal ? "off" : undefined}
          min={decimal ? undefined : field.min}
          max={decimal ? undefined : field.max}
          step={field.type === "integer" ? "1" : decimal ? undefined : field.step}
          placeholder={field.placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={described}
        />
      );
    }
  }
  return (
    <div className={cn(field.wide && "sm:col-span-2")}>
      {label}
      {control}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-meta text-danger-strong">
          {error}
        </p>
      ) : field.hint ? (
        <p id={`${id}-hint`} className="mt-1 text-meta text-fg-subtle">
          {field.hint}
        </p>
      ) : null}
    </div>
  );
}
