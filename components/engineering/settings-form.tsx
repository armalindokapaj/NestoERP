"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { UnsavedIndicator } from "@/components/unsaved/editor-status";
import { engineeringApi, fieldErrorsOf } from "./engineering-api";
import { validateFieldValues } from "@/lib/forms/field-config";
import { FormFields, payloadFor, RequestMessages, useRequestEditor, valuesFor, type FormField, type FormValues } from "./form-kit";
import { englishEngineering, useEngineeringTranslations } from "./engineering-text";
import type { Translate } from "@/lib/i18n/translator";

/** The company's contractor and engineering defaults (PRD #46 §279). */

/** Whole days between `min` and `max`: the server schema's bounds, checked before the request (AUD-09 §3, FV-04). */
const days = (t: Translate<"engineering">, min: number, max: number) => (value: string | boolean) => {
  const text = String(value).trim();
  if (text === "") return null;
  const number = Number(text);
  if (!Number.isInteger(number)) return t("settings.wholeDays");
  if (number < min) return min === 1 ? t("settings.atLeastOne") : t("settings.atLeast", { min });
  if (number > max) return t("settings.atMost", { max });
  return null;
};

const fieldsFor = (t: Translate<"engineering">): FormField[] => [
  { name: "rfiDefaultDueDays", label: t("settings.rfiDefaultDueDays"), type: "number", required: true, validate: days(t, 1, 90), hint: t("settings.rfiDefaultDueDaysHint") },
  { name: "submittalDefaultReviewDays", label: t("settings.submittalDefaultReviewDays"), type: "number", required: true, validate: days(t, 1, 120), hint: t("settings.submittalDefaultReviewDaysHint") },
  { name: "contractorComplianceReminderDays", label: t("settings.complianceReminderDays"), type: "number", required: true, validate: days(t, 1, 180), hint: t("settings.complianceReminderDaysHint") },
  { name: "dueSoonDays", label: t("settings.dueSoonDays"), type: "number", required: true, validate: days(t, 1, 14) },
  { name: "allowSelfReview", label: t("settings.allowSelfReview"), type: "checkbox", hint: t("settings.allowSelfReviewHint") },
  { name: "requireSubmittalDueDate", label: t("settings.requireSubmittalDueDate"), type: "checkbox" },
];

/** The field names and types, for reading the saved values; the labels do not matter there. */
const FIELDS = fieldsFor(englishEngineering);

export function EngineeringSettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const router = useRouter();
  const toast = useToast();
  const t = useEngineeringTranslations();
  const fields = React.useMemo(() => fieldsFor(t), [t]);
  const [baseline, setBaseline] = React.useState<FormValues>(() => valuesFor(FIELDS, initial));
  const [values, setValues] = React.useState<FormValues>(baseline);

  // AUD-03 §3: the settings as saved are the baseline; Save and continue runs this same PUT.
  const save = useRequestEditor({
    module: "engineering",
    saveKind: "save",
    label: t("pages.settings"),
    dirty: JSON.stringify(values) !== JSON.stringify(baseline),
    request: () => engineeringApi("/api/engineering/settings", { method: "PUT", body: payloadFor(fields, values) }),
    onCommitted: () => {
      setBaseline(values);
      toast({ title: t("settings.saved"), tone: "success" });
      router.refresh();
    },
  });
  // The kit's client check, the same rules as the server's, before any request (AUD-09 §3, FV-04).
  const [checked, setChecked] = React.useState<Record<string, string> | null>(null);
  const errors = checked ?? fieldErrorsOf(save.failure);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const check = validateFieldValues(fields, values);
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
        <FormFields fields={fields} values={values} errors={errors} idPrefix="engineering-settings" onChange={(name, value) => {
            setValues((current) => ({ ...current, [name]: value }));
            // A field that had an error is checked again as it is corrected (AUD-09 §3).
            if (checked?.[name]) setChecked((current) => {
              if (!current) return current;
              const next = { ...current };
              const field = fields.find((item) => item.name === name);
              const message = field ? validateFieldValues([field], { ...values, [name]: value }).fieldErrors[name] : undefined;
              if (message) next[name] = message;
              else delete next[name];
              return next;
            });
          }} />
      </fieldset>
      <p className="text-table text-fg-muted">{t("settings.modulesNote")}</p>
      <div className="flex items-center justify-end gap-3">
        <UnsavedIndicator save={{ editor: save.editor, pending: save.pending, saved: null }} />
        <Button type="submit" disabled={save.pending}>
          {save.pending ? t("ui.saving") : t("settings.save")}
        </Button>
      </div>
    </form>
  );
}
