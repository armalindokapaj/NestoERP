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
import { cn } from "@/lib/utils/cn";
import { dailyLogFailureOutcome, failureMessage, isFailure } from "./daily-log-api";
import { SECTION_FIELDS, SECTION_NOUNS, type FieldDef, type OptionSource } from "./entry-fields";

/**
 * One form for every section's entries (PRD #43 §149, §151, §156, §160, §216):
 * a centred dialog on a desktop, a bottom sheet on a phone. The server decides;
 * a field it refuses is marked with its message, and a conflict says to reload.
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
  const [values, setValues] = React.useState<Record<string, unknown>>(initial);
  // What the dialog opened with: the entry's values are compared with it (AUD-03 §3).
  const [baseline, setBaseline] = React.useState<Record<string, unknown>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [unresolved, setUnresolved] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(initial);
      setBaseline(initial);
      setErrors({});
      setFormError(null);
      setUnresolved(false);
    }
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section]);

  if (!section) return null;
  const fields = SECTION_FIELDS[section];
  const title = `${editing ? "Edit" : "Add"} ${SECTION_NOUNS[section]}`;
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);

  /** The entry's save, for its button and for the prompt's Save and continue alike. */
  async function run(): Promise<SaveOutcome> {
    if (pending) return { kind: "unknown" };
    if (unsaved.frozen) return { kind: "refused" };
    const found: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name];
      if (field.required && (value === undefined || value === null || String(value).trim() === "")) found[field.name] = "Required.";
    }
    setErrors(found);
    if (Object.keys(found).length) return { kind: "invalid" };
    setPending(true);
    setFormError(null);
    try {
      await onSave(values);
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
      if (field) setErrors({ [field]: failureMessage(error) });
      else if (fieldErrors.length) setErrors(Object.fromEntries(fieldErrors.map(([key, value]) => [key, String((value as string[])[0])])));
      else setFormError(outcome.kind === "unknown" ? `${failureMessage(error)} ${OUTCOME_COPY.unknown}` : failureMessage(error));
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
    if (!onRemove) return;
    setPending(true);
    try {
      await onRemove();
      onOpenChange(false);
    } catch (error) {
      setFormError(failureMessage(error));
    } finally {
      setPending(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate data-testid="entry-form">
      {/* Rendered inside the dialog or sheet, so closing it asks about the entry (AUD-03 §5). */}
      <EntryEditor label={title} saveKind={editing ? "save" : "create"} dirty={dirty} saving={pending} unresolved={unresolved} save={run} />
      <div className={cn("grid flex-1 gap-4 overflow-y-auto", mobile ? "px-5 py-4" : "mt-4 sm:grid-cols-2")}>
        {fields.map((field) => (
          <Field key={field.name} field={field} value={values[field.name]} error={errors[field.name]} options={options} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} />
        ))}
      </div>
      {formError ? (
        <p role="alert" className={cn("text-table text-danger-strong", mobile ? "px-5" : "mt-3")}>
          {formError}
        </p>
      ) : null}
      <div className={cn("flex items-center gap-2", mobile ? "sticky bottom-0 border-t border-line bg-surface px-5 py-3" : "mt-6")}>
        {editing && onRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void remove()} disabled={pending} className="text-danger-strong hover:text-danger-strong">
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        ) : null}
        <span className="flex-1" />
        <DialogClose asChild>
          <Button type="button" variant="secondary" size="sm" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add"}
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
              {SECTION_LABELS[section]}
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
        <DialogDescription>{SECTION_LABELS[section]}</DialogDescription>
        {form}
      </DialogContent>
    </Dialog>
  );
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

function Field({ field, value, error, options, onChange }: { field: FieldDef; value: unknown; error?: string; options: EntryOptions | null; onChange: (value: unknown) => void }) {
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
        <select id={id} className={cn(selectClass, "mt-1.5")} value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={described}>
          <option value="">{field.required ? "Choose…" : "—"}</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "option": {
      const list = (field.source && options?.[field.source]) || [];
      control = (
        <select id={id} className={cn(selectClass, "mt-1.5")} value={text} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={described}>
          <option value="">None</option>
          {list.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
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
    default:
      control = (
        <Input
          id={id}
          className="mt-1.5"
          type={field.type === "integer" || field.type === "number" ? "number" : field.type}
          inputMode={field.type === "integer" ? "numeric" : field.type === "number" ? "decimal" : undefined}
          min={field.min}
          max={field.max}
          step={field.type === "integer" ? "1" : field.step}
          placeholder={field.placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={described}
        />
      );
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
