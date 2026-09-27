"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import { engineeringApi, fieldErrorsOf } from "./engineering-api";
import { validateFieldValues } from "@/lib/forms/field-config";
import { FormFields, payloadFor, RequestMessages, useRequestEditor, valuesFor, type FormField, type FormValues } from "./form-kit";

/** The company's contractor and engineering defaults (PRD #46 §279). */

/** Whole days between `min` and `max`: the server schema's bounds, checked before the request (AUD-09 §3, FV-04). */
const days = (min: number, max: number) => (value: string | boolean) => {
  const text = String(value).trim();
  if (text === "") return null;
  const number = Number(text);
  if (!Number.isInteger(number)) return "Enter a whole number of days.";
  if (number < min) return min === 1 ? "At least one day." : `At least ${min} days.`;
  if (number > max) return `At most ${max} days.`;
  return null;
};

const FIELDS: FormField[] = [
  { name: "rfiDefaultDueDays", label: "RFI response due after (days)", type: "number", required: true, validate: days(1, 90), hint: "Used when an RFI is opened without a due date." },
  { name: "submittalDefaultReviewDays", label: "Review due after submission (days)", type: "number", required: true, validate: days(1, 120), hint: "For submittals and engineering documents without a review date." },
  { name: "contractorComplianceReminderDays", label: "Compliance expiring window (days)", type: "number", required: true, validate: days(1, 180), hint: "An item inside this window is marked expiring and its owners are told." },
  { name: "dueSoonDays", label: "Due-soon notice (days ahead)", type: "number", required: true, validate: days(1, 14) },
  { name: "allowSelfReview", label: "Allow a submitter to review their own revision", type: "checkbox", hint: "Off by default: somebody else decides." },
  { name: "requireSubmittalDueDate", label: "Require a review date on every submittal", type: "checkbox" },
];

export function EngineeringSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const router = useRouter();
  const toast = useToast();
  const [baseline, setBaseline] = React.useState<FormValues>(() => valuesFor(FIELDS, initial));
  const [values, setValues] = React.useState<FormValues>(baseline);

  // AUD-03 §3: the settings as saved are the baseline; Save and continue runs this same PUT.
  const save = useRequestEditor({
    module: "engineering",
    saveKind: "save",
    label: "Engineering settings",
    dirty: JSON.stringify(values) !== JSON.stringify(baseline),
    request: () => engineeringApi("/api/engineering/settings", { method: "PUT", body: payloadFor(FIELDS, values) }),
    onCommitted: () => {
      setBaseline(values);
      toast({ title: "Engineering settings saved.", tone: "success" });
      router.refresh();
    },
  });
  // The kit's client check, the same rules as the server's, before any request (AUD-09 §3, FV-04).
  const [checked, setChecked] = React.useState<Record<string, string> | null>(null);
  const errors = checked ?? fieldErrorsOf(save.failure);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const check = validateFieldValues(FIELDS, values);
    if (Object.keys(check.fieldErrors).length > 0) {
      save.clearMessages();
      setChecked(check.fieldErrors);
      return;
    }
    setChecked(null);
    void save.submit("normal");
  }

  return (
    <form onSubmit={submit} noValidate className="nesto-card max-w-3xl space-y-5 p-5" data-testid="engineering-settings">
      <RequestMessages error={save.error} outcomeText={save.outcomeText} />
      <fieldset disabled={save.pending} className="m-0 min-w-0 border-0 p-0">
        <FormFields fields={FIELDS} values={values} errors={errors} idPrefix="engineering-settings" onChange={(name, value) => {
            setValues((current) => ({ ...current, [name]: value }));
            // A field that had an error is checked again as it is corrected (AUD-09 §3).
            if (checked?.[name]) setChecked((current) => {
              if (!current) return current;
              const next = { ...current };
              const field = FIELDS.find((item) => item.name === name);
              const message = field ? validateFieldValues([field], { ...values, [name]: value }).fieldErrors[name] : undefined;
              if (message) next[name] = message;
              else delete next[name];
              return next;
            });
          }} />
      </fieldset>
      <p className="text-table text-fg-muted">Contractors and Engineering are switched on or off for the company in Settings → Modules.</p>
      <div className="flex items-center justify-end gap-3">
        <UnsavedIndicator save={{ editor: save.editor, pending: save.pending, saved: null }} />
        <Button type="submit" disabled={save.pending}>
          {save.pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
