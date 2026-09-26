"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import { engineeringApi, fieldErrorsOf } from "./engineering-api";
import { FormFields, payloadFor, RequestMessages, useRequestEditor, valuesFor, type FormField, type FormValues } from "./form-kit";

/** The company's contractor and engineering defaults (PRD #46 §279). */

const FIELDS: FormField[] = [
  { name: "rfiDefaultDueDays", label: "RFI response due after (days)", type: "number", required: true, hint: "Used when an RFI is opened without a due date." },
  { name: "submittalDefaultReviewDays", label: "Review due after submission (days)", type: "number", required: true, hint: "For submittals and engineering documents without a review date." },
  { name: "contractorComplianceReminderDays", label: "Compliance expiring window (days)", type: "number", required: true, hint: "An item inside this window is marked expiring and its owners are told." },
  { name: "dueSoonDays", label: "Due-soon notice (days ahead)", type: "number", required: true },
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
  const errors = fieldErrorsOf(save.failure);

  return (
    <form onSubmit={save.onSubmit} className="nesto-card max-w-3xl space-y-5 p-5" data-testid="engineering-settings">
      <RequestMessages error={save.error} outcomeText={save.outcomeText} />
      <fieldset disabled={save.pending} className="m-0 min-w-0 border-0 p-0">
        <FormFields fields={FIELDS} values={values} errors={errors} idPrefix="engineering-settings" onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))} />
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
